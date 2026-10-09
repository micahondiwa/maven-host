import 'server-only'
import { randomUUID } from 'node:crypto'
import { queryOne, type Queryable } from '../db'
import { hashPassword, unusablePassword } from '../auth/passwords'
import { USER_COLUMNS } from '../auth/session'
import type { AuthUser } from '../http/router'

/** `BaseUserManager.normalize_email`: lower-case the domain part only. */
export function normalizeEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return email
  return `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}`
}

export type NewUser = {
  email: string
  password?: string | null
  first_name?: string
  last_name?: string
  is_staff?: boolean
  is_superuser?: boolean
  is_active?: boolean
  is_email_verified?: boolean
}

/**
 * `UserManager.create_user` plus the post_save signal that creates the profile. Every column is written because the
 * Django schema has no database defaults.
 */
export async function createUser(db: Queryable, input: NewUser): Promise<AuthUser> {
  const password = input.password ? await hashPassword(input.password) : unusablePassword()
  const user = (await queryOne<AuthUser>(
    `INSERT INTO accounts_user (id, password, last_login, is_superuser, email, first_name, last_name, is_staff, is_active, is_email_verified, date_joined)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP) RETURNING ${USER_COLUMNS}`,
    [
      randomUUID(),
      password,
      input.is_superuser ?? false,
      normalizeEmail(input.email),
      input.first_name ?? '',
      input.last_name ?? '',
      input.is_staff ?? false,
      input.is_active ?? true,
      input.is_email_verified ?? false,
    ],
    db,
  ))!
  await ensureProfile(db, user.id)
  return user
}

export async function ensureProfile(db: Queryable, userId: string) {
  await db.query(
    `INSERT INTO accounts_profile (phone_number, company, country, city, address, postal_code, timezone, preferred_currency, avatar, created_at, updated_at, user_id)
     SELECT '', '', '', '', '', '', 'UTC', 'USD', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $1
     WHERE NOT EXISTS (SELECT 1 FROM accounts_profile WHERE user_id = $1)`,
    [userId],
  )
}

export async function addToGroup(db: Queryable, userId: string, groupName: string, create = false) {
  if (create) await db.query('INSERT INTO auth_group (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [groupName])
  const group = await queryOne<{ id: number }>('SELECT id FROM auth_group WHERE name = $1', [groupName], db)
  if (!group) throw new Error(`Group matching query does not exist: ${groupName}`)
  await db.query('INSERT INTO accounts_user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT (user_id, group_id) DO NOTHING', [userId, group.id])
}

export async function findUserById(id: string, db?: Queryable) {
  return queryOne<AuthUser>(`SELECT ${USER_COLUMNS} FROM accounts_user WHERE id = $1`, [id], db)
}

export async function findUserByEmail(email: string, db?: Queryable) {
  return queryOne<AuthUser>(`SELECT ${USER_COLUMNS} FROM accounts_user WHERE email = $1`, [email], db)
}

export async function findUserByEmailInsensitive(email: string, db?: Queryable) {
  return queryOne<AuthUser>(`SELECT ${USER_COLUMNS} FROM accounts_user WHERE upper(email) = upper($1) ORDER BY date_joined LIMIT 1`, [email], db)
}

export async function updateUser(db: Queryable, id: string, changes: Record<string, unknown>) {
  const entries = Object.entries(changes)
  if (!entries.length) return
  const allowed = new Set(['password', 'first_name', 'last_name', 'is_active', 'is_staff', 'is_superuser', 'is_email_verified', 'last_login', 'email'])
  for (const [key] of entries) if (!allowed.has(key)) throw new Error(`Unexpected user column ${key}`)
  await db.query(
    `UPDATE accounts_user SET ${entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')} WHERE id = $1`,
    [id, ...entries.map(([, value]) => value)],
  )
}

