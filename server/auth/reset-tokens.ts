import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { settings } from '../config'

/**
 * Django 5.2 `default_token_generator` (PasswordResetTokenGenerator, sha256) and `urlsafe_base64_encode(pk)`,
 * so reset links issued by either implementation verify in the other.
 */
const KEY_SALT = 'django.contrib.auth.tokens.PasswordResetTokenGenerator'
export const PASSWORD_RESET_TIMEOUT_SECONDS = 259_200
// Django's generator uses naive server-local time; v1 runs with TIME_ZONE=Africa/Nairobi (UTC+3, no DST).
const LOCAL_OFFSET_MS = 3 * 3600_000
const EPOCH_2001 = Date.UTC(2001, 0, 1)

type ResetUser = { id: string; password: string; last_login: Date | null; email: string }

function nowSeconds(now = Date.now()) {
  return Math.floor((now + LOCAL_OFFSET_MS - EPOCH_2001) / 1000)
}

/** `str(last_login.replace(microsecond=0, tzinfo=None))` for a UTC-aware datetime. */
function loginTimestamp(lastLogin: Date | null) {
  if (!lastLogin) return ''
  return lastLogin.toISOString().slice(0, 19).replace('T', ' ')
}

function saltedHmac(value: string, secret: string) {
  const key = createHash('sha256').update(KEY_SALT + secret).digest()
  return createHmac('sha256', key).update(value).digest('hex')
}

function tokenWithTimestamp(user: ResetUser, timestamp: number, secret: string) {
  const hash = saltedHmac(`${user.id}${user.password}${loginTimestamp(user.last_login)}${timestamp}${user.email ?? ''}`, secret)
  const halved = [...hash].filter((_, index) => index % 2 === 0).join('')
  return `${timestamp.toString(36)}-${halved}`
}

export function makeResetToken(user: ResetUser, now = Date.now()) {
  return tokenWithTimestamp(user, nowSeconds(now), settings.secretKey)
}

export function checkResetToken(user: ResetUser, token: string, now = Date.now()) {
  if (!user || !token) return false
  const [timestampText] = token.split('-')
  if (!timestampText || !/^[0-9a-z]{1,13}$/.test(timestampText)) return false
  const timestamp = Number.parseInt(timestampText, 36)
  if (!Number.isSafeInteger(timestamp)) return false
  const expected = Buffer.from(tokenWithTimestamp(user, timestamp, settings.secretKey))
  const provided = Buffer.from(token)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return false
  return nowSeconds(now) - timestamp <= PASSWORD_RESET_TIMEOUT_SECONDS
}

export function encodeUid(pk: string) {
  return Buffer.from(pk, 'utf8').toString('base64url')
}

export function decodeUid(uid: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(uid)) return null
  return Buffer.from(uid, 'base64url').toString('utf8')
}
