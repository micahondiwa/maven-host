import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { settings } from '../config'
import { onCommit, query, queryOne, transaction, type Queryable } from '../db'
import { DetailError } from '../http/errors'
import type { AuthUser } from '../http/router'
import { hashPassword, hasUsablePassword } from '../auth/passwords'
import { passwordValidationErrors } from '../auth/validators'
import { roleGroup, STAFF_ROLES, userRoles } from '../auth/permissions'
import { audit } from '../audit/audit'
import { createUser, findUserByEmailInsensitive, findUserById, normalizeEmail, updateUser } from './users'
import { sendStaffInvitation } from './emails'

/** Port of apps/accounts/services/staff.py. Django ValidationErrors become `{"detail": [messages]}` (400). */

const INVITATION_PATH = '/staff/activate/'
const invalid = (message: string) => new DetailError([message])

function staffAudit(db: Queryable, actorId: string, targetId: string, event: string, message: string, metadata: Record<string, unknown> = {}) {
  return audit(
    { event, category: 'auth', status: 'success', performedBy: actorId, target: { appLabel: 'accounts', model: 'user', id: targetId }, message, metadata },
    db,
  )
}

function assertRoleAllowed(actor: AuthUser, role: string) {
  if (!STAFF_ROLES.includes(role)) throw invalid('Invalid staff role.')
  if (role === 'Platform Administrator' && !actor.is_superuser) throw invalid('Only a platform superuser may assign Platform Administrator.')
}

async function createInvitation(db: Queryable, userId: string, actorId: string) {
  const rawToken = randomBytes(48).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const id = randomUUID()
  await db.query(
    `INSERT INTO accounts_staffinvitation (id, token_hash, expires_at, used_at, created_at, invited_by_id, user_id)
     VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours', NULL, CURRENT_TIMESTAMP, $3, $4)`,
    [id, tokenHash, actorId, userId],
  )
  return { id, url: `${settings.frontendUrl}${INVITATION_PATH}?token=${rawToken}` }
}

export async function inviteStaff(actor: AuthUser, input: { email: string; first_name?: string; last_name?: string; role: string }) {
  return transaction(async (client) => {
    assertRoleAllowed(actor, input.role)
    const email = normalizeEmail(input.email)
    if (await findUserByEmailInsensitive(email, client)) throw invalid('An account with this email already exists.')
    const user = await createUser(client, {
      email,
      first_name: input.first_name ?? '',
      last_name: input.last_name ?? '',
      is_staff: true,
      is_active: false,
      is_email_verified: false,
    })
    const group = await roleGroup(input.role, client)
    await client.query('INSERT INTO accounts_user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, group])
    const invitation = await createInvitation(client, user.id, actor.id)
    onCommit(client, () => sendStaffInvitation(user, invitation.url, input.role))
    await staffAudit(client, actor.id, user.id, 'staff_invited', `Staff account invited with role ${input.role}.`, { role: input.role, invitation_id: invitation.id })
    return user
  })
}

export async function acceptInvitation(input: { token: string; password: string; first_name?: string; last_name?: string }) {
  return transaction(async (client) => {
    const tokenHash = createHash('sha256').update(input.token).digest('hex')
    const invitation = await queryOne<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
      'SELECT id, user_id, expires_at, used_at FROM accounts_staffinvitation WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
      client,
    )
    if (!invitation || invitation.used_at || invitation.expires_at.getTime() <= Date.now()) throw invalid('Invalid or expired staff invitation.')
    const user = (await findUserById(invitation.user_id, client))!
    const changes: Record<string, unknown> = {}
    if (input.first_name !== undefined) changes.first_name = input.first_name.trim()
    if (input.last_name !== undefined) changes.last_name = input.last_name.trim()
    const errors = passwordValidationErrors(input.password, { ...user, ...changes })
    if (errors.length) throw new DetailError(errors)
    await updateUser(client, user.id, { ...changes, password: await hashPassword(input.password), is_active: true, is_staff: true, is_email_verified: true })
    await client.query('UPDATE accounts_staffinvitation SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [invitation.id])
    await staffAudit(client, user.id, user.id, 'staff_activated', 'Staff invitation accepted and account activated.', { invitation_id: invitation.id })
    return (await findUserById(user.id, client))!
  })
}

export async function resendInvitation(actor: AuthUser, user: AuthUser) {
  return transaction(async (client) => {
    if (!user.is_staff) throw invalid('Only staff accounts can receive staff invitations.')
    if (user.is_active) throw invalid('The staff account is already active.')
    if (user.is_email_verified || hasUsablePassword(user.password))
      throw invalid('The staff account has already accepted its invitation; use activate instead.')
    await client.query('UPDATE accounts_staffinvitation SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL', [user.id])
    const invitation = await createInvitation(client, user.id, actor.id)
    const role = (await userRoles(user.id, client))[0] ?? 'Staff'
    onCommit(client, () => sendStaffInvitation(user, invitation.url, role, true))
    await staffAudit(client, actor.id, user.id, 'staff_invited', 'Staff invitation resent.', { invitation_id: invitation.id })
  })
}

export async function updateStaffProfile(actor: AuthUser, user: AuthUser, changes: { first_name?: string; last_name?: string }) {
  return transaction(async (client) => {
    if (!user.is_staff) throw invalid('The target user is not a staff account.')
    const fields = Object.keys(changes)
    if (fields.length) {
      await updateUser(client, user.id, changes)
      await staffAudit(client, actor.id, user.id, 'staff_profile_updated', 'Staff account profile updated.', { fields: fields.sort() })
    }
    return (await findUserById(user.id, client))!
  })
}

export async function suspendStaff(actor: AuthUser, user: AuthUser) {
  return transaction(async (client) => {
    if (!user.is_staff) throw invalid('The target user is not a staff account.')
    if (user.is_superuser && !actor.is_superuser) throw invalid('Only a superuser may suspend another superuser.')
    if (user.id === actor.id) throw invalid('A staff member cannot suspend their own account.')
    await updateUser(client, user.id, { is_active: false })
    await staffAudit(client, actor.id, user.id, 'staff_suspended', 'Staff account suspended.')
    return (await findUserById(user.id, client))!
  })
}

export async function activateStaff(actor: AuthUser, user: AuthUser) {
  return transaction(async (client) => {
    if (!user.is_staff) throw invalid('The target user is not a staff account.')
    if (!hasUsablePassword(user.password) || !user.is_email_verified) throw invalid('Staff account must accept its invitation before activation.')
    await updateUser(client, user.id, { is_active: true })
    await staffAudit(client, actor.id, user.id, 'staff_activated', 'Staff account activated.')
    return (await findUserById(user.id, client))!
  })
}

export async function setStaffRoles(actor: AuthUser, user: AuthUser, requested: string[]) {
  return transaction(async (client) => {
    if (!user.is_staff) throw invalid('Only staff accounts can receive staff roles.')
    if (user.id === actor.id) throw invalid('A staff member cannot change their own role assignment.')
    if (user.is_superuser && !actor.is_superuser) throw invalid("Only a superuser may change another superuser's roles.")
    const roles = [...new Set(requested)]
    if (!roles.length) throw invalid('At least one staff role is required.')
    for (const role of roles) assertRoleAllowed(actor, role)
    const groups: number[] = []
    for (const role of roles) groups.push(await roleGroup(role, client))
    const previous = (await userRoles(user.id, client)).filter((role) => STAFF_ROLES.includes(role))
    await client.query(
      `DELETE FROM accounts_user_groups WHERE user_id = $1 AND group_id IN (SELECT id FROM auth_group WHERE name = ANY($2))`,
      [user.id, ['Customer', ...STAFF_ROLES]],
    )
    for (const group of groups) await client.query('INSERT INTO accounts_user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, group])
    await staffAudit(client, actor.id, user.id, 'staff_role_changed', 'Staff role assignment changed.', { previous_roles: previous.sort(), roles: [...roles].sort() })
    return (await findUserById(user.id, client))!
  })
}

export async function staffAccount(id: string) {
  return queryOne<AuthUser>(`SELECT * FROM accounts_user WHERE id = $1 AND is_staff`, [id])
}

export async function listStaff() {
  return query<AuthUser>('SELECT * FROM accounts_user WHERE is_staff ORDER BY email')
}
