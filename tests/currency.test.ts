import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-currency-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

suite('display and payment currencies', () => {
  let api: typeof import('../server/api')
  let ip = 0

  async function call(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.8.${++ip % 250}`, ...options.headers }
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  beforeAll(async () => {
    api = await import('../server/api')
    await (await import('../server/pricing/engine')).seedCurrencies()
  })
  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())
  afterAll(async () => (await import('../server/db')).database().end())

  it('syncs East African rates with the provider timestamp and publishes USD as the default', async () => {
    const { synchronizeExchangeRates } = await import('../server/pricing/engine')
    const updatedAt = new Date('2026-10-09T00:02:31Z')
    const result = await synchronizeExchangeRates(async (base) => {
      expect(base).toBe('USD')
      return { rates: { USD: 1, KES: 129.5, UGX: 3981.202747, TZS: 2618.547243, RWF: 1477.829021, EUR: 0.86, GBP: 0.756516, ZZZ: 2 }, updatedAt }
    })
    expect(result.skipped).toBe(1)
    const body = (await call('GET', '/currencies/')).body
    expect(body).toMatchObject({ base: 'USD', default: 'USD', payment_currencies: ['USD', 'KES'], attribution: { label: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' } })
    expect(body.currencies.map((currency: { code: string }) => currency.code)).toEqual(['USD', 'KES', 'UGX', 'TZS', 'RWF', 'EUR', 'GBP'])
    expect(body.currencies[0]).toMatchObject({ code: 'USD', payment: true, rate: '1', rate_updated_at: null })
    expect(body.currencies[2]).toMatchObject({ code: 'UGX', symbol: 'USh', decimal_places: 0, payment: false, rate: '3981.20274700', rate_updated_at: '2026-10-09T03:02:31+03:00' })
  })

  it('keeps one charge currency per cart and never charges in a display-only currency', async () => {
    const { query } = await import('../server/db')
    const prices = await query<{ id: number; slug: string; code: string }>(
      `SELECT p.id, h.slug, c.code FROM hosting_hostingplanprice p JOIN hosting_hostingplan h ON h.id = p.hosting_plan_id JOIN currencies_currency c ON c.id = p.currency_id
        WHERE h.slug IN ('cloud-starter', 'cloud-business') AND p.billing_cycle = 'annually' AND p.is_active`,
    )
    const price = (slug: string, code: string) => String(prices.find((row) => row.slug === slug && row.code === code)!.id)
    const guest = { 'X-Guest-Cart-Token': `guest-currency-${Date.now()}-${'y'.repeat(40)}` }
    const add = (resource: string, currency?: string) => call('POST', '/orders/cart/', { headers: guest, body: { product_type: 'hosting', resource_id: resource, billing_cycle: 'annually', quantity: 1, configuration: {}, ...(currency ? { currency } : {}) } })

    expect((await add(price('cloud-starter', 'KES'))).status).toBe(201)
    expect((await add(price('cloud-business', 'USD'))).body).toEqual(['Your cart is priced in KES. Switch to KES to add this item, or empty your cart first.'])
    expect((await add(price('cloud-business', 'KES'))).status).toBe(201)
    const cart = (await call('GET', '/orders/cart/', { headers: guest })).body
    expect(cart).toMatchObject({ currency: 'KES', total: '11698.00' })
    expect((await add(price('cloud-business', 'USD'), 'UGX')).body).toEqual({ currency: ['"UGX" is not a valid choice.'] })
  })
})
