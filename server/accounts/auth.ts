import 'server-only'
import { passwordValidationErrors } from '../auth/validators'
import { randomBytes, randomUUID } from 'node:crypto'
import { settings } from '../config'
import { database, onCommit, queryOne, transaction, type Queryable } from '../db'
import { HttpError, ValidationError } from '../http/errors'
import type { AuthUser } from '../http/router'
import { hashPassword, passwordNeedsUpgrade, verifyDjangoPassword } from '../auth/passwords'
import { checkResetToken, decodeUid, encodeUid, makeResetToken } from '../auth/reset-tokens'
import { blacklistRefresh, issueTokens, rotateRefresh, TokenError } from '../auth/jwt'
import { normalizeUuid } from '../http/validation'
import { addToGroup, createUser, findUserByEmail, findUserByEmailInsensitive, findUserById, normalizeEmail, updateUser } from './users'
import { currentUser } from './serializers'
import { sendPasswordResetEmail, sendVerificationEmail, sendWelcomeEmail } from './emails'

/** Port of apps/accounts services: authentication, registration, verification and password recovery. */

export async function tokenResponse(user: AuthUser, db?: Queryable) {
  const tokens = await issueTokens(user.id, db)
  return { access: tokens.access, refresh: tokens.refresh, user: await currentUser(user, db) }
}

/** `authenticate(username=email, password=...)` with Django ModelBackend semantics. */
export async function authenticateCredentials(email: string, password: string): Promise<AuthUser | null> {
  const user = await findUserByEmail(email)
  if (!user) {
    // ModelBackend runs the hasher once so missing accounts take as long as wrong passwords.
    await hashPassword(password)
    return null
  }
  if (!(await verifyDjangoPassword(password, user.password))) return null
  if (passwordNeedsUpgrade(user.password)) {
    const upgraded = await hashPassword(password)
    await updateUser(database(), user.id, { password: upgraded })
    user.password = upgraded
  }
  return user.is_active ? user : null
}

export async function login(email: string, password: string) {
  const user = await authenticateCredentials(email, password)
  if (!user) throw ValidationError.nonField('Invalid email or password.')
  return tokenResponse(user)
}

export async function refresh(token: string) {
  try {
    return await rotateRefresh(token)
  } catch (error) {
    if (!(error instanceof TokenError)) throw error
    if (error.message === 'No active account found for the given credentials')
      throw new HttpError(401, { detail: error.message, code: 'no_active_account' })
    throw new HttpError(401, { detail: error.message, code: 'token_not_valid' })
  }
}

export async function logout(token: string) {
  try {
    await blacklistRefresh(token)
  } catch (error) {
    if (error instanceof TokenError) throw ValidationError.field('refresh', 'Invalid or expired refresh token.')
    throw error
  }
}

// --- Email verification (VerificationService) ---

async function createVerificationToken(db: Queryable, userId: string) {
  await db.query('UPDATE accounts_emailverificationtoken SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL', [userId])
  const token = randomBytes(48).toString('base64url')
  await db.query(
    `INSERT INTO accounts_emailverificationtoken (id, token, created_at, expires_at, used_at, user_id)
     VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours', NULL, $3)`,
    [randomUUID(), token, userId],
  )
  return token
}

export const verificationUrl = (token: string) => `${settings.frontendUrl}/verify-email/?token=${token}`

export async function sendVerification(db: Queryable, user: AuthUser) {
  const token = await createVerificationToken(db, user.id)
  await sendVerificationEmail(user, verificationUrl(token))
  return token
}

export async function verifyEmail(tokenValue: string) {
  return transaction(async (client) => {
    const token = await queryOne<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
      'SELECT id, user_id, expires_at, used_at FROM accounts_emailverificationtoken WHERE token = $1 FOR UPDATE',
      [tokenValue],
      client,
    )
    if (!token) throw ValidationError.field('token', 'Invalid verification token.')
    if (token.used_at || token.expires_at.getTime() <= Date.now())
      throw ValidationError.field('token', 'Verification token has expired or has already been used.')
    await client.query('UPDATE accounts_emailverificationtoken SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [token.id])
    await updateUser(client, token.user_id, { is_email_verified: true })
  })
}

export async function resendVerification(user: AuthUser) {
  if (user.is_email_verified) throw new ValidationError({ detail: ['Email address is already verified.'] })
  await sendVerification(database(), user)
}

// --- Registration (RegistrationService) ---

export async function register(input: { email: string; password: string; first_name?: string; last_name?: string }) {
  const user = await transaction(async (client) => {
    if (await findUserByEmail(normalizeEmail(input.email), client)) throw ValidationError.field('email', 'A user with this email already exists.')
    const created = await createUser(client, { email: input.email, password: input.password, first_name: input.first_name, last_name: input.last_name })
    await addToGroup(client, created.id, 'Customer')
    onCommit(client, () => sendWelcomeEmail(created))
    try {
      await sendVerification(client, created)
    } catch (error) {
      console.error(`Failed to send verification email for user ${created.email}`, error)
    }
    return created
  })
  return tokenResponse(user)
}

// --- Password recovery ---

export async function requestPasswordReset(email: string) {
  const user = await findUserByEmailInsensitive(email)
  if (!user || !user.is_active) return
  const resetUrl = `${settings.frontendUrl}/reset-password/${encodeUid(user.id)}/${makeResetToken(user)}`
  try {
    await sendPasswordResetEmail(user.email, resetUrl)
  } catch (error) {
    console.error('Password reset email delivery failed.', error)
  }
}

export async function confirmPasswordReset(uid: string, token: string, password: string) {
  const userId = normalizeUuid(decodeUid(uid) ?? '')
  const user = userId ? await findUserById(userId) : undefined
  if (!user || !user.is_active || !checkResetToken(user, token)) throw ValidationError.field('token', 'Invalid or expired password reset link.')
  const errors = passwordValidationErrors(password, user)
  if (errors.length) throw new ValidationError({ password: errors })
  await updateUser(database(), user.id, { password: await hashPassword(password) })
}
