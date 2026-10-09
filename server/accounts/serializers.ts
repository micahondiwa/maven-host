import 'server-only'
import type { AuthUser } from '../http/router'
import { matrixPermissions, userRoles } from '../auth/permissions'
import type { Queryable } from '../db'

/** CurrentUserSerializer */
export async function currentUser(user: AuthUser, db?: Queryable) {
  const roles = user.is_staff ? await userRoles(user.id, db) : []
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    is_active: user.is_active,
    is_email_verified: user.is_email_verified,
    date_joined: user.date_joined,
    account_type: user.is_superuser ? 'admin' : user.is_staff ? 'staff' : 'customer',
    access_planes: user.is_superuser ? ['admin', 'staff'] : user.is_staff ? ['staff'] : ['customer'],
    roles,
    permissions: user.is_staff ? matrixPermissions(roles, user.is_superuser) : [],
  }
}

/** StaffUserSerializer: permissions come from the role matrix (no superuser expansion, as in v1). */
export async function staffUser(user: AuthUser, db?: Queryable) {
  const roles = await userRoles(user.id, db)
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    is_active: user.is_active,
    is_email_verified: user.is_email_verified,
    status: !user.is_active ? (user.is_email_verified ? 'suspended' : 'invited') : 'active',
    date_joined: user.date_joined,
    roles,
    permissions: matrixPermissions(roles),
  }
}

export type ProfileRow = {
  phone_number: string
  company: string
  country: string
  city: string
  address: string
  postal_code: string
  timezone: string
  preferred_currency: string
}

export const PROFILE_FIELDS = ['phone_number', 'company', 'country', 'city', 'address', 'postal_code', 'timezone', 'preferred_currency'] as const

export function profileData(row: ProfileRow) {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, row[field]])) as ProfileRow
}

type CustomerRow = AuthUser & Partial<ProfileRow>

/** StaffCustomerListSerializer */
export function staffCustomer(row: CustomerRow) {
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    is_active: row.is_active,
    is_email_verified: row.is_email_verified,
    status: !row.is_active ? 'suspended' : !row.is_email_verified ? 'unverified' : 'active',
    company: row.company ?? null,
    country: row.country ?? null,
    date_joined: row.date_joined,
  }
}

/** StaffCustomerDetailSerializer */
export function staffCustomerDetail(row: CustomerRow, roles: string[]) {
  return {
    ...staffCustomer(row),
    phone_number: row.phone_number ?? null,
    city: row.city ?? null,
    address: row.address ?? null,
    postal_code: row.postal_code ?? null,
    timezone: row.timezone ?? null,
    preferred_currency: row.preferred_currency ?? null,
    roles,
  }
}
