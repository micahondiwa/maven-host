import 'server-only'
import { settings } from '../config'
import { BadSignature, timestampSign, timestampUnsign } from '../auth/signing'
import { onCommit, transaction } from '../db'
import type { AuthUser } from '../http/router'
import { issueTokens } from '../auth/jwt'
import { addToGroup, createUser, findUserByEmailInsensitive, findUserById, updateUser } from './users'
import { sendWelcomeEmail } from './emails'

/** Port of apps/accounts/services/google.py, github.py and api/views/oauth.py. */

export class OAuthError extends Error {}

const STATE_MAX_AGE_SECONDS = 600

export function safeNext(value: string | null | undefined) {
  const next = (value || '/account').trim()
  return next.startsWith('/') && !next.startsWith('//') ? next : '/account'
}

type Profile = { email: string; firstName: string; lastName: string }

type Provider = {
  label: string
  salt: string
  enabled(): boolean
  authorizeUrl(state: string): string
  fetchProfile(code: string): Promise<Profile>
}

async function postForm(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(url, { method: 'POST', body: new URLSearchParams(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, signal: AbortSignal.timeout(10_000) })
}

const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

const google: Provider = {
  label: 'Google',
  salt: 'maven-google-oauth',
  enabled: () => Boolean(settings.oauth.google.clientId && settings.oauth.google.clientSecret && settings.oauth.google.redirectUri),
  authorizeUrl(state) {
    const params = new URLSearchParams({
      client_id: settings.oauth.google.clientId,
      redirect_uri: settings.oauth.google.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  },
  async fetchProfile(code) {
    const token = await postForm('https://oauth2.googleapis.com/token', {
      client_id: settings.oauth.google.clientId,
      client_secret: settings.oauth.google.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: settings.oauth.google.redirectUri,
    })
    if (!token.ok) throw new OAuthError('Google token exchange failed.')
    const accessToken = ((await token.json()) as { access_token?: string }).access_token
    if (!accessToken) throw new OAuthError('Google did not return an access token.')
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new OAuthError('Maven could not read the Google account profile.')
    const profile = (await response.json()) as { email?: string; email_verified?: boolean; name?: string }
    if (!profile.email || profile.email_verified !== true) throw new OAuthError('Your Google account does not have a verified email address that Maven can use.')
    return { email: profile.email.trim().toLowerCase(), ...splitName(profile.name ?? '') }
  },
}

const github: Provider = {
  label: 'GitHub',
  salt: 'maven-github-oauth',
  enabled: () => Boolean(settings.oauth.github.clientId && settings.oauth.github.clientSecret && settings.oauth.github.redirectUri),
  authorizeUrl(state) {
    const params = new URLSearchParams({ client_id: settings.oauth.github.clientId, redirect_uri: settings.oauth.github.redirectUri, scope: 'read:user user:email', state })
    return `https://github.com/login/oauth/authorize?${params}`
  },
  async fetchProfile(code) {
    const token = await postForm(
      'https://github.com/login/oauth/access_token',
      { client_id: settings.oauth.github.clientId, client_secret: settings.oauth.github.clientSecret, code, redirect_uri: settings.oauth.github.redirectUri },
      { Accept: 'application/json', 'User-Agent': 'Maven-Host' },
    )
    if (!token.ok) throw new OAuthError('GitHub token exchange failed.')
    const accessToken = ((await token.json()) as { access_token?: string }).access_token
    if (!accessToken) throw new OAuthError('GitHub did not return an access token.')
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Maven-Host' }
    const [userResponse, emailsResponse] = await Promise.all([
      fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10_000) }),
      fetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(10_000) }),
    ])
    if (!userResponse.ok || !emailsResponse.ok) throw new OAuthError('Maven could not read the GitHub account profile.')
    const profile = (await userResponse.json()) as { name?: string | null }
    const emails = (await emailsResponse.json()) as { email?: string; primary?: boolean; verified?: boolean }[]
    const verified = emails.find((item) => item.primary && item.verified && item.email) ?? emails.find((item) => item.verified && item.email)
    if (!verified?.email) throw new OAuthError('Your GitHub account does not have a verified email address that Maven can use.')
    return { email: verified.email.trim().toLowerCase(), ...splitName(profile.name ?? '') }
  },
}

export const OAUTH_PROVIDERS: Record<string, Provider> = { google, github }

export function authorizationUrl(provider: Provider, nextPath: string) {
  if (!provider.enabled()) throw new OAuthError(`${provider.label} sign-in is not configured.`)
  return provider.authorizeUrl(timestampSign(safeNext(nextPath), provider.salt))
}

export function validateState(provider: Provider, state: string) {
  try {
    return safeNext(timestampUnsign(state, provider.salt, STATE_MAX_AGE_SECONDS))
  } catch (error) {
    if (error instanceof BadSignature) throw new OAuthError(`The ${provider.label} sign-in session expired. Please try again.`)
    throw error
  }
}

/** Links by verified email; new accounts are verified customers with unusable passwords. */
export async function authenticateOAuth(provider: Provider, code: string): Promise<AuthUser> {
  if (!provider.enabled()) throw new OAuthError(`${provider.label} sign-in is not configured.`)
  const profile = await provider.fetchProfile(code)
  const firstName = profile.firstName.slice(0, 30)
  const lastName = profile.lastName.slice(0, 30)
  const user = await transaction(async (client) => {
    const existing = await findUserByEmailInsensitive(profile.email, client)
    if (!existing) {
      const created = await createUser(client, { email: profile.email, first_name: firstName, last_name: lastName, is_email_verified: true })
      await addToGroup(client, created.id, 'Customer', true)
      onCommit(client, () => sendWelcomeEmail({ ...created, is_email_verified: true }))
      return (await findUserById(created.id, client))!
    }
    const changes: Record<string, unknown> = {}
    if (!existing.is_email_verified) changes.is_email_verified = true
    if (!existing.first_name && firstName) changes.first_name = firstName
    if (!existing.last_name && lastName) changes.last_name = lastName
    await updateUser(client, existing.id, changes)
    return (await findUserById(existing.id, client))!
  })
  if (!user.is_active) throw new OAuthError('This Maven account has been disabled.')
  return user
}

export function frontendRedirect(provider: string, options: { next?: string; access?: string; refresh?: string; error?: string } = {}) {
  const fragment = new URLSearchParams({ next: safeNext(options.next) })
  if (options.access && options.refresh) {
    fragment.set('access', options.access)
    fragment.set('refresh', options.refresh)
  }
  if (options.error) fragment.set('error', options.error)
  return new Response(null, { status: 302, headers: { Location: `${settings.frontendUrl}/oauth/${provider}/callback#${fragment}`, 'Cache-Control': 'no-store' } })
}

export async function completeOAuth(providerName: string, params: URLSearchParams) {
  const provider = OAUTH_PROVIDERS[providerName]
  if (!provider) return frontendRedirect(providerName, { error: 'Unsupported sign-in provider.' })
  const error = params.get('error')
  if (error) return frontendRedirect(providerName, { error: params.get('error_description') || error })
  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return frontendRedirect(providerName, { error: 'The sign-in response was incomplete. Please try again.' })
  try {
    const next = validateState(provider, state)
    const user = await authenticateOAuth(provider, code)
    const tokens = await issueTokens(user.id)
    return frontendRedirect(providerName, { next, ...tokens })
  } catch (failure) {
    if (failure instanceof OAuthError) return frontendRedirect(providerName, { error: failure.message })
    console.error('OAuth sign-in failed', failure)
    return frontendRedirect(providerName, { error: 'We could not complete sign-in. Please try again.' })
  }
}
