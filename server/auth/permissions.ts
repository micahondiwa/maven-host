import 'server-only'
import { database, query, type Queryable } from '../db'
import type { AuthUser, Context, Permission } from '../http/router'

/** apps/accounts/authorization/registry.py */
export const PERMISSION_REGISTRY: Record<string, [string, string][]> = {
  domains: [
    ['view_domain', 'Can view domains'],
    ['register_domain', 'Can register domains'],
    ['transfer_domain', 'Can transfer domains'],
    ['renew_domain', 'Can renew domains'],
    ['manage_domain_autorenew', 'Can manage domain auto-renewal'],
    ['delete_domain', 'Can delete domains'],
    ['manage_dns', 'Can manage DNS records'],
  ],
  hosting: [
    ['view_hosting', 'Can view hosting accounts'],
    ['create_hosting', 'Can provision hosting'],
    ['suspend_hosting', 'Can suspend hosting'],
    ['terminate_hosting', 'Can terminate hosting'],
    ['upgrade_hosting', 'Can upgrade hosting'],
    ['manage_hosting', 'Can manage hosting infrastructure'],
  ],
  orders: [['view_order', 'Can view orders']],
  billing: [
    ['view_invoice', 'Can view invoices'],
    ['view_payment', 'Can view payments'],
    ['create_invoice', 'Can create invoices'],
    ['issue_refund', 'Can issue refunds'],
    ['process_payment', 'Can process payments'],
    ['fulfill_order', 'Can fulfill orders'],
  ],
  support: [
    ['view_ticket', 'Can view support tickets'],
    ['assign_ticket', 'Can assign tickets'],
    ['resolve_ticket', 'Can resolve tickets'],
    ['close_ticket', 'Can close tickets'],
    ['reopen_ticket', 'Can reopen tickets'],
    ['reply_ticket', 'Can reply to tickets'],
    ['add_internal_note', 'Can add internal ticket notes'],
  ],
  reseller: [
    ['manage_reseller', 'Can manage reseller accounts'],
    ['view_reseller_reports', 'Can view reseller reports'],
  ],
  platform: [
    ['view_customer', 'Can view customer accounts'],
    ['manage_users', 'Can manage users'],
    ['manage_roles', 'Can manage roles'],
    ['view_audit_logs', 'Can view audit logs'],
    ['manage_platform_settings', 'Can manage platform settings'],
  ],
  content: [
    ['view_blog', 'Can view blog posts'],
    ['manage_blog', 'Can create, edit, and publish blog posts'],
  ],
}

export const ALL_PERMISSION_CODES = Object.values(PERMISSION_REGISTRY).flatMap((entries) => entries.map(([code]) => code))

/** apps/accounts/authorization/matrix.py (insertion order is significant: it is the role display order). */
export const ROLE_PERMISSION_MATRIX: Record<string, string[]> = {
  Customer: ['view_domain', 'register_domain', 'transfer_domain', 'renew_domain', 'view_hosting', 'view_invoice', 'view_ticket', 'view_order'],
  Support: ['view_customer', 'view_domain', 'view_hosting', 'view_ticket', 'assign_ticket', 'resolve_ticket', 'close_ticket', 'reopen_ticket', 'reply_ticket', 'add_internal_note', 'view_order'],
  Billing: ['view_customer', 'view_invoice', 'view_payment', 'view_order', 'create_invoice', 'process_payment', 'issue_refund'],
  Sales: ['view_customer', 'view_domain', 'register_domain', 'view_hosting', 'create_hosting', 'view_invoice', 'view_order', 'view_blog', 'manage_blog'],
  Reseller: ['view_customer', 'view_domain', 'register_domain', 'transfer_domain', 'renew_domain', 'manage_domain_autorenew', 'view_hosting', 'view_order', 'create_hosting', 'manage_reseller', 'view_reseller_reports'],
  'Platform Administrator': ['*'],
}

export const STAFF_ROLES = Object.keys(ROLE_PERMISSION_MATRIX).filter((role) => role !== 'Customer')

export function roleCodes(role: string): string[] {
  const codes = ROLE_PERMISSION_MATRIX[role] ?? []
  return codes.includes('*') ? [...ALL_PERMISSION_CODES].sort() : [...codes].sort()
}

/** Effective codes computed from role names, as CurrentUserSerializer/StaffUserSerializer do. */
export function matrixPermissions(roles: string[], superuser = false): string[] {
  const codes = new Set<string>()
  for (const role of roles) for (const code of roleCodes(role)) codes.add(code)
  if (superuser) for (const code of ALL_PERMISSION_CODES) codes.add(code)
  return [...codes].sort()
}

export async function userRoles(userId: string, db: Queryable = database()): Promise<string[]> {
  return (
    await query<{ name: string }>(
      'SELECT g.name FROM auth_group g JOIN accounts_user_groups ug ON ug.group_id = g.id WHERE ug.user_id = $1 ORDER BY g.name',
      [userId],
      db,
    )
  ).map((row) => row.name)
}

/**
 * Django `user.has_perm('accounts.<code>')` with ModelBackend: inactive users have nothing, active superusers
 * have everything, others hold the union of direct and group permissions stored in the database.
 */
export async function hasPerm(user: AuthUser, code: string, db: Queryable = database()): Promise<boolean> {
  if (!user.is_active) return false
  if (user.is_superuser) return true
  const rows = await query(
    `SELECT 1 FROM auth_permission p JOIN django_content_type ct ON ct.id = p.content_type_id
      WHERE ct.app_label = 'accounts' AND p.codename = $2 AND (
        p.id IN (SELECT permission_id FROM accounts_user_user_permissions WHERE user_id = $1)
        OR p.id IN (SELECT gp.permission_id FROM auth_group_permissions gp JOIN accounts_user_groups ug ON ug.group_id = gp.group_id WHERE ug.user_id = $1))
      LIMIT 1`,
    [user.id, code],
    db,
  )
  return rows.length > 0
}

/** `HasBusinessPermission`. */
export const businessPermission = (code: string): Permission => async (ctx: Context) => Boolean(ctx.user && (await hasPerm(ctx.user, code)))

/** `HasStaffBusinessPermission`: `is_staff` alone never grants a business operation. */
export const staffPermission = (code: string): Permission => async (ctx: Context) =>
  Boolean(ctx.user?.is_staff && (await hasPerm(ctx.user, code)))

/** `HasAllStaffBusinessPermissions`. */
export const allStaffPermissions = (...codes: string[]): Permission => async (ctx: Context) => {
  if (!ctx.user?.is_staff) return false
  for (const code of codes) if (!(await hasPerm(ctx.user, code))) return false
  return true
}

/**
 * `sync_permissions` management command: create missing business permissions and groups, then make each
 * group's permissions match the matrix exactly.
 */
export async function syncPermissions(db: Queryable, onlyRole?: string) {
  await db.query(
    `INSERT INTO django_content_type (app_label, model) VALUES ('accounts', 'authorizationpermission')
     ON CONFLICT (app_label, model) DO NOTHING`,
  )
  const contentType = (await query<{ id: number }>(`SELECT id FROM django_content_type WHERE app_label = 'accounts' AND model = 'authorizationpermission'`, [], db))[0].id
  let created = 0
  for (const entries of Object.values(PERMISSION_REGISTRY)) {
    for (const [code, name] of entries) {
      const result = await db.query(
        `INSERT INTO auth_permission (name, content_type_id, codename) VALUES ($1, $2, $3) ON CONFLICT (content_type_id, codename) DO NOTHING`,
        [name, contentType, code],
      )
      created += result.rowCount ?? 0
    }
  }
  const roles = onlyRole ? [[onlyRole, ROLE_PERMISSION_MATRIX[onlyRole] ?? []] as const] : Object.entries(ROLE_PERMISSION_MATRIX)
  for (const [role, codes] of roles) {
    await db.query('INSERT INTO auth_group (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [role])
    const group = (await query<{ id: number }>('SELECT id FROM auth_group WHERE name = $1', [role], db))[0].id
    await db.query('DELETE FROM auth_group_permissions WHERE group_id = $1', [group])
    await db.query(
      `INSERT INTO auth_group_permissions (group_id, permission_id)
       SELECT $1, id FROM auth_permission WHERE content_type_id = $2 AND ($3 OR codename = ANY($4))`,
      [group, contentType, codes.includes('*'), [...codes]],
    )
  }
  return created
}

/** `StaffService._get_role_group`: get or create the group and synchronise it with the matrix. */
export async function roleGroup(role: string, db: Queryable): Promise<number> {
  await syncPermissions(db, role)
  return (await query<{ id: number }>('SELECT id FROM auth_group WHERE name = $1', [role], db))[0].id
}
