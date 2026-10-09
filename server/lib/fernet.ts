import 'server-only'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { settings } from '../config'

/**
 * Fernet tokens (cryptography.fernet) with v1's key derivation: urlsafe_b64(sha256(source)). Application secrets use
 * SECRET_KEY; long-lived provider credentials use FIELD_ENCRYPTION_KEY, falling back to SECRET_KEY.
 */

function keys(source: string) {
  const key = createHash('sha256').update(source, 'utf8').digest()
  return { signing: key.subarray(0, 16), encryption: key.subarray(16, 32) }
}

const fromBase64Url = (value: string) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const toBase64Url = (value: Buffer) => value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')

export function fernetEncrypt(source: string, plaintext: string, now = Date.now(), iv = randomBytes(16)) {
  const { signing, encryption } = keys(source)
  const timestamp = Buffer.alloc(8)
  timestamp.writeBigUInt64BE(BigInt(Math.floor(now / 1000)))
  const cipher = createCipheriv('aes-128-cbc', encryption, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const body = Buffer.concat([Buffer.from([0x80]), timestamp, iv, ciphertext])
  return toBase64Url(Buffer.concat([body, createHmac('sha256', signing).update(body).digest()]))
}

export function fernetDecrypt(source: string, token: string) {
  const { signing, encryption } = keys(source)
  const data = fromBase64Url(token)
  if (data.length < 57 || data[0] !== 0x80) throw new Error('Invalid Fernet token')
  const body = data.subarray(0, data.length - 32)
  const expected = createHmac('sha256', signing).update(body).digest()
  if (!timingSafeEqual(expected, data.subarray(data.length - 32))) throw new Error('Invalid Fernet token')
  const decipher = createDecipheriv('aes-128-cbc', encryption, body.subarray(9, 25))
  return Buffer.concat([decipher.update(body.subarray(25)), decipher.final()]).toString('utf8')
}

/** core.security.encrypt_secret / decrypt_secret */
export function encryptSecret(value: string) {
  if (!value) throw new Error('Secret value cannot be empty.')
  return fernetEncrypt(settings.secretKey, value)
}

export function decryptSecret(value: string) {
  try {
    return fernetDecrypt(settings.secretKey, value)
  } catch {
    throw new Error('Unable to decrypt stored secret.')
  }
}

const providerSource = () => process.env.FIELD_ENCRYPTION_KEY?.trim() || settings.secretKey

/** EncryptedTextField (provider credentials) */
export function encryptProviderSecret(value: string) {
  if (!value) throw new Error('Secret value cannot be empty.')
  return fernetEncrypt(providerSource(), value)
}

export function decryptProviderSecret(value: string) {
  try {
    return fernetDecrypt(providerSource(), value)
  } catch {
    throw new Error('Unable to decrypt stored provider secret.')
  }
}
