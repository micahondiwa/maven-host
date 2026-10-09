import { pbkdf2, randomInt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
const derive = promisify(pbkdf2)

/** Django 5.2 PBKDF2PasswordHasher.iterations; hashes stay interchangeable with v1 for rollback. */
export const PBKDF2_ITERATIONS = 1_000_000
const SALT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const UNUSABLE_PREFIX = '!'

function randomString(length: number) {
 let value=''
 for(let i=0;i<length;i++)value+=SALT_CHARS[randomInt(SALT_CHARS.length)]
 return value
}

export async function verifyDjangoPassword(password: string, encoded: string): Promise<boolean> {
 if(!encoded || encoded.startsWith(UNUSABLE_PREFIX)) return false
 const [algorithm, rounds, salt, hash, ...rest] = encoded.split('$')
 if(rest.length || !['pbkdf2_sha256','pbkdf2_sha1'].includes(algorithm) || !/^\d+$/.test(rounds ?? '') || !salt || !hash) return false
 const iterations=Number(rounds)
 if(!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false
 const digest=algorithm==='pbkdf2_sha256'?'sha256':'sha1'
 const expected=Buffer.from(hash,'base64')
 if(expected.length !== (digest==='sha256'?32:20) || expected.toString('base64')!==hash) return false
 const actual=await derive(password,salt,iterations,expected.length,digest)
 return timingSafeEqual(actual,expected)
}

export async function hashPassword(password: string): Promise<string> {
 const salt=randomString(22)
 const hash=await derive(password,salt,PBKDF2_ITERATIONS,32,'sha256')
 return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt}$${hash.toString('base64')}`
}

/** Django re-hashes on successful login when the preferred algorithm or work factor changed. */
export function passwordNeedsUpgrade(encoded: string): boolean {
 const [algorithm, rounds] = encoded.split('$')
 return algorithm!=='pbkdf2_sha256' || Number(rounds)!==PBKDF2_ITERATIONS
}

/** `set_unusable_password()`. */
export function unusablePassword(): string {
 return UNUSABLE_PREFIX+randomString(40)
}

export function hasUsablePassword(encoded: string): boolean {
 return Boolean(encoded) && !encoded.startsWith(UNUSABLE_PREFIX)
}
