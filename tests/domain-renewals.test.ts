import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { Registrar } from '../server/domains/types'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-renewals-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

suite('domain renewals: checkout, reconciliation, auto-renew invoices and reminders', () => {
  let api: typeof import('../server/api')
  let ip = 0
  const run = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 5)}`
  let renewPriceId: number
  let registerPriceId: number
  const registry: Record<string, string> = {}
  const renewed: string[] = []

  const nairobiToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)
  const inDays = (days: number) => new Date(Date.parse(`${nairobiToday()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const plusYear = (day: string) => `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`

  const fake = {
    slug: 'openprovider',
    getRegistrationInfo: async (domain: string) => ({ domain, is_owner: true, status: 'active', provider_domain_id: '7', expiration_date: registry[domain] ?? null }),
    renewDomain: async (domain: string, years: number) => {
      renewed.push(domain)
      const previous = registry[domain]
      registry[domain] = plusYear(previous)
      return { domain_name: domain, renewed: true, registrar: 'openprovider', previous_expiration_date: previous, new_expiration_date: registry[domain], years, order_id: '7', transaction_id: null }
    },
  }

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.1.${++ip % 250}` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function user(role: 'Customer' | 'Platform Administrator' = 'Customer') {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `renew-${role.replace(' ', '')}-${run}-${++ip}@example.test`
    const id = await transaction(async (client) => {
      const created = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: role !== 'Customer', is_email_verified: true })
      await addToGroup(client, created.id, role)
      return created.id as string
    })
    return { id, email, access: (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body.access as string }
  }

  async function domain(ownerId: string, name: string, expires: string, autoRenew = false) {
    registry[name] = expires
    const { queryOne } = await import('../server/db')
    return (await queryOne<{ id: string }>(
      `INSERT INTO domains_domain (id, domain_name, status, registration_years, registrar_order_id, registrar_transaction_id, auto_renew, locked, privacy_enabled, expires_at, created_at, updated_at, owner_id, registrar_id, tld_id)
       SELECT $1, $2, 'active', 1, '7', '', $3, false, false, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5, r.id, (SELECT id FROM domains_tld WHERE extension = '.com') FROM domains_registrar r WHERE r.slug = 'openprovider'
       RETURNING id`,
      [crypto.randomUUID(), name, autoRenew, expires, ownerId],
    ))!.id
  }

  const fulfil = async () => {
    const { processOutbox } = await import('../server/jobs/outbox')
    const { OUTBOX_HANDLERS } = await import('../server/jobs/handlers')
    await processOutbox((await import('../server/db')).database(), OUTBOX_HANDLERS, 100)
  }

  beforeAll(async () => {
    process.env.OPENPROVIDER_ENABLED = 'true'
    process.env.OPENPROVIDER_TRANSACTIONS_ENABLED = 'true'
    api = await import('../server/api')
    const { database, transaction, queryOne } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
    const domains = await import('../server/domains/service')
    await domains.seedTlds()
    await domains.seedSupplierRecords()
    await (await import('../server/pricing/engine')).seedCurrencies()
    const db = database()
    await db.query(`UPDATE domains_registrar SET is_active = true WHERE slug = 'openprovider'`)
    await db.query(`UPDATE domains_tld SET is_active = true, provider_supported = true WHERE extension = '.com'`)
    await db.query(`INSERT INTO pricing_pricingrule (name, strategy, value, is_default, is_active, created_at, updated_at) VALUES ('Standard Retail', 'percentage_markup', 25.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (name) DO NOTHING`)
    for (const [type, price] of [['register', '10.00'], ['renew', '12.00']])
      await db.query(
        `INSERT INTO domains_domainprice (price_type, years, price, last_synced_at, created_at, updated_at, currency_id, registrar_id, tld_id)
         SELECT $1, 1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM currencies_currency WHERE code = 'USD'), r.id, t.id FROM domains_registrar r, domains_tld t WHERE r.slug = 'openprovider' AND t.extension = '.com'
         ON CONFLICT (registrar_id, tld_id, price_type, years) DO UPDATE SET price = EXCLUDED.price, currency_id = EXCLUDED.currency_id`,
        [type, price],
      )
    const priceId = async (type: string) => (await queryOne<{ id: number }>(`SELECT p.id FROM domains_domainprice p JOIN domains_tld t ON t.id = p.tld_id JOIN domains_registrar r ON r.id = p.registrar_id WHERE t.extension = '.com' AND r.slug = 'openprovider' AND p.price_type = $1 AND p.years = 1`, [type]))!.id
    renewPriceId = await priceId('renew')
    registerPriceId = await priceId('register')
    ;(await import('../server/domains/registrars')).setRegistrarOverride((slug) => (slug === 'openprovider' ? (fake as unknown as Registrar) : undefined))
  })
  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())
  afterAll(async () => {
    ;(await import('../server/domains/registrars')).setRegistrarOverride(null)
    delete process.env.OPENPROVIDER_ENABLED
    delete process.env.OPENPROVIDER_TRANSACTIONS_ENABLED
    await (await import('../server/db')).database().end()
  })

  it('renews an owned domain through the cart, checkout and payment exactly once', async () => {
    const owner = await user()
    const stranger = await user()
    const admin = await user('Platform Administrator')
    const name = `renew-${run}.com`
    const expires = inDays(20)
    const id = await domain(owner.id, name, expires)

    const quote = (await call('GET', `/domains/customer/domains/${id}/renewal/`, { token: owner.access })).body
    expect(quote).toMatchObject({ renewable: true, years: 1, auto_renew: false, price: { product_id: String(renewPriceId), usd: '15.00' }, pending_order_id: null })

    const add = (token: string, body: Record<string, unknown>) => call('POST', '/orders/cart/', { token, body: { product_type: 'domain', billing_cycle: 'annually', quantity: 1, ...body } })
    expect((await add(stranger.access, { resource_id: String(renewPriceId), configuration: { operation: 'renew', domain_id: id } })).body).toEqual(['Select a domain that belongs to your account.'])
    expect((await add(owner.access, { resource_id: String(renewPriceId), configuration: { domain: `fresh-${run}.com` } })).body).toEqual(['This price is not a registration price. Renew an existing domain from your account instead.'])
    expect((await add(owner.access, { resource_id: String(registerPriceId), configuration: { operation: 'renew', domain_id: id } })).body).toEqual(['This renewal price does not apply to the selected domain.'])
    expect((await add(owner.access, { resource_id: String(renewPriceId), configuration: { operation: 'renew', domain_id: id } })).status).toBe(201)
    expect((await add(owner.access, { resource_id: String(renewPriceId), configuration: { operation: 'renew', domain_id: id } })).body).toEqual([`A renewal for ${name} is already in your cart.`])

    // A renewal-only cart needs no registrant contact.
    const checkout = await call('POST', '/orders/checkout/', { token: owner.access, body: {} })
    expect(checkout.status).toBe(201)
    expect((await call('GET', `/domains/customer/domains/${id}/renewal/`, { token: owner.access })).body.pending_order_id).toBe(checkout.body.order_id)
    const paid = await call('POST', `/staff/customers/${owner.id}/invoices/${checkout.body.invoice_id}/payments/`, { token: admin.access, body: { amount: '15.00', method: 'bank_transfer', customer_reference: `RENEW-${run}` } })
    expect(paid.status).toBe(201)
    await fulfil()
    await fulfil()
    expect(renewed.filter((item) => item === name)).toHaveLength(1)
    expect((await call('GET', `/orders/${checkout.body.order_id}/`, { token: owner.access })).body.order.status).toBe('completed')
    expect((await call('GET', `/domains/customer/domains/${id}/`, { token: owner.access })).body.expires_at).toBe(plusYear(expires))

    // With the supplier switched off the domain is shown as not renewable online instead of failing.
    process.env.OPENPROVIDER_TRANSACTIONS_ENABLED = 'false'
    try {
      expect((await call('GET', `/domains/customer/domains/${id}/renewal/`, { token: owner.access })).body).toMatchObject({ renewable: false, price: null })
    } finally {
      process.env.OPENPROVIDER_TRANSACTIONS_ENABLED = 'true'
    }
  }, 120_000)

  it('reconciles a renewal the registry already applied instead of renewing again', async () => {
    const owner = await user()
    const name = `reconcile-${run}.com`
    const expires = inDays(25)
    const id = await domain(owner.id, name, expires)
    const { queryOne } = await import('../server/db')
    const { createRenewalOrder } = await import('../server/orders/service')
    const order = (await createRenewalOrder(owner.id, id, 'USD'))!
    // Simulate an earlier attempt that renewed at the registry but did not record it locally.
    registry[name] = plusYear(expires)
    const { recordManualPayment } = await import('../server/billing/service')
    await recordManualPayment({ invoiceId: order.invoice_id, amount: '15.00', method: 'bank_transfer' })
    await fulfil()
    expect(renewed).not.toContain(name)
    const item = await queryOne<{ provisioning_snapshot: Record<string, unknown> }>(`SELECT provisioning_snapshot FROM orders_order_item WHERE order_id = $1`, [order.order_id])
    expect(item?.provisioning_snapshot).toMatchObject({ operation: 'domain_renewal', recovered: true, expires_at: plusYear(expires) })
  }, 120_000)

  it('issues one auto-renew invoice and one reminder per threshold, and notices expiry once', async () => {
    const owner = await user()
    const auto = await domain(owner.id, `auto-${run}.com`, inDays(10), true)
    const remind = await domain(owner.id, `remind-${run}.com`, inDays(5))
    const lapsed = await domain(owner.id, `lapsed-${run}.com`, inDays(-3))
    expect((await call('PUT', `/domains/customer/domains/${remind}/auto-renew/`, { token: owner.access, body: { enabled: false } })).body).toMatchObject({ auto_renew: false })

    const { sentEmails } = await import('../server/communications/email')
    const before = sentEmails().length
    const { processDomainRenewals } = await import('../server/domains/renewals')
    await processDomainRenewals()
    await processDomainRenewals()
    const mine = sentEmails().slice(before).filter((message) => message.to[0] === owner.email).map((message) => message.subject)
    expect(mine.sort()).toEqual([
      `Renewal invoice for auto-${run}.com`,
      `auto-${run}.com expires in 10 days`,
      `lapsed-${run}.com has expired`,
      `remind-${run}.com expires in 5 days`,
    ].sort())

    const { query } = await import('../server/db')
    const notices = await query<{ domain_id: string; kind: string }>(`SELECT domain_id, kind FROM domains_renewalnotice WHERE domain_id = ANY($1) ORDER BY kind`, [[auto, remind, lapsed]])
    expect(notices.filter((row) => row.domain_id === remind).map((row) => row.kind)).toEqual(['reminder_30', 'reminder_7'])
    expect(notices.filter((row) => row.domain_id === auto).map((row) => row.kind).sort()).toEqual(['auto_invoice', 'reminder_30'])
    expect(notices.filter((row) => row.domain_id === lapsed).map((row) => row.kind)).toEqual(['expired'])
    const orders = await query(`SELECT o.status FROM orders_order o JOIN orders_order_item i ON i.order_id = o.id WHERE i.configuration ->> 'domain_id' = $1`, [auto])
    expect(orders).toEqual([{ status: 'pending_payment' }])
  }, 120_000)
})
