import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { settings } from '../config'

/**
 * django.core.signing (Django 5.2, sha256): `TimestampSigner.sign/unsign` and `dumps/loads`, so values signed by v1
 * (OAuth state, anonymous AI visitor tokens) stay valid after cutover.
 */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export class BadSignature extends Error {}
export class SignatureExpired extends BadSignature {}

function b62Encode(value: number) {
  if (value === 0) return '0'
  let output = ''
  let remaining = value
  while (remaining > 0) {
    output = B62[remaining % 62] + output
    remaining = Math.floor(remaining / 62)
  }
  return output
}

function b62Decode(value: string) {
  let result = 0
  for (const char of value) {
    const digit = B62.indexOf(char)
    if (digit < 0) throw new BadSignature('Malformed timestamp')
    result = result * 62 + digit
  }
  return result
}

function signature(value: string, salt: string, secret: string) {
  const key = createHash('sha256').update(`${salt}signer${secret}`).digest()
  return createHmac('sha256', key).update(value).digest('base64url')
}

export function timestampSign(value: string, salt: string, now = Date.now()) {
  const signed = `${value}:${b62Encode(Math.floor(now / 1000))}`
  return `${signed}:${signature(signed, salt, settings.secretKey)}`
}

export function timestampUnsign(signed: string, salt: string, maxAgeSeconds?: number, now = Date.now()) {
  const sigIndex = signed.lastIndexOf(':')
  if (sigIndex < 0) throw new BadSignature('No ":" found in value')
  const value = signed.slice(0, sigIndex)
  const provided = Buffer.from(signed.slice(sigIndex + 1))
  const expected = Buffer.from(signature(value, salt, settings.secretKey))
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new BadSignature('Signature does not match')
  const tsIndex = value.lastIndexOf(':')
  if (tsIndex < 0) throw new BadSignature('No timestamp found')
  const timestamp = b62Decode(value.slice(tsIndex + 1))
  if (maxAgeSeconds !== undefined && now / 1000 - timestamp > maxAgeSeconds) throw new SignatureExpired('Signature age exceeds the maximum')
  return value.slice(0, tsIndex)
}

/** `signing.dumps(obj, salt=...)` without compression (compressed payloads from v1 are not produced for small objects). */
export function dumps(value: unknown, salt: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  return timestampSign(payload, salt, now)
}

export function loads<T = unknown>(token: string, salt: string, maxAgeSeconds?: number, now = Date.now()): T {
  const payload = timestampUnsign(token, salt, maxAgeSeconds, now)
  if (payload.startsWith('.')) throw new BadSignature('Compressed signed payloads are not supported')
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T
  } catch {
    throw new BadSignature('Malformed signed payload')
  }
}
