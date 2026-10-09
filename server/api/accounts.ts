import 'server-only'
import { database, query, queryOne, transaction } from '../db'
import { HttpError, notFound } from '../http/errors'
import { AllowAny, json, Router, type Context } from '../http/router'
import { f, fieldError, validate } from '../http/validation'
import { pageParams, paginate, pageWindow } from '../http/pagination'
import { allStaffPermissions, PERMISSION_REGISTRY, ROLE_PERMISSION_MATRIX, roleCodes, STAFF_ROLES, staffPermission, userRoles } from '../auth/permissions'
import * as auth from '../accounts/auth'
import * as staff from '../accounts/staff'
import { authorizationUrl, completeOAuth, frontendRedirect, OAUTH_PROVIDERS, OAuthError } from '../accounts/oauth'
import { currentUser, profileData, staffCustomer, staffCustomerDetail, staffUser, type ProfileRow } from '../accounts/serializers'
import { ensureProfile, updateUser } from '../accounts/users'

const publicRoute = (throttle?: string) => ({ permissions: [AllowAny], throttle })

// --- apps/accounts/api/urls.py ---

async function profileResponse(ctx: Context) {
  const user = ctx.authenticatedUser
  await ensureProfile(database(), user.id)
  const profile = (await queryOne<ProfileRow>('SELECT * FROM accounts_profile WHERE user_id = $1', [user.id]))!
  const fresh = (await queryOne<{ first_name: string; last_name: string }>('SELECT first_name, last_name FROM accounts_user WHERE id = $1', [user.id]))!
  return { email: user.email, first_name: fresh.first_name, last_name: fresh.last_name, profile: profileData(profile) }
}

const profileSchema = {
  phone_number: f.string({ maxLength: 20, allowBlank: true }),
  company: f.string({ maxLength: 255, allowBlank: true }),
  country: f.string({ maxLength: 100, allowBlank: true }),
  city: f.string({ maxLength: 100, allowBlank: true }),
  address: f.string({ maxLength: 255, allowBlank: true }),
  postal_code: f.string({ maxLength: 20, allowBlank: true }),
  timezone: f.string({ maxLength: 100 }),
  preferred_currency: f.choice(['USD', 'KES', 'EUR'] as const),
}

export const authRoutes = new Router()
  .get('oauth/<str:provider>/', (ctx) => {
    const provider = OAUTH_PROVIDERS[ctx.params.provider]
    if (!provider) throw notFound('Unsupported sign-in provider.')
    const next = ctx.query.get('next') ?? '/account'
    try {
      return new Response(null, { status: 302, headers: { Location: authorizationUrl(provider, next), 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof OAuthError) return frontendRedirect(ctx.params.provider, { next, error: error.message })
      throw error
    }
  }, publicRoute('login'))
  .get('oauth/<str:provider>/callback/', (ctx) => completeOAuth(ctx.params.provider, ctx.query), publicRoute('login'))
  .post('login/', async (ctx) => {
    const data = validate({ email: f.email(), password: f.string({ trim: false }) }, await ctx.body())
    return auth.login(data.email, data.password)
  }, publicRoute('login'))
  .post('register/', async (ctx) => {
    const data = validate(
      {
        email: f.email({ maxLength: 254 }),
        first_name: f.string({ allowBlank: true, maxLength: 30 }).optional(),
        last_name: f.string({ allowBlank: true, maxLength: 30 }).optional(),
        password: f.string({ minLength: 8 }),
        confirm_password: f.string(),
      },
      await ctx.body(),
      { validate: (values) => { if (values.password !== values.confirm_password) fieldError('confirm_password', 'Passwords do not match.') } },
    )
    return json(await auth.register(data), 201)
  }, publicRoute('registration'))
  .post('refresh/', async (ctx) => {
    const data = validate({ refresh: f.string() }, await ctx.body())
    return auth.refresh(data.refresh)
  }, { authenticate: false, permissions: [AllowAny], throttle: 'token_refresh' })
  .get('me/', (ctx) => currentUser(ctx.authenticatedUser))
  .get('profile/', profileResponse)
  .patch('profile/', async (ctx) => {
    const body = await ctx.body()
    const userFields = validate({ first_name: f.string({ allowBlank: true, maxLength: 30, trim: false }), last_name: f.string({ allowBlank: true, maxLength: 30, trim: false }) }, body, { partial: true })
    const profile = validate(profileSchema, body, { partial: true })
    await transaction(async (client) => {
      await updateUser(client, ctx.authenticatedUser.id, userFields)
      await ensureProfile(client, ctx.authenticatedUser.id)
      const entries = Object.entries(profile)
      if (entries.length)
        await client.query(
          `UPDATE accounts_profile SET ${entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
          [ctx.authenticatedUser.id, ...entries.map(([, value]) => value)],
        )
    })
    return profileResponse(ctx)
  })
  .post('password-reset/', async (ctx) => {
    const data = validate({ email: f.email() }, await ctx.body())
    await auth.requestPasswordReset(data.email)
    return { message: 'If the account exists, a password reset email has been sent.' }
  }, publicRoute('password_reset'))
  .post('password-reset/confirm/', async (ctx) => {
    const data = validate(
      { uid: f.string(), token: f.string(), password: f.string({ minLength: 8 }), confirm_password: f.string() },
      await ctx.body(),
      { validate: (values) => { if (values.password !== values.confirm_password) fieldError('confirm_password', 'Passwords do not match.') } },
    )
    await auth.confirmPasswordReset(data.uid, data.token, data.password)
    return { message: 'Password reset successfully.' }
  }, publicRoute('password_reset'))
  .post('logout/', async (ctx) => {
    const data = validate({ refresh: f.string() }, await ctx.body())
    await auth.logout(data.refresh)
    return undefined
  })
  .post('verify-email/', async (ctx) => {
    const data = validate({ token: f.string() }, await ctx.body())
    await auth.verifyEmail(data.token)
    return { message: 'Email verified successfully.' }
  }, publicRoute('email_verification'))
  .post('resend-verification/', async (ctx) => {
    await auth.resendVerification(ctx.authenticatedUser)
    return { message: 'Verification email sent successfully.' }
  }, { throttle: 'email_verification' })

// --- apps/accounts/api/staff_urls.py ---

const canManageUsers = { permissions: [staffPermission('manage_users')], throttle: 'staff_management' }
const canManageRoles = { permissions: [staffPermission('manage_roles')], throttle: 'staff_management' }
const canViewCustomers = { permissions: [staffPermission('view_customer')] }
const staffNotFound = () => notFound('Staff account not found.')

async function staffTarget(ctx: Context) {
  const user = await staff.staffAccount(ctx.params.pk)
  if (!user) throw staffNotFound()
  return user
}

const nameField = () => f.string({ allowBlank: true, maxLength: 30 }).optional()

async function listCustomers(ctx: Context) {
  const { page, size } = pageParams(ctx.url)
  const search = (ctx.query.get('search') ?? '').trim()
  const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  const where = `u.is_staff = false AND u.is_superuser = false${search ? ` AND (u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR p.company ILIKE $1)` : ''}`
  const params = search ? [pattern] : []
  const count = (await queryOne<{ n: number }>(`SELECT count(*)::integer AS n FROM accounts_user u LEFT JOIN accounts_profile p ON p.user_id = u.id WHERE ${where}`, params))!.n
  const { current, offset } = pageWindow(count, page, size)
  const rows = await query(
    `SELECT u.*, p.company, p.country FROM accounts_user u LEFT JOIN accounts_profile p ON p.user_id = u.id WHERE ${where} ORDER BY u.email LIMIT ${size} OFFSET ${offset}`,
    params,
  )
  return paginate(ctx.url, count, current, size, rows.map((row) => staffCustomer(row as never)))
}

export const customerStaffRoutes = new Router()
  .get('', listCustomers, canViewCustomers)
  .get('<uuid:pk>/', async (ctx) => {
    const row = await queryOne(
      `SELECT u.*, p.company, p.country, p.phone_number, p.city, p.address, p.postal_code, p.timezone, p.preferred_currency
         FROM accounts_user u LEFT JOIN accounts_profile p ON p.user_id = u.id
        WHERE u.is_staff = false AND u.is_superuser = false AND u.id = $1`,
      [ctx.params.pk],
    )
    if (!row) throw notFound('Customer account not found.')
    return staffCustomerDetail(row as never, await userRoles(ctx.params.pk))
  }, canViewCustomers)

export const staffRoutes = new Router()
  .post('invitations/accept/', async (ctx) => {
    const data = validate(
      {
        token: f.string(),
        first_name: f.string({ maxLength: 30 }).optional(),
        last_name: nameField(),
        password: f.string({ minLength: 12, trim: false }),
        password_confirm: f.string({ minLength: 12, trim: false }),
      },
      await ctx.body(),
      { validate: (values) => { if (values.password !== values.password_confirm) fieldError('password_confirm', 'Passwords do not match.') } },
    )
    return staffUser(await staff.acceptInvitation(data))
  }, publicRoute('staff_invitation'))
  .get('', async () => Promise.all((await staff.listStaff()).map((user) => staffUser(user))), canManageUsers)
  .post('', async (ctx) => {
    if (!(await allStaffPermissions('manage_users', 'manage_roles')(ctx)))
      throw new HttpError(403, { detail: 'You need both staff-management and role-management permissions to invite staff.' })
    const data = validate(
      {
        email: f.email(),
        first_name: nameField(),
        last_name: nameField(),
        role: f.choice(STAFF_ROLES).check((role) => {
          if (role === 'Platform Administrator' && !ctx.authenticatedUser.is_superuser) fieldError('role', 'Only a platform superuser may create a Platform Administrator.')
        }),
      },
      await ctx.body(),
    )
    return json(await staffUser(await staff.inviteStaff(ctx.authenticatedUser, data)), 201)
  }, canManageUsers)
  .get('<uuid:pk>/', async (ctx) => staffUser(await staffTarget(ctx)), canManageUsers)
  .patch('<uuid:pk>/', async (ctx) => {
    const user = await staffTarget(ctx)
    const changes = validate({ first_name: nameField(), last_name: nameField() }, await ctx.body(), { partial: true })
    return staffUser(await staff.updateStaffProfile(ctx.authenticatedUser, user, changes))
  }, canManageUsers)
  .post('<uuid:pk>/suspend/', async (ctx) => staffUser(await staff.suspendStaff(ctx.authenticatedUser, await staffTarget(ctx))), canManageUsers)
  .post('<uuid:pk>/activate/', async (ctx) => staffUser(await staff.activateStaff(ctx.authenticatedUser, await staffTarget(ctx))), canManageUsers)
  .post('<uuid:pk>/resend-invitation/', async (ctx) => {
    await staff.resendInvitation(ctx.authenticatedUser, await staffTarget(ctx))
    return { detail: 'Staff invitation sent.' }
  }, canManageUsers)
  .get('<uuid:pk>/roles/', async (ctx) => ({ roles: await userRoles((await staffTarget(ctx)).id) }), canManageRoles)
  .put('<uuid:pk>/roles/', async (ctx) => {
    const user = await staffTarget(ctx)
    const data = validate(
      {
        roles: f.list(f.choice(STAFF_ROLES), { allowEmpty: false }).check((roles) => {
          if (roles.includes('Platform Administrator') && !ctx.authenticatedUser.is_superuser) fieldError('roles', 'Only a platform superuser may assign Platform Administrator.')
          if (new Set(roles).size !== roles.length) fieldError('roles', 'Roles must be unique.')
        }),
      },
      await ctx.body(),
    )
    return staffUser(await staff.setStaffRoles(ctx.authenticatedUser, user, data.roles))
  }, canManageRoles)

// --- apps/accounts/api/authorization_urls.py ---

export const authorizationRoutes = new Router()
  .get('roles/', async () => {
    const counts = new Map(
      (await query<{ name: string; n: number }>(
        `SELECT g.name, count(ug.user_id)::integer AS n FROM auth_group g LEFT JOIN accounts_user_groups ug ON ug.group_id = g.id WHERE g.name = ANY($1) GROUP BY g.name`,
        [Object.keys(ROLE_PERMISSION_MATRIX)],
      )).map((row) => [row.name, row.n]),
    )
    return Object.keys(ROLE_PERMISSION_MATRIX).map((name) => ({ name, permissions: roleCodes(name), user_count: counts.get(name) ?? 0 }))
  }, canManageRoles)
  .get('permissions/', () =>
    Object.entries(PERMISSION_REGISTRY).flatMap(([module, entries]) => entries.map(([codename, name]) => ({ module, codename, name }))),
  canManageRoles)

