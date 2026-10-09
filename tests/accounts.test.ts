import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import compat from './fixtures/django-compat.json'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

process.env.SECRET_KEY = compat.secret
process.env.FRONTEND_URL = 'http://localhost:3000'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

describe('Django token compatibility', () => {
  it('accepts an access token minted by v1 SimpleJWT with the same SECRET_KEY', async () => {
    const { decodeToken } = await import('../server/auth/jwt')
    const issuedAt = JSON.parse(Buffer.from(compat.access.split('.')[1], 'base64url').toString()).iat
    vi.useFakeTimers({ now: issuedAt * 1000 + 60_000 })
    try {
      expect(decodeToken(compat.access, 'access').user_id).toBe(compat.user_id)
      expect(() => decodeToken(compat.access, 'refresh')).toThrow()
      expect(() => decodeToken(compat.access.slice(0, -2) + 'xx', 'access')).toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('produces and verifies Django password-reset tokens and uids', async () => {
    const { makeResetToken, checkResetToken, encodeUid, decodeUid } = await import('../server/auth/reset-tokens')
    const user = { id: compat.user_id, password: 'pbkdf2_sha256$1000000$abc$def', last_login: new Date('2026-10-01T12:30:45.123456Z'), email: 'synthetic@example.test' }
    const now = Date.UTC(2026, 9, 9, 6, 0, 0)
    expect(makeResetToken(user, now)).toBe(compat.reset_token)
    expect(checkResetToken(user, compat.reset_token, now + 3600_000)).toBe(true)
    expect(checkResetToken({ ...user, password: 'changed' }, compat.reset_token, now)).toBe(false)
    expect(checkResetToken(user, compat.reset_token, now + 4 * 86400_000)).toBe(false)
    expect(encodeUid(compat.user_id)).toBe(compat.uid)
    expect(decodeUid(compat.uid)).toBe(compat.user_id)
  })
})

suite('accounts API', () => {
  type Api = typeof import('../server/api')
  let api: Api
  let sent: () => { subject: string; to: string[]; text: string }[]
  let resetThrottles: () => void
  let ip = 0

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${++ip % 250}` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
  }

  const unique = () => `user-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`

  async function registerCustomer(email = unique(), password = 'Synthetic-pass-123') {
    const result = await call('POST', '/auth/register/', { body: { email, password, confirm_password: password, first_name: 'Ada', last_name: 'Synthetic' } })
    expect(result.status).toBe(201)
    return { email, password, ...result.body }
  }

  beforeAll(async () => {
    api = await import('../server/api')
    const { transaction } = await import('../server/db')
    const { syncPermissions } = await import('../server/auth/permissions')
    await transaction((client) => syncPermissions(client))
    sent = (await import('../server/communications/email')).sentEmails
    resetThrottles = (await import('../server/http/throttle')).resetThrottles
  })

  beforeEach(() => resetThrottles())

  afterAll(async () => {
    const { database } = await import('../server/db')
    await database().end()
  })

  it('registers a customer, issues tokens and sends welcome and verification emails', async () => {
    const before = sent().length
    const account = await registerCustomer()
    expect(account.user).toMatchObject({ email: account.email, account_type: 'customer', access_planes: ['customer'], roles: [], permissions: [], is_email_verified: false })
    expect(account.access.split('.')).toHaveLength(3)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const subjects = sent().slice(before).map((message) => message.subject)
    expect(subjects).toContain('Welcome to MavenHost')
    expect(subjects).toContain('Confirm your email to get started with MavenHost')
  })

  it('returns DRF-shaped validation errors', async () => {
    expect(await call('POST', '/auth/register/', { body: { email: 'bad', password: 'short', confirm_password: 'x' } })).toMatchObject({
      status: 400,
      body: { email: ['Enter a valid email address.'], password: ['Ensure this field has at least 8 characters.'] },
    })
    expect((await call('POST', '/auth/register/', { body: { email: unique(), password: 'Synthetic-pass-123', confirm_password: 'different' } })).body).toEqual({ confirm_password: ['Passwords do not match.'] })
    // Django's password validators now apply to customers as well as staff.
    expect((await call('POST', '/auth/register/', { body: { email: unique(), password: 'password123', confirm_password: 'password123' } })).body).toEqual({ password: ['This password is too common.'] })
    expect((await call('POST', '/auth/register/', { body: { email: unique(), password: '83920175', confirm_password: '83920175' } })).body).toEqual({ password: ['This password is entirely numeric.'] })
    const account = await registerCustomer()
    expect((await call('POST', '/auth/register/', { body: { email: account.email, password: 'Synthetic-pass-123', confirm_password: 'Synthetic-pass-123' } })).body).toEqual({ email: ['A user with this email already exists.'] })
    expect((await call('POST', '/auth/login/', { body: { email: account.email, password: 'wrong-password' } })).body).toEqual({ non_field_errors: ['Invalid email or password.'] })
    expect((await call('POST', '/auth/login/', { body: [] })).body).toEqual({ non_field_errors: ['Invalid data. Expected a dictionary, but got list.'] })
  })

  it('logs in, reads and updates the profile, rotates and blacklists refresh tokens', async () => {
    const account = await registerCustomer()
    const login = await call('POST', '/auth/login/', { body: { email: account.email, password: account.password } })
    expect(login.status).toBe(200)
    expect((await call('GET', '/auth/me/', { token: login.body.access })).body.email).toBe(account.email)
    expect((await call('GET', '/auth/me/')).status).toBe(401)
    expect((await call('GET', '/auth/me/', { token: 'not.a.token' })).body.code).toBe('token_not_valid')

    const profile = await call('PATCH', '/auth/profile/', { token: login.body.access, body: { first_name: 'Grace', company: 'Synthetic Ltd', preferred_currency: 'KES' } })
    expect(profile.body).toMatchObject({ first_name: 'Grace', profile: { company: 'Synthetic Ltd', preferred_currency: 'KES', timezone: 'UTC' } })
    expect((await call('PATCH', '/auth/profile/', { token: login.body.access, body: { preferred_currency: 'GBP' } })).body).toEqual({ preferred_currency: ['"GBP" is not a valid choice.'] })

    const rotated = await call('POST', '/auth/refresh/', { body: { refresh: login.body.refresh } })
    expect(rotated.status).toBe(200)
    expect(rotated.body.refresh).not.toBe(login.body.refresh)
    expect((await call('POST', '/auth/refresh/', { body: { refresh: login.body.refresh } })).body).toMatchObject({ code: 'token_not_valid', detail: 'Token is blacklisted' })
    expect((await call('POST', '/auth/logout/', { token: rotated.body.access, body: { refresh: rotated.body.refresh } })).status).toBe(204)
    expect((await call('POST', '/auth/refresh/', { body: { refresh: rotated.body.refresh } })).status).toBe(401)
  })

  it('verifies email once and refuses resend after verification', async () => {
    const account = await registerCustomer()
    const { queryOne } = await import('../server/db')
    const token = (await queryOne<{ token: string }>('SELECT t.token FROM accounts_emailverificationtoken t JOIN accounts_user u ON u.id = t.user_id WHERE u.email = $1 AND t.used_at IS NULL', [account.email]))!.token
    expect((await call('POST', '/auth/verify-email/', { body: { token } })).body).toEqual({ message: 'Email verified successfully.' })
    expect((await call('POST', '/auth/verify-email/', { body: { token } })).body).toEqual({ token: ['Verification token has expired or has already been used.'] })
    expect((await call('POST', '/auth/resend-verification/', { token: account.access })).body).toEqual({ detail: ['Email address is already verified.'] })
  })

  it('resets a password through the emailed link without revealing unknown accounts', async () => {
    const account = await registerCustomer()
    expect((await call('POST', '/auth/password-reset/', { body: { email: 'nobody@example.test' } })).status).toBe(200)
    await call('POST', '/auth/password-reset/', { body: { email: account.email.toUpperCase() } })
    const email = sent().filter((message) => message.to[0] === account.email && message.subject === 'Reset your MavenHost password').at(-1)!
    const [, uid, token] = /reset-password\/([^/]+)\/(\S+)$/.exec(email.text)!
    expect((await call('POST', '/auth/password-reset/confirm/', { body: { uid, token, password: 'qwertyuiop', confirm_password: 'qwertyuiop' } })).body).toEqual({ password: ['This password is too common.'] })
    expect((await call('POST', '/auth/password-reset/confirm/', { body: { uid, token, password: 'New-synthetic-456', confirm_password: 'New-synthetic-456' } })).body).toEqual({ message: 'Password reset successfully.' })
    expect((await call('POST', '/auth/password-reset/confirm/', { body: { uid, token, password: 'Another-pass-789', confirm_password: 'Another-pass-789' } })).body).toEqual({ token: ['Invalid or expired password reset link.'] })
    expect((await call('POST', '/auth/login/', { body: { email: account.email, password: 'New-synthetic-456' } })).status).toBe(200)
  })

  it('throttles login attempts per client', async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.10' }
    const statuses: number[] = []
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await api.handleApi(new Request('http://localhost:3000/api/v1/auth/login/', { method: 'POST', headers, body: JSON.stringify({ email: 'x@example.test', password: 'x' }) }))
      statuses.push(response.status)
    }
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  }, 30_000)

  it('enforces staff permissions and runs the invitation lifecycle', async () => {
    const { transaction } = await import('../server/db')
    const { createUser } = await import('../server/accounts/users')
    const adminEmail = unique()
    await transaction((client) => createUser(client, { email: adminEmail, password: 'Admin-synthetic-123', is_staff: true, is_superuser: true, is_email_verified: true }))
    const admin = (await call('POST', '/auth/login/', { body: { email: adminEmail, password: 'Admin-synthetic-123' } })).body
    expect(admin.user.account_type).toBe('admin')
    const customer = await registerCustomer()

    expect((await call('GET', '/staff/', { token: customer.access })).status).toBe(403)
    expect((await call('GET', '/staff/customers/', { token: customer.access })).status).toBe(403)
    expect((await call('GET', '/authorization/roles/', { token: admin.access })).body.map((role: { name: string }) => role.name)).toEqual(['Customer', 'Support', 'Billing', 'Sales', 'Reseller', 'Platform Administrator'])

    const before = sent().length
    const staffEmail = unique()
    const invited = await call('POST', '/staff/', { token: admin.access, body: { email: staffEmail, first_name: 'Sam', role: 'Support' } })
    expect(invited.status).toBe(201)
    expect(invited.body).toMatchObject({ status: 'invited', roles: ['Support'] })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const invitation = sent().slice(before).find((message) => message.to[0] === staffEmail)!
    const token = /token=(\S+)/.exec(invitation.text)![1]

    expect((await call('POST', '/staff/invitations/accept/', { body: { token, password: 'password1234', password_confirm: 'password1234' } })).body).toEqual({ detail: ['This password is too common.'] })
    const accepted = await call('POST', '/staff/invitations/accept/', { body: { token, password: 'Long-synthetic-staff-9', password_confirm: 'Long-synthetic-staff-9' } })
    expect(accepted.body).toMatchObject({ status: 'active', is_email_verified: true })
    const support = (await call('POST', '/auth/login/', { body: { email: staffEmail, password: 'Long-synthetic-staff-9' } })).body
    expect(support.user.permissions).toContain('view_customer')

    const customers = await call('GET', `/staff/customers/?search=${encodeURIComponent(customer.email)}`, { token: support.access })
    expect(customers.body).toMatchObject({ count: 1, next: null, previous: null })
    expect(customers.body.results[0]).toMatchObject({ email: customer.email, status: 'unverified' })
    expect((await call('GET', '/staff/', { token: support.access })).status).toBe(403)

    expect((await call('PUT', `/staff/${accepted.body.id}/roles/`, { token: admin.access, body: { roles: ['Billing', 'Billing'] } })).body).toEqual({ roles: ['Roles must be unique.'] })
    expect((await call('PUT', `/staff/${accepted.body.id}/roles/`, { token: admin.access, body: { roles: ['Billing'] } })).body.roles).toEqual(['Billing'])
    expect((await call('POST', `/staff/${accepted.body.id}/suspend/`, { token: admin.access })).body.status).toBe('suspended')
    expect((await call('GET', '/auth/me/', { token: support.access })).body).toMatchObject({ code: 'user_inactive' })
  }, 60_000)
})
