import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import fernetFixture from './fixtures/fernet.json'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-commerce-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

describe('application secret encryption', () => {
  it('decrypts Fernet tokens produced by v1 (Python cryptography)', async () => {
    const { fernetDecrypt, fernetEncrypt } = await import('../server/lib/fernet')
    expect(fernetDecrypt('synthetic-fernet-source', fernetFixture.token)).toBe(fernetFixture.plain)
    expect(fernetDecrypt('synthetic-fernet-source', fernetEncrypt('synthetic-fernet-source', 'round trip'))).toBe('round trip')
    expect(() => fernetDecrypt('other-source', fernetFixture.token)).toThrow()
  })
})

suite('cart, checkout, payment and fulfillment', () => {
  let api: typeof import('../server/api')
  let ip = 0
  const run = Date.now().toString(36)
  const PAYSTACK_SECRET = 'sk_test_synthetic'
  const realFetch = globalThis.fetch

  async function call(method: string, path: string, options: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.3.${++ip % 250}`, ...options.headers }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function account(staff = false) {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `buyer-${run}-${Math.random().toString(16).slice(2)}@example.test`
    await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: staff, is_email_verified: true })
      await addToGroup(client, user.id, staff ? 'Platform Administrator' : 'Customer')
      await client.query(`UPDATE accounts_profile SET phone_number = '0712345678' WHERE user_id = $1`, [user.id])
    })
    const login = (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body
    return { access: login.access as string, id: login.user.id as string, email }
  }

  const contact = { first_name: 'Ada', last_name: 'Buyer', email: 'ada@example.test', phone: '+254712345678', address1: 'Karen Road', city: 'Nairobi', state: 'Nairobi', postal_code: '00101', country: 'KE', street_number: '12', phone_country_code: '254', phone_area_code: '712', phone_subscriber_number: '345678' }

  let comPriceId: number

  beforeAll(async () => {
    process.env.OPENPROVIDER_ENABLED = 'true'
    process.env.OPENPROVIDER_TRANSACTIONS_ENABLED = 'true'
    api = await import('../server/api')
    const { database, transaction, queryOne } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
    const db = database()
    const { seedTlds, seedSupplierRecords } = await import('../server/domains/service')
    const { seedCurrencies } = await import('../server/pricing/engine')
    await seedTlds()
    await seedSupplierRecords()
    await seedCurrencies()
    await db.query(`UPDATE domains_registrar SET is_active = true WHERE slug = 'openprovider'`)
    await db.query(`INSERT INTO pricing_pricingrule (name, strategy, value, is_default, is_active, created_at, updated_at) VALUES ('Standard Retail', 'percentage_markup', 25.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (name) DO NOTHING`)
    await db.query(`INSERT INTO currencies_exchangerate (rate, updated_at, base_currency_id, target_currency_id) SELECT 129.50, CURRENT_TIMESTAMP, u.id, k.id FROM currencies_currency u, currencies_currency k WHERE u.code = 'USD' AND k.code = 'KES' ON CONFLICT (base_currency_id, target_currency_id) DO UPDATE SET rate = 129.50`)
    await db.query(
      `INSERT INTO domains_domainprice (price_type, years, price, last_synced_at, created_at, updated_at, currency_id, registrar_id, tld_id)
       SELECT 'register', 1, 10.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM currencies_currency WHERE code = 'USD'), r.id, t.id FROM domains_registrar r, domains_tld t WHERE r.slug = 'openprovider' AND t.extension = '.com'
       ON CONFLICT (registrar_id, tld_id, price_type, years) DO UPDATE SET price = 10.00`,
    )
    comPriceId = (await queryOne<{ id: number }>(`SELECT p.id FROM domains_domainprice p JOIN domains_tld t ON t.id = p.tld_id JOIN domains_registrar r ON r.id = p.registrar_id WHERE t.extension = '.com' AND r.slug = 'openprovider' AND p.price_type = 'register' AND p.years = 1`))!.id
    const { encryptProviderSecret } = await import('../server/lib/fernet')
    for (const [slug, provider, credentials] of [
      ['test-paystack', 'paystack', { secret_key: PAYSTACK_SECRET }],
      ['test-manual', 'manual', {}],
      ['test-mpesa', 'mpesa', { consumer_key: 'k', consumer_secret: 's', shortcode: '600000', passkey: 'p', reconciliation_token: 'c2b-secret-token' }],
    ] as const) {
      await db.query(
        `INSERT INTO billing_payment_gateway (id, name, slug, provider, sandbox, is_active, is_default, callback_url, webhook_url, reconciliation_url, paybill_number, manual_payment_instructions, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $1, $2, true, true, false, 'http://localhost:3000/payments/callback', '', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (slug) DO NOTHING`.replace('gen_random_uuid()', `'${crypto.randomUUID()}'`),
        [slug, provider],
      )
      const gateway = (await queryOne<{ id: string }>('SELECT id FROM billing_payment_gateway WHERE slug = $1', [slug]))!
      for (const [key, value] of Object.entries(credentials))
        await db.query(
          `INSERT INTO billing_payment_gateway_credential (id, key, value, is_secret, created_at, updated_at, gateway_id) VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4)
           ON CONFLICT (gateway_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [crypto.randomUUID(), key, encryptProviderSecret(value), gateway.id],
        )
    }
    const { setRegistrarOverride } = await import('../server/domains/registrars')
    setRegistrarOverride((slug) => slug !== 'openprovider' ? undefined : ({
      slug,
      checkDomains: async (names) => names.map((domain) => ({ domain, available: true, premium: false, registrar: slug })),
      registerDomain: async (request) => ({ success: true, registrar: slug, domain: request.domain, order_id: '501', transaction_id: null, expiration_date: '2027-10-09', message: '', pending: false }),
      getRegistrationInfo: async (domain) => ({ domain, is_owner: false, status: 'not_found', provider_domain_id: null, expiration_date: null }),
    } as never))
  })

  beforeEach(async () => {
    ;(await import('../server/http/throttle')).resetThrottles()
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://api.paystack.co/transaction/initialize')) {
        const body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ status: true, message: 'ok', data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, access_code: 'x', reference: body.reference } }))
      }
      return realFetch(input, init)
    }) as typeof fetch
  })

  afterAll(async () => {
    globalThis.fetch = realFetch
    ;(await import('../server/domains/registrars')).setRegistrarOverride(null)
    delete process.env.OPENPROVIDER_ENABLED
    delete process.env.OPENPROVIDER_TRANSACTIONS_ENABLED
    await (await import('../server/db')).database().end()
  })

  async function domainCheckout(buyer: { access: string }, domain: string, currency = 'USD') {
    const added = await call('POST', '/orders/cart/', { token: buyer.access, body: { product_type: 'domain', resource_id: String(comPriceId), billing_cycle: 'annually', quantity: 1, configuration: { domain }, currency } })
    expect(added.status).toBe(201)
    const checkout = await call('POST', '/orders/checkout/', { token: buyer.access, body: { domain_contact: contact } })
    expect(checkout.status).toBe(201)
    return checkout.body as { order_id: string; invoice_id: string; order_number: string; invoice_number: string }
  }

  it('keeps a guest cart and merges it into the customer cart at sign-in', async () => {
    const guest = { 'X-Guest-Cart-Token': `guest-${run}-${'x'.repeat(40)}` }
    expect((await call('GET', '/orders/cart/')).body).toEqual({ guest_cart: ['A guest cart token is required.'] })
    expect((await call('POST', '/orders/cart/', { headers: guest, body: { product_type: 'domain', resource_id: String(comPriceId), billing_cycle: 'annually', quantity: 2, configuration: { domain: `guest-${run}.com` } } })).body).toEqual(['Domain purchases must have quantity 1.'])
    await call('POST', '/orders/cart/', { headers: guest, body: { product_type: 'domain', resource_id: String(comPriceId), billing_cycle: 'annually', quantity: 1, configuration: { domain: `Guest-${run}.COM` } } })
    const cart = (await call('GET', '/orders/cart/', { headers: guest })).body
    expect(cart).toMatchObject({ subtotal: '12.50', tax: '0.00', total: '12.50', items: [{ name: '.com', unit_price: '12.50', checkout_blocked: false }] })
    const buyer = await account()
    const merged = (await call('GET', '/orders/cart/', { token: buyer.access, headers: guest })).body
    expect(merged.items).toHaveLength(1)
    expect((await call('GET', '/orders/cart/', { headers: guest })).body.items).toHaveLength(0)
  }, 60_000)

  it('checks out, pays by Paystack webhook, fulfils through the outbox and notifies the customer', async () => {
    const buyer = await account()
    const domain = `paid-${run}.com`
    const order = await domainCheckout(buyer, domain)
    expect(order.order_number).toMatch(/^ORD-\d{4}-\d{6}$/)
    expect((await call('GET', `/billing/invoices/${order.invoice_id}/`, { token: buyer.access })).body.invoice).toMatchObject({ status: 'issued', total: '12.50', balance: '12.50', currency: 'USD' })
    expect((await call('GET', '/orders/cart/', { token: buyer.access })).body.items).toEqual([])

    const initiated = await call('POST', `/billing/invoices/${order.invoice_id}/payments/`, { token: buyer.access, body: { gateway_slug: 'test-paystack', idempotency_key: `pay-${run}` } })
    expect(initiated.body).toMatchObject({ status: 'authorized', amount: '12.50', authorization_url: expect.stringContaining('checkout.paystack.com') })
    expect((await call('POST', `/billing/invoices/${order.invoice_id}/payments/`, { token: buyer.access, body: { gateway_slug: 'test-paystack', idempotency_key: `pay-${run}` } })).body.transaction_id).toBe(initiated.body.transaction_id)

    const event = JSON.stringify({ event: 'charge.success', data: { reference: initiated.body.provider_reference, amount: 1250, currency: 'USD', status: 'success' } })
    expect((await call('POST', '/billing/webhooks/test-paystack/', { raw: event, headers: { 'x-paystack-signature': 'bad' } })).body).toEqual({ detail: 'Invalid Paystack webhook signature.' })
    const signature = createHmac('sha512', PAYSTACK_SECRET).update(event).digest('hex')
    const hook = await call('POST', '/billing/webhooks/test-paystack/', { raw: event, headers: { 'x-paystack-signature': signature } })
    expect(hook.body).toMatchObject({ successful: true, status: 'completed' })
    expect((await call('GET', `/billing/invoices/${order.invoice_id}/`, { token: buyer.access })).body.invoice).toMatchObject({ status: 'paid', paid_amount: '12.50', balance: '0.00' })
    expect((await call('GET', `/orders/${order.order_id}/`, { token: buyer.access })).body.order.status).toBe('paid')
    expect((await call('POST', `/orders/${order.order_id}/cancel/`, { token: buyer.access })).body).toEqual({ detail: 'Only unpaid orders can be cancelled.' })

    const { processOutbox } = await import('../server/jobs/outbox')
    const { OUTBOX_HANDLERS } = await import('../server/jobs/handlers')
    const { database } = await import('../server/db')
    await processOutbox(database(), OUTBOX_HANDLERS, 50)
    expect((await call('GET', `/orders/${order.order_id}/`, { token: buyer.access })).body.order.status).toBe('completed')
    expect((await call('GET', '/domains/customer/domains/', { token: buyer.access })).body).toEqual([expect.objectContaining({ domain_name: domain, status: 'Active' })])
    await new Promise((resolve) => setTimeout(resolve, 100))
    const titles = (await call('GET', '/notifications/', { token: buyer.access })).body.map((item: { title: string }) => item.title)
    expect(titles).toEqual(expect.arrayContaining([`Order ${order.order_number} paid`, 'Payment received', 'Invoice paid', `Domain ${domain} registered`]))

    const second = await domainCheckout(buyer, `second-${run}.com`)
    expect(second.order_id).not.toBe(order.order_id)
  }, 90_000)

  it('keeps manual payments pending until staff record them, and rejects manual webhooks', async () => {
    const buyer = await account()
    const order = await domainCheckout(buyer, `manual-${run}.com`)
    const initiated = await call('POST', `/billing/invoices/${order.invoice_id}/payments/`, { token: buyer.access, body: { gateway_slug: 'test-manual' } })
    expect(initiated.body.status).toBe('pending')
    expect((await call('POST', '/billing/webhooks/test-manual/', { body: { provider_reference: initiated.body.provider_reference } })).status).toBe(400)
    expect((await call('POST', `/billing/transactions/${initiated.body.transaction_id}/verify/`, { token: buyer.access })).body.status).toBe('pending')
    expect((await call('GET', `/billing/invoices/${order.invoice_id}/`, { token: buyer.access })).body.invoice.status).toBe('issued')
    const staff = await account(true)
    expect((await call('POST', `/staff/customers/${buyer.id}/invoices/${order.invoice_id}/payments/`, { token: buyer.access, body: { amount: '12.50', method: 'bank_transfer' } })).status).toBe(403)
    expect((await call('POST', `/staff/customers/${buyer.id}/invoices/${order.invoice_id}/payments/`, { token: staff.access, body: { amount: '20.00', method: 'bank_transfer' } })).body).toEqual(['Payment amount cannot exceed the remaining invoice balance.'])
    expect((await call('POST', `/staff/customers/${buyer.id}/invoices/${order.invoice_id}/payments/`, { token: staff.access, body: { amount: '12.50', method: 'bank_transfer', customer_reference: 'BANK-001' } })).status).toBe(201)
    expect((await call('GET', `/staff/customers/${buyer.id}/invoices/${order.invoice_id}/`, { token: staff.access })).body.invoice).toMatchObject({ status: 'paid', balance: '0.00' })
    expect((await call('GET', `/staff/customers/${buyer.id}/payments/`, { token: staff.access })).body).toEqual([expect.objectContaining({ amount: '12.50', method: 'bank_transfer' })])
  }, 90_000)

  it('applies M-Pesa C2B confirmations only with the registered token', async () => {
    const buyer = await account()
    const order = await domainCheckout(buyer, `mpesa-${run}.com`, 'KES')
    const invoice = (await call('GET', `/billing/invoices/${order.invoice_id}/`, { token: buyer.access })).body.invoice
    expect(invoice).toMatchObject({ currency: 'KES', total: '1618.75' })
    const payload = { TransID: `TX${run}`.toUpperCase(), BillRefNumber: invoice.number, TransAmount: '1618.75', MSISDN: '254712345678', BusinessShortCode: '600000' }
    expect((await call('POST', '/billing/webhooks/test-mpesa/reconciliation/', { body: payload })).status).toBe(403)
    expect((await call('POST', '/billing/webhooks/test-mpesa/reconciliation/?token=wrong', { body: payload })).status).toBe(403)
    const applied = await call('POST', '/billing/webhooks/test-mpesa/reconciliation/?token=c2b-secret-token', { body: payload })
    expect(applied.body).toMatchObject({ status: 'applied', external_reference: payload.TransID })
    expect((await call('POST', '/billing/webhooks/test-mpesa/reconciliation/?token=c2b-secret-token', { body: payload })).body.status).toBe('applied')
    expect((await call('GET', `/billing/invoices/${order.invoice_id}/`, { token: buyer.access })).body.invoice).toMatchObject({ status: 'paid', paid_amount: '1618.75' })
    expect((await call('POST', `/billing/invoices/${order.invoice_id}/payments/`, { token: buyer.access, body: { gateway_slug: 'test-mpesa' } })).body).toEqual(['Invoice is not payable.'])
  }, 90_000)
})
