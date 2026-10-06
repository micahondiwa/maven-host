import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
const derive = promisify(pbkdf2)
export async function verifyDjangoPassword(password: string, encoded: string): Promise<boolean> {
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
 const iterations=1_200_000,salt=randomBytes(18).toString('base64url')
 const hash=await derive(password,salt,iterations,32,'sha256')
 return `pbkdf2_sha256$${iterations}$${salt}$${hash.toString('base64')}`
}
