import 'server-only'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { settings } from '../config'
import { database, queryOne, transaction, type Queryable } from '../db'

/**
 * djangorestframework-simplejwt compatible tokens (HS256 with SECRET_KEY, `token_type`/`exp`/`iat`/`jti`/`user_id`
 * claims, outstanding/blacklist tables), so sessions issued by v1 remain valid after cutover and vice versa.
 */
export const ACCESS_LIFETIME_SECONDS = 15 * 60
export const REFRESH_LIFETIME_SECONDS = 7 * 24 * 3600

export type TokenPayload = { token_type: 'access' | 'refresh'; exp: number; iat: number; jti: string; user_id: string; [claim: string]: unknown }

export class TokenError extends Error {}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')
const now = () => Math.floor(Date.now() / 1000)
const newJti = () => randomUUID().replace(/-/g, '')

function sign(payload: TokenPayload, secret = settings.secretKey): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export function decodeToken(token: string, expectedType: 'access' | 'refresh', secret = settings.secretKey): TokenPayload {
  const parts = token.split('.')
  if (parts.length !== 3) throw new TokenError('Token is invalid')
  const [header, body, signature] = parts
  let parsedHeader: { alg?: string }
  let payload: TokenPayload
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw new TokenError('Token is invalid')
  }
  if (parsedHeader.alg !== 'HS256') throw new TokenError('Token is invalid')
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest()
  const provided = Buffer.from(signature, 'base64url')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new TokenError('Token is invalid')
  if (typeof payload.exp !== 'number' || payload.exp <= now()) throw new TokenError('Token is expired')
  if (payload.token_type !== expectedType) throw new TokenError('Token has wrong type')
  if (!payload.jti) throw new TokenError('Token has no id')
  if (!payload.user_id) throw new TokenError('Token contained no recognizable user identification')
  return payload
}

function accessFor(refresh: TokenPayload): string {
  const issued = now()
  const claims = { ...refresh }
  delete (claims as Partial<TokenPayload>).exp
  return sign({ ...claims, token_type: 'access', exp: issued + ACCESS_LIFETIME_SECONDS, iat: issued, jti: newJti() } as TokenPayload)
}

async function outstand(payload: TokenPayload, token: string, db: Queryable) {
  await db.query(
    `INSERT INTO token_blacklist_outstandingtoken (token, created_at, expires_at, user_id, jti)
     VALUES ($1, to_timestamp($2), to_timestamp($3), $4, $5) ON CONFLICT (jti) DO NOTHING`,
    [token, payload.iat, payload.exp, payload.user_id, payload.jti],
  )
}

/** `RefreshToken.for_user(user)` followed by `str(refresh.access_token)`. */
export async function issueTokens(userId: string, db: Queryable = database()) {
  const issued = now()
  const payload: TokenPayload = { token_type: 'refresh', exp: issued + REFRESH_LIFETIME_SECONDS, iat: issued, jti: newJti(), user_id: userId }
  const refresh = sign(payload)
  await outstand(payload, refresh, db)
  return { access: accessFor(payload), refresh }
}

async function isBlacklisted(jti: string, db: Queryable) {
  return Boolean(
    await queryOne(
      `SELECT 1 FROM token_blacklist_blacklistedtoken b JOIN token_blacklist_outstandingtoken o ON o.id = b.token_id WHERE o.jti = $1`,
      [jti],
      db,
    ),
  )
}

async function blacklist(payload: TokenPayload, token: string, db: Queryable) {
  await outstand(payload, token, db)
  await db.query(
    `INSERT INTO token_blacklist_blacklistedtoken (blacklisted_at, token_id)
     SELECT CURRENT_TIMESTAMP, id FROM token_blacklist_outstandingtoken WHERE jti = $1 ON CONFLICT (token_id) DO NOTHING`,
    [payload.jti],
  )
}

/** Verifies a refresh token, including the blacklist check performed by `RefreshToken(token)`. */
export async function verifyRefresh(token: string, db: Queryable = database()): Promise<TokenPayload> {
  const payload = decodeToken(token, 'refresh')
  if (await isBlacklisted(payload.jti, db)) throw new TokenError('Token is blacklisted')
  return payload
}

/** `TokenRefreshSerializer` with ROTATE_REFRESH_TOKENS and BLACKLIST_AFTER_ROTATION. */
export async function rotateRefresh(token: string): Promise<{ access: string; refresh: string }> {
  return transaction(async (client) => {
    const payload = await verifyRefresh(token, client)
    const user = await queryOne<{ is_active: boolean }>('SELECT is_active FROM accounts_user WHERE id = $1', [payload.user_id], client)
    if (!user?.is_active) throw new TokenError('No active account found for the given credentials')
    const access = accessFor(payload)
    await blacklist(payload, token, client)
    const issued = now()
    const rotated: TokenPayload = { ...payload, jti: newJti(), exp: issued + REFRESH_LIFETIME_SECONDS, iat: issued }
    const refresh = sign(rotated)
    await outstand(rotated, refresh, client)
    return { access, refresh }
  })
}

/** `RefreshToken(token).blacklist()`. */
export async function blacklistRefresh(token: string) {
  const payload = await verifyRefresh(token)
  await blacklist(payload, token, database())
}

export async function deleteExpiredTokens(db: Queryable = database()) {
  // simplejwt `flushexpiredtokens`; the ORM cascaded to blacklist rows, the database constraint does not.
  await db.query('DELETE FROM token_blacklist_blacklistedtoken WHERE token_id IN (SELECT id FROM token_blacklist_outstandingtoken WHERE expires_at <= CURRENT_TIMESTAMP)')
  return (await db.query('DELETE FROM token_blacklist_outstandingtoken WHERE expires_at <= CURRENT_TIMESTAMP')).rowCount
}

