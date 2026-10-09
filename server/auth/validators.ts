import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * Django AUTH_PASSWORD_VALIDATORS as configured in v1: user-attribute similarity (0.7), minimum length 8,
 * common passwords (Django's bundled list) and entirely-numeric passwords.
 */
let commonPasswords: Set<string> | undefined

function loadCommonPasswords() {
  if (!commonPasswords) {
    const file = join(process.cwd(), 'server', 'auth', 'common-passwords.txt.gz')
    commonPasswords = new Set(gunzipSync(readFileSync(file)).toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean))
  }
  return commonPasswords
}

/** difflib.SequenceMatcher.quick_ratio */
function quickRatio(a: string, b: string): number {
  const counts = new Map<string, number>()
  for (const char of b) counts.set(char, (counts.get(char) ?? 0) + 1)
  let matches = 0
  for (const char of a) {
    const available = counts.get(char) ?? 0
    if (available > 0) {
      matches++
      counts.set(char, available - 1)
    }
  }
  return a.length + b.length ? (2 * matches) / (a.length + b.length) : 1
}

const MAX_SIMILARITY = 0.7

function exceedsMaximumLengthRatio(password: string, value: string) {
  const passwordLength = [...password].length
  const valueLength = [...value].length
  return passwordLength >= 10 * valueLength && valueLength < (MAX_SIMILARITY / 2) * passwordLength
}

export type PasswordUser = { email?: string; first_name?: string; last_name?: string }

export function passwordValidationErrors(password: string, user?: PasswordUser): string[] {
  const errors: string[] = []
  if (user) {
    const attributes: [string, string | undefined][] = [
      ['email address', user.email],
      ['first name', user.first_name],
      ['last name', user.last_name],
    ]
    for (const [label, raw] of attributes) {
      if (!raw) continue
      const value = raw.toLowerCase()
      const parts = [...value.split(/[^\p{L}\p{N}_]+/u), value]
      if (parts.some((part) => !exceedsMaximumLengthRatio(password, part) && quickRatio(password.toLowerCase(), part) >= MAX_SIMILARITY)) {
        errors.push(`The password is too similar to the ${label}.`)
        break
      }
    }
  }
  if ([...password].length < 8) errors.push('This password is too short. It must contain at least 8 characters.')
  if (loadCommonPasswords().has(password.toLowerCase().trim())) errors.push('This password is too common.')
  if (/^\d+$/.test(password)) errors.push('This password is entirely numeric.')
  return errors
}
