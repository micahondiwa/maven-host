import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { HostingSupplier, SupplierAccount, Capability } from '../server/hosting/suppliers/types'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-hosting-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

const envKeys = ['TWENTYI_ENABLED', 'TWENTYI_TRANSACTIONS_ENABLED', 'TWENTYI_GENERAL_API_KEY', 'TWENTYI_API_URL'] as const
const clearEnv = () => envKeys.forEach((key) => delete process.env[key])

describe('20i adapter', () => {
  afterEach(clearEnv)

  function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      return handler(String(input), init ?? {})
    }) as unknown as typeof fetch
    return { fetcher, calls }
  }

  it('makes no call at all while disabled or without credentials', async () => {
    const { TwentyISupplier } = await import('../server/hosting/suppliers/twentyi')
    const { fetcher, calls } = fakeFetch(() => new Response('[]'))
    await expect(new TwentyISupplier(fetcher).verifyConnection()).rejects.toMatchObject({ code: 'disabled' })
    process.env.TWENTYI_ENABLED = 'true'
    await expect(new TwentyISupplier(fetcher).verifyConnection()).rejects.toMatchObject({ code: 'not_configured' })
    process.env.TWENTYI_GENERAL_API_KEY = 'synthetic-general-key'
    await expect(new TwentyISupplier(fetcher).provision({ primaryDomain: 'a.com', productReference: '811', label: 'mh1' })).rejects.toMatchObject({ code: 'disabled' })
    expect(calls).toHaveLength(0)
  })

  it('authenticates with the base64 general key and reads packages by domain', async () => {
    process.env.TWENTYI_ENABLED = 'true'
    process.env.TWENTYI_GENERAL_API_KEY = 'synthetic-general-key'
    const { TwentyISupplier } = await import('../server/hosting/suppliers/twentyi')
    const { fetcher, calls } = fakeFetch(() => new Response(JSON.stringify([
      { id: 866239, created: '2026-10-01T10:00:00+00:00', enabled: true, name: 'bakery.co.ke', names: ['bakery.co.ke', 'www.bakery.co.ke'], packageTypeName: 'Maven Basic', typeRef: 811 },
      { id: 5, enabled: false, name: 'paused.com', names: ['paused.com'], packageTypeName: 'Maven Basic', typeRef: 811 },
    ])))
    const supplier = new TwentyISupplier(fetcher)
    expect(await supplier.findAccountByDomain('WWW.Bakery.co.ke.')).toMatchObject({ reference: '866239', primaryDomain: 'bakery.co.ke', suspended: false, productReference: '811' })
    expect(await supplier.getAccount('5')).toMatchObject({ suspended: true })
    expect(calls[0].url).toBe('https://api.20i.com/package')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${Buffer.from('synthetic-general-key').toString('base64')}`)
  })

  it('creates packages through addWeb only when transactions are enabled, and classifies failures', async () => {
    process.env.TWENTYI_ENABLED = 'true'
    process.env.TWENTYI_TRANSACTIONS_ENABLED = 'true'
    process.env.TWENTYI_GENERAL_API_KEY = 'synthetic-general-key'
    const { TwentyISupplier } = await import('../server/hosting/suppliers/twentyi')
    const { fetcher, calls } = fakeFetch((target, init) =>
      init.method === 'POST' ? new Response(JSON.stringify({ result: 901 })) : new Response(JSON.stringify([{ id: 901, enabled: true, name: 'new.com', names: ['new.com'], typeRef: '811' }])),
    )
    const supplier = new TwentyISupplier(fetcher)
    await expect(supplier.provision({ primaryDomain: 'new.com', productReference: 'basic', label: 'mh1' })).rejects.toMatchObject({ code: 'rejected' })
    expect(await supplier.provision({ primaryDomain: 'New.com', productReference: '811', label: 'mh1' })).toMatchObject({ reference: '901', primaryDomain: 'new.com' })
    expect(calls[0]).toMatchObject({ url: 'https://api.20i.com/reseller/*/addWeb', init: { method: 'POST' } })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ type: '811', domain_name: 'new.com', label: 'mh1' })

    const status = (code: number) => new TwentyISupplier(fakeFetch(() => new Response(JSON.stringify({ error: 'x' }), { status: code })).fetcher).verifyConnection()
    await expect(status(401)).rejects.toMatchObject({ code: 'auth_failed' })
    await expect(status(429)).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(status(503)).rejects.toMatchObject({ code: 'unavailable', ambiguous: true })
    const offline = new TwentyISupplier(fakeFetch(() => { throw new TypeError('fetch failed') }).fetcher)
    await expect(offline.verifyConnection()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(supplier.suspend()).rejects.toMatchObject({ code: 'unsupported' })
  })
})

suite('hosting lifecycle on the 20i supplier', () => {
  let api: typeof import('../server/api')
  let ip = 0
  const run = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`
  let planId: number
  let priceId: number
  let packageId: number

  const fake = { accounts: new Map<string, SupplierAccount>(), created: [] as string[], caps: new Set<Capability>(['provision', 'lookup']) }
  const supplier: HostingSupplier = {
    code: 'twentyi',
    usesServers: false,
    get capabilities() {
      return fake.caps
    },
    verifyConnection: async () => ({ accounts: fake.accounts.size }),
    findAccountByDomain: async (domain) => [...fake.accounts.values()].find((account) => account.domains.includes(domain)) ?? null,
    getAccount: async (reference) => fake.accounts.get(reference) ?? null,
    provision: async (input) => {
      fake.created.push(input.primaryDomain)
      const account = { reference: String(7000 + fake.created.length), primaryDomain: input.primaryDomain, domains: [input.primaryDomain], suspended: false, productName: 'Maven', productReference: input.productReference, createdAt: new Date() }
      fake.accounts.set(account.reference, account)
      return account
    },
    suspend: async (reference) => void (fake.accounts.get(reference)!.suspended = true),
    unsuspend: async (reference) => void (fake.accounts.get(reference)!.suspended = false),
    terminate: async (reference) => void fake.accounts.delete(reference),
  }

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.5.${++ip % 250}` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function account(role: 'Customer' | 'Sales' | 'Support' | 'Platform Administrator') {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `hosting-${role.replace(' ', '')}-${run}-${++ip}@example.test`
    await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: role !== 'Customer', is_email_verified: true })
      await addToGroup(client, user.id, role)
    })
    const login = (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body
    return { access: login.access as string, id: login.user.id as string }
  }

  const processOutbox = async () => {
    const { processOutbox } = await import('../server/jobs/outbox')
    const { OUTBOX_HANDLERS } = await import('../server/jobs/handlers')
    await processOutbox((await import('../server/db')).database(), OUTBOX_HANDLERS, 100)
  }

  beforeAll(async () => {
    process.env.TWENTYI_ENABLED = 'true'
    process.env.TWENTYI_TRANSACTIONS_ENABLED = 'true'
    api = await import('../server/api')
    const { database, transaction, queryOne } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
    await (await import('../server/pricing/engine')).seedCurrencies()
    const db = database()
    await db.query(`UPDATE hosting_hostingprovider SET is_active = true WHERE supplier_code = 'twentyi'`)
    planId = (await queryOne<{ id: number }>(
      `INSERT INTO hosting_hostingplan (name, plan_type, disk_space_mb, bandwidth_mb, max_domains, max_databases, max_email_accounts, max_ftp_accounts, backup_frequency, supports_ssl, is_active,
         created_at, updated_at, max_child_accounts, requires_quote, specifications, description, display_order, is_featured, requires_verified_mapping, short_description, slug, target_entitlements)
       VALUES ($1, 'shared', 10240, NULL, 1, 1, 1, 1, 'daily', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, false, '{}', 'Synthetic cloud plan', 99, false, true, 'Synthetic', $2, '{"supplier": "twentyi"}') RETURNING id`,
      [`Synthetic Cloud ${run}`, `synthetic-cloud-${run}`],
    ))!.id
    priceId = (await queryOne<{ id: number }>(
      `INSERT INTO hosting_hostingplanprice (billing_cycle, regular_price, sale_price, setup_fee, is_active, created_at, updated_at, currency_id, hosting_plan_id)
       SELECT 'annually', 60.00, NULL, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, id, $1 FROM currencies_currency WHERE code = 'USD' RETURNING id`,
      [planId],
    ))!.id
    packageId = (await queryOne<{ id: number }>(
      `INSERT INTO hosting_hostingpackage (package_name, package_identifier, is_default, is_active, created_at, updated_at, hosting_plan_id, provider_id, is_reseller_package, is_provider_verified,
         is_provisionable, last_verified_at, provider_product_id, provider_region, provisioning_metadata, verified_entitlements, wholesale_billing_cycle, wholesale_cost, wholesale_currency_id)
       SELECT '811', '811', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $1, id, false, true, true, CURRENT_TIMESTAMP, '811', '', '{}', '{"websites": 1, "storage_mb": 10240}', '', NULL, NULL
         FROM hosting_hostingprovider WHERE supplier_code = 'twentyi' RETURNING id`,
      [planId],
    ))!.id
    const { setHostingSupplierOverride } = await import('../server/hosting/suppliers')
    setHostingSupplierOverride((code) => (code === 'twentyi' ? supplier : undefined))
  })

  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())

  afterAll(async () => {
    ;(await import('../server/hosting/suppliers')).setHostingSupplierOverride(null)
    clearEnv()
    // Keep the shared test database's public catalog identical to the Django baseline for other suites.
    await (await import('../server/db')).database().query('UPDATE hosting_hostingplan SET is_active = false WHERE id = $1', [planId])
    await (await import('../server/db')).database().end()
  })

  it('sells a 20i plan only while 20i transactions are enabled and never offers retired KnownHost packages', async () => {
    const plan = () => call('GET', `/hosting/plans/synthetic-cloud-${run}/`).then((response) => response.body)
    expect(await plan()).toMatchObject({ requires_quote: false, verification_status: 'verified', verified_features: { websites: 1, storage_mb: 10240 } })
    process.env.TWENTYI_TRANSACTIONS_ENABLED = 'false'
    expect((await plan()).requires_quote).toBe(true)
    process.env.TWENTYI_TRANSACTIONS_ENABLED = 'true'
    const { query } = await import('../server/db')
    const { verifiedPackages } = await import('../server/hosting/catalog')
    const knownhostPlans = (await query<{ id: number }>(`SELECT DISTINCT hosting_plan_id AS id FROM hosting_hostingpackage pkg JOIN hosting_hostingprovider p ON p.id = pkg.provider_id WHERE p.supplier_code = 'knownhost'`)).map((row) => row.id)
    expect(await verifiedPackages(knownhostPlans)).toEqual([])
  })

  it('publishes the cloud lineup with USD and KES prices and no reseller plans', async () => {
    const plans = (await call('GET', '/hosting/plans/?currency=USD,KES')).body as { slug: string; plan_type: string; requires_quote: boolean; verification_status: string; proposed_features: Record<string, unknown>; advertised_offers: { term: string; total: string; renewal_total: string }[]; prices: { billing_cycle: string; currency: string; price: string }[] }[]
    expect(plans.some((plan) => plan.plan_type === 'reseller')).toBe(false)
    expect(plans.filter((plan) => ['basic', 'standard', 'professional', 'premium'].includes(plan.slug))).toEqual([])
    const cloud = Object.fromEntries(plans.filter((plan) => plan.slug.startsWith('cloud-')).map((plan) => [plan.slug, plan]))
    expect(Object.keys(cloud)).toEqual(['cloud-starter', 'cloud-business', 'cloud-pro'])
    const price = (slug: string, cycle: string, currency: string) => cloud[slug].prices.find((row) => row.billing_cycle === cycle && row.currency === currency)?.price
    expect([price('cloud-starter', 'annually', 'USD'), price('cloud-starter', 'annually', 'KES'), price('cloud-business', 'monthly', 'KES'), price('cloud-pro', 'biennially', 'USD')]).toEqual(['29.99', '3899.00', '899.00', '179.99'])
    // Until a 20i package type is verified for a plan, it is shown but cannot be bought.
    expect(cloud['cloud-business']).toMatchObject({ requires_quote: true, verification_status: 'pending', proposed_features: { websites: 5, storage_gb: 50, mailbox_storage_gb: 10, cdn: 'Global Anycast CDN', control_panel: 'Maven Host control panel' } })
    expect(cloud['cloud-starter'].advertised_offers.find((offer) => offer.term === '1-year')).toMatchObject({ total: '29.99', renewal_total: '29.99' })
    expect(JSON.stringify(Object.values(cloud))).not.toMatch(/20i|twentyi|knownhost|cPanel/i)
  })

  it('provisions a paid hosting order through the outbox exactly once and records the subscription', async () => {
    const buyer = await account('Customer')
    const admin = await account('Platform Administrator')
    const domain = `shop-${run}.co.ke`
    expect((await call('POST', '/orders/cart/', { token: buyer.access, body: { product_type: 'hosting', resource_id: String(priceId), billing_cycle: 'annually', quantity: 1, configuration: { domain } } })).status).toBe(201)
    const cart = (await call('GET', '/orders/cart/', { token: buyer.access })).body
    const checkout = await call('POST', '/orders/checkout/', { token: buyer.access, body: { hosting_passwords: { [cart.items[0].item_id]: 'Synthetic-hosting-pass-1' } } })
    expect(checkout.body).toMatchObject({ order_id: expect.any(String) })
    const paid = await call('POST', `/staff/customers/${buyer.id}/invoices/${checkout.body.invoice_id}/payments/`, { token: admin.access, body: { amount: '60.00', method: 'bank_transfer', customer_reference: `BANK-${run}` } })
    expect(paid.status).toBe(201)
    await processOutbox()
    await processOutbox()
    expect(fake.created.filter((name) => name === domain)).toHaveLength(1)
    expect((await call('GET', `/orders/${checkout.body.order_id}/`, { token: buyer.access })).body.order.status).toBe('completed')

    const accounts = (await call('GET', '/hosting/accounts/', { token: buyer.access })).body.accounts
    expect(accounts).toEqual([{ account_id: expect.any(String), username: expect.stringMatching(/^mh[0-9a-f]{10}$/), primary_domain: domain, package_name: `Synthetic Cloud ${run}`, server_name: 'Maven Host Cloud', status: 'active' }])
    const detail = (await call('GET', `/hosting/accounts/?account_id=${accounts[0].account_id}`, { token: buyer.access })).body.account
    expect(detail).toMatchObject({ disk_limit_mb: 10240, suspended: false, dedicated_ip: null })
    expect(JSON.stringify(detail)).not.toMatch(/20i|"7\d{3}"|provider_reference/)
    expect((await call('GET', `/hosting/accounts/?account_id=${accounts[0].account_id}`, { token: (await account('Customer')).access })).status).toBe(404)
    expect((await call('GET', '/hosting/subscriptions/', { token: buyer.access })).body).toEqual([expect.objectContaining({ primary_domain: domain, retail_price: '60.00', currency: 'USD', billing_cycle: 'annually', status: 'active' })])

    const { query } = await import('../server/db')
    const audits = await query<{ event: string }>(`SELECT event FROM audit_auditlog WHERE object_id = $1 AND category = 'hosting'`, [accounts[0].account_id])
    expect(audits.map((row) => row.event)).toContain('hosting_provisioned')
    const support = await account('Support')
    expect((await call('GET', `/staff/customers/${buyer.id}/hosting/`, { token: support.access })).body).toEqual([expect.objectContaining({ primary_domain: domain, status: 'Active', server_name: 'Maven Host Cloud' })])
  }, 120_000)

  it('adopts an account that already exists at the supplier instead of creating a duplicate', async () => {
    const customer = await account('Customer')
    const domain = `adopt-${run}.com`
    fake.accounts.set('6001', { reference: '6001', primaryDomain: domain, domains: [domain], suspended: false, productName: 'Maven', productReference: '811', createdAt: new Date() })
    const { provisionHosting } = await import('../server/hosting/service')
    const result = await provisionHosting({ customerId: customer.id, domainName: domain, packageId, username: `adopt${run}`.slice(0, 64) })
    expect(result).toMatchObject({ primary_domain: domain, server_id: null, server_hostname: 'Maven Host Cloud' })
    expect(fake.created).not.toContain(domain)
    const { queryOne } = await import('../server/db')
    expect(await queryOne(`SELECT provider_reference, status FROM hosting_hostingaccount WHERE primary_domain = $1`, [domain])).toEqual({ provider_reference: '6001', status: 'active' })
    expect(await queryOne(`SELECT payload->>'recovered' AS recovered FROM core_events_outbox WHERE event_name = 'hosting.account.provisioned' AND payload->>'primary_domain' = $1`, [domain])).toEqual({ recovered: 'true' })
    await expect(provisionHosting({ customerId: (await account('Customer')).id, domainName: domain, packageId, username: `other${run}` })).rejects.toMatchObject({ body: { non_field_errors: [`'${domain}' is already hosted on another MavenHost account.`] } })
  }, 60_000)

  it('refuses lifecycle actions the supplier has no verified API for, and runs them durably once it does', async () => {
    const customer = await account('Customer')
    const domain = `life-${run}.com`
    const { provisionHosting } = await import('../server/hosting/service')
    const created = await provisionHosting({ customerId: customer.id, domainName: domain, packageId, username: `life${run}` })
    const accountId = String(created.account_id)
    expect((await call('POST', '/hosting/accounts/suspend/', { token: customer.access, body: { account_id: accountId } })).body).toEqual({
      detail: 'This hosting action is not available online yet. Please contact MavenHost support and we will complete it for you.', code: 'not_available',
    })
    expect((await call('POST', '/hosting/accounts/backup/', { token: customer.access, body: { account_id: accountId } })).status).toBe(409)

    fake.caps = new Set<Capability>(['provision', 'lookup', 'suspend', 'unsuspend', 'terminate'])
    const requested = await call('POST', '/hosting/accounts/suspend/', { token: customer.access, body: { account_id: accountId, reason: 'Travelling' } })
    expect(requested).toMatchObject({ status: 202, body: { operation_type: 'suspend', status: 'pending' } })
    expect((await call('POST', '/hosting/accounts/suspend/', { token: customer.access, body: { account_id: accountId } })).body.operation_id).toBe(requested.body.operation_id)
    await processOutbox()
    expect((await call('GET', `/hosting/accounts/operations/${requested.body.operation_id}/`, { token: customer.access })).body).toMatchObject({ status: 'succeeded', message: 'Hosting operation completed successfully.' })
    expect((await call('GET', `/hosting/accounts/?account_id=${accountId}`, { token: customer.access })).body.account).toMatchObject({ status: 'suspended', suspended: true })
    expect((await call('POST', '/hosting/accounts/suspend/', { token: customer.access, body: { account_id: accountId } })).body).toEqual({ non_field_errors: ['Hosting account is already suspended.'] })
    expect((await call('POST', '/hosting/accounts/suspend/', { token: customer.access, body: { account_id: 'abc' } })).body).toEqual({ account_id: ['A valid integer is required.'] })
    fake.caps = new Set<Capability>(['provision', 'lookup'])
  }, 60_000)
})
