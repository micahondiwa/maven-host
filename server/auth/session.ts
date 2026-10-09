import 'server-only'
import { queryOne } from '../db'
import { HttpError, invalidToken } from '../http/errors'
import type { AuthUser } from '../http/router'
import { decodeToken, TokenError } from './jwt'

export const USER_COLUMNS = 'id, email, first_name, last_name, is_active, is_staff, is_superuser, is_email_verified, date_joined, password, last_login'

/** simplejwt `JWTAuthentication`: no header → anonymous; a bad token or inactive user → 401. */
export async function authenticate(request: Request): Promise<AuthUser | null> {
  const header = request.headers.get('authorization')
  if (!header) return null
  const parts = header.trim().split(/\s+/)
  if (parts[0] !== 'Bearer') return null
  if (parts.length !== 2) {
    throw new HttpError(401, { detail: 'Authorization header must contain two space-delimited values', code: 'bad_authorization_header' }, { 'WWW-Authenticate': 'Bearer realm="api"' })
  }
  let userId: string
  try {
    userId = decodeToken(parts[1], 'access').user_id
  } catch (error) {
    if (error instanceof TokenError) throw invalidToken()
    throw error
  }
  const user = await queryOne<AuthUser>(`SELECT ${USER_COLUMNS} FROM accounts_user WHERE id = $1`, [userId]).catch(() => undefined)
  if (!user) throw new HttpError(401, { detail: 'User not found', code: 'user_not_found' }, { 'WWW-Authenticate': 'Bearer realm="api"' })
  if (!user.is_active) throw new HttpError(401, { detail: 'User is inactive', code: 'user_inactive' }, { 'WWW-Authenticate': 'Bearer realm="api"' })
  return user
}
