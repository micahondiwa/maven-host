import 'server-only'
import { HttpError } from './errors'
import { settings } from '../config'

/**
 * DRF ScopedRateThrottle with v1's process-local cache semantics: a sliding window of request timestamps per
 * scope and client, `Retry-After` on rejection.
 */
const history = new Map<string, number[]>()
const PERIODS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

export function parseRate(rate: string): { count: number; seconds: number } {
  const [count, period] = rate.split('/')
  return { count: Number.parseInt(count, 10), seconds: PERIODS[period.trim()[0]] }
}

export function checkThrottle(scope: string, ident: string, now = Date.now() / 1000) {
  const rate = settings.throttleRate(scope)
  if (!rate) return
  const { count, seconds } = parseRate(rate)
  const key = `throttle_${scope}_${ident}`
  const entries = (history.get(key) ?? []).filter((timestamp) => timestamp > now - seconds)
  if (entries.length >= count) {
    const wait = Math.max(Math.ceil(seconds - (now - entries[entries.length - 1])), 0)
    history.set(key, entries)
    throw new HttpError(
      429,
      { detail: `Request was throttled. Expected available in ${wait} second${wait === 1 ? '' : 's'}.` },
      { 'Retry-After': String(wait) },
    )
  }
  entries.unshift(now)
  history.set(key, entries)
  if (history.size > 50_000) pruneThrottles(now)
}

function pruneThrottles(now: number) {
  for (const [key, entries] of history) if (!entries.length || entries[0] < now - 86400) history.delete(key)
}

export function resetThrottles() {
  history.clear()
}
