import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-domain-test-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

describe('supplier routing', () => {
  it('routes every extension to Openprovider and keeps the proposed national registrars in standby', async () => {
    const { slugForExtension, assertSupplierReady } = await import('../server/domains/routing')
    for (const extension of ['.com', '.org', '.co.ke', '.ke', '.co.tz', '.tz']) expect(slugForExtension(extension)).toBe('openprovider')
    process.env.DOMAIN_COUNTRY_REGISTRARS = '{".ke":"register_ke"}'
    expect(slugForExtension('.co.ke')).toBe('register_ke')
    delete process.env.DOMAIN_COUNTRY_REGISTRARS
    expect(() => assertSupplierReady('register_ke')).toThrow('Register.co.ke purchases are disabled pending reseller API integration.')
    expect(() => assertSupplierReady('registry_tz')).toThrow('registry.co.tz purchases are disabled pending reseller API integration.')
  })

  it('matches v1 Openprovider DNS record identifiers, including non-ASCII values', async () => {
    const { OpenproviderRegistrar } = await import('../server/domains/registrars/openprovider')
    expect(OpenproviderRegistrar.recordId({ name: 'www.example.com', type: 'A', value: '192.0.2.1', ttl: 3600, prio: 0 })).toBe('633c709b2caf9e7e3407250ee2ead582bc273998c368b6050ca182cd0233c4dc')
    expect(OpenproviderRegistrar.recordId({ name: 'example.com', type: 'TXT', value: 'v=spf1 include:_spf.example é', ttl: 600 })).toBe('ab14926ca43d7e142b7020cd6b7a5a2bedeb29a708fbaebe4536533c24a22ef8')
  })
})

suite('domains API', () => {
  let api: typeof import('../server/api')
  let resetThrottles: () => void
  let ip = 0
  const stub = { checks: [] as string[][], registered: [] as string[] }
  const run = Date.now().toString(36)

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.2.${++ip % 250}.1` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function account(staff = false) {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `domain-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
    await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: staff, is_email_verified: true })
      await addToGroup(client, user.id, staff ? 'Platform Administrator' : 'Customer')
    })
    return (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body as { access: string; user: { id: string } }
  }

  beforeAll(async () => {
    process.env.OPENPROVIDER_ENABLED = 'true'
    process.env.OPENPROVIDER_TRANSACTIONS_ENABLED = 'true'
    api = await import('../server/api')
    const { database, transaction } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
    resetThrottles = (await import('../server/http/throttle')).resetThrottles
    const db = database()
    const { seedTlds, seedSupplierRecords } = await import('../server/domains/service')
    await seedTlds()
    await seedSupplierRecords()
    await db.query(`INSERT INTO domains_tld (extension, display_name, is_active, supports_dnssec, supports_idn, registration_order, is_featured, provider_supported, provider_metadata, created_at, updated_at)
      VALUES ('.co', 'Company', true, false, false, 9, false, true, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (extension) DO NOTHING`)
    await db.query(`UPDATE domains_registrar SET is_active = true WHERE slug IN ('openprovider', 'register_ke', 'registry_tz')`)
    await db.query(`INSERT INTO pricing_pricingrule (name, strategy, value, is_default, is_active, created_at, updated_at) VALUES ('Standard Retail', 'percentage_markup', 25.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (name) DO NOTHING`)
    const prices: [string, string, string, string][] = [['openprovider', '.com', 'register', '10.00'], ['openprovider', '.com', 'renew', '12.00'], ['openprovider', '.net', 'register', '11.99'], ['openprovider', '.co', 'register', '20.10'], ['register_ke', '.co.ke', 'register', '8.00']]
    for (const [slug, extension, type, price] of prices)
      await db.query(
        `INSERT INTO domains_domainprice (price_type, years, price, last_synced_at, created_at, updated_at, currency_id, registrar_id, tld_id)
         SELECT $3, 1, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM currencies_currency WHERE code = 'USD'), r.id, t.id FROM domains_registrar r, domains_tld t WHERE r.slug = $1 AND t.extension = $2
         ON CONFLICT (registrar_id, tld_id, price_type, years) DO UPDATE SET price = EXCLUDED.price`,
        [slug, extension, type, price],
      )
    const { setRegistrarOverride } = await import('../server/domains/registrars')
    const taken = new Set(['taken.com'])
    setRegistrarOverride((slug) => slug !== 'openprovider' ? undefined : ({
      slug,
      checkDomains: async (names) => { stub.checks.push(names); return names.map((domain) => ({ domain, available: !taken.has(domain), premium: false, registrar: slug })) },
      registerDomain: async (request) => { stub.registered.push(request.domain); taken.add(request.domain); return { success: true, registrar: slug, domain: request.domain, order_id: '991', transaction_id: null, expiration_date: '2027-10-09', message: '', pending: false } },
      getRegistrationInfo: async (domain) => ({ domain, is_owner: taken.has(domain), status: 'active', provider_domain_id: '991', expiration_date: '2027-10-09' }),
      renewDomain: async (domain, years) => ({ domain_name: domain, renewed: true, registrar: slug, previous_expiration_date: '2027-10-09', new_expiration_date: '2028-10-09', years, order_id: '991', transaction_id: null }),
      getContacts: async () => { throw new Error('unused') }, setContacts: async () => { throw new Error('unused') },
      getNameservers: async () => ['ns1.example.net', 'ns2.example.net'], setNameservers: async (domain) => ({ success: true, domain_name: domain, registrar: slug }),
      getDnsHosts: async () => [], setDnsHosts: async (domain) => ({ success: true, domain_name: domain, registrar: slug }),
      getDnsRecords: async () => [], createDnsRecord: async (domain) => ({ success: true, domain_name: domain, registrar: slug }),
      updateDnsRecord: async (domain) => ({ success: true, domain_name: domain, registrar: slug }), deleteDnsRecord: async (domain) => ({ success: true, domain_name: domain, registrar: slug }),
    }))
  })

  beforeEach(() => resetThrottles())

  afterAll(async () => {
    const { setRegistrarOverride } = await import('../server/domains/registrars')
    setRegistrarOverride(null)
    delete process.env.OPENPROVIDER_ENABLED
    delete process.env.OPENPROVIDER_TRANSACTIONS_ENABLED
    await (await import('../server/db')).database().end()
  })

  it('searches through the routed supplier with 25% retail markup and paged suggestions', async () => {
    const result = await call('GET', '/domains/search/?domain=Synthetic%20Bakery&suggestion_limit=1')
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ domain: 'synthetic-bakery.com', available: true, registrar: 'openprovider', message: null, next_offset: 1 })
    // An exact `kes` price is added when a USD→KES rate exists in the shared test database.
    expect(result.body.prices).toEqual({ register: expect.objectContaining({ product_id: expect.any(Number), usd: '12.50' }), renew: expect.objectContaining({ product_id: expect.any(Number), usd: '15.00' }) })
    expect(result.body.suggestions).toEqual([{ domain: 'synthetic-bakery.net', available: true, premium: false, registration_price: expect.objectContaining({ product_id: expect.any(Number), usd: '14.99' }) }])
    expect((await call('GET', '/domains/search/?domain=a@b.com')).body).toEqual({ domain: ['Enter a business name or a domain such as yourbusiness.com. Use letters, numbers, spaces or hyphens.'] })
  })

  it('searches Kenyan names through Openprovider and ignores standby supplier prices', async () => {
    const result = await call('GET', '/domains/search/?domain=bakery.co.ke')
    // Only a synced Openprovider price makes .co.ke sellable; the standby Register.co.ke price is never used.
    expect(result.body).toMatchObject({ domain: 'bakery.co.ke', available: false, registrar: 'openprovider', message: 'This extension is not currently supported for registration.', prices: {} })
    expect(stub.checks.flat()).not.toContain('bakery.co.ke')
  })

  it('registers only through staff permission, reconciles repeats and keeps renewals staff-only', async () => {
    const fresh = `fresh-bakery-${run}.com`
    const customer = await account()
    const staff = await account(true)
    expect((await call('POST', '/domains/customer/register/', { token: customer.access, body: { domain: fresh } })).status).toBe(403)
    const first = await call('POST', '/domains/customer/register/', { token: staff.access, body: { domain: fresh } })
    expect(first).toMatchObject({ status: 201, body: { success: true, registrar: 'openprovider', domain_name: fresh, expiration_date: '2027-10-09' } })
    const repeat = await call('POST', '/domains/customer/register/', { token: staff.access, body: { domain: fresh } })
    expect(repeat.body.message).toBe('Domain registration already reconciled.')
    expect(stub.registered.filter((name) => name === fresh)).toHaveLength(1)
    expect((await call('POST', '/domains/customer/register/', { token: staff.access, body: { domain: 'taken.com' } })).body).toEqual({ detail: "Domain 'taken.com' is no longer available." })

    const list = (await call('GET', '/domains/customer/domains/', { token: staff.access })).body
    expect(list).toEqual([expect.objectContaining({ domain_name: fresh, registrar: 'Openprovider', status: 'Active', expires_at: '2027-10-09' })])
    expect((await call('GET', `/domains/customer/domains/${list[0].id}/`, { token: customer.access })).status).toBe(404)
    expect((await call('POST', `/domains/customer/domains/${list[0].id}/renew/`, { token: customer.access, body: {} })).status).toBe(403)
    expect((await call('POST', `/domains/customer/domains/${list[0].id}/renew/`, { token: staff.access, body: {} })).body).toMatchObject({ renewed: true, new_expiration_date: '2028-10-09' })
    expect((await call('GET', `/domains/customer/domains/${list[0].id}/`, { token: staff.access })).body).toMatchObject({ expires_at: '2028-10-09', registration_years: 2, tld: '.com' })
  }, 60_000)

  it('validates DNS records and nameservers with v1 messages', async () => {
    const staff = await account(true)
    await call('POST', '/domains/customer/register/', { token: staff.access, body: { domain: `dns-check-${run}.com` } })
    const [domain] = (await call('GET', '/domains/customer/domains/', { token: staff.access })).body
    expect((await call('POST', `/domains/customer/domains/${domain.id}/dns-records/`, { token: staff.access, body: { record: { type: 'A', host: 'WWW', value: 'not-an-ip', ttl: 3600 } } })).body).toEqual({ record: { value: ['Invalid IPv4 address.'] } })
    expect((await call('POST', `/domains/customer/domains/${domain.id}/dns-records/`, { token: staff.access, body: { record: { type: 'MX', host: '@', value: 'mail.example.com', ttl: 30 } } })).body).toEqual({ record: { ttl: ['Ensure this value is greater than or equal to 60.'] } })
    expect((await call('POST', `/domains/customer/domains/${domain.id}/dns-records/`, { token: staff.access, body: { record: { type: 'A', host: 'www', value: '192.0.2.10', ttl: 3600 } } })).status).toBe(201)
    expect((await call('PUT', `/domains/customer/domains/${domain.id}/nameservers/`, { token: staff.access, body: { nameservers: [{ hostname: 'ns1.example.net' }] } })).body).toEqual({ nameservers: ['Ensure this field has at least 2 elements.'] })
    expect((await call('GET', `/domains/customer/domains/${domain.id}/nameservers/`, { token: staff.access })).body).toEqual({ nameservers: [{ hostname: 'ns1.example.net' }, { hostname: 'ns2.example.net' }] })
  }, 60_000)
})

suite('Openprovider adapter against documented responses', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.OPENPROVIDER_ENABLED
    delete process.env.OPENPROVIDER_TRANSACTIONS_ENABLED
    delete process.env.OPENPROVIDER_USERNAME
    delete process.env.OPENPROVIDER_PASSWORD
  })

  it('treats "in use" and "reserved" as taken, defaults is_premium, and requests zone records explicitly', async () => {
    Object.assign(process.env, { OPENPROVIDER_ENABLED: 'true', OPENPROVIDER_TRANSACTIONS_ENABLED: 'true', OPENPROVIDER_USERNAME: 'synthetic', OPENPROVIDER_PASSWORD: 'synthetic' })
    const { OpenproviderRegistrar } = await import('../server/domains/registrars/openprovider')
    const requests: { method: string; url: URL; body?: unknown }[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      requests.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const reply = (data: unknown) => new Response(JSON.stringify({ code: 0, data, desc: '' }))
      if (url.pathname.endsWith('/auth/login')) return reply({ token: 'synthetic-token' })
      if (url.pathname.endsWith('/domains/check'))
        return reply({ results: [{ domain: 'free-name.com', status: 'free' }, { domain: 'taken-name.com', status: 'in use' }, { domain: 'held-name.com', status: 'reserved', is_premium: true }] })
      if (url.pathname.endsWith('/domains')) return reply({ results: [{ id: 42, domain: { name: 'zone-test', extension: 'com' }, status: 'ACT', renewal_date: '2027-01-01' }] })
      if (url.pathname.endsWith('/dns/zones/zone-test.com'))
        return reply(url.searchParams.get('with_records') === 'true' ? { id: 7, name: 'zone-test.com', records: [{ name: 'www.zone-test.com', type: 'A', value: '192.0.2.1', ttl: 900 }] } : { id: 7, name: 'zone-test.com' })
      return reply({ success: true })
    }) as typeof fetch
    const registrar = new OpenproviderRegistrar()
    expect(await registrar.checkDomains(['free-name.com', 'taken-name.com', 'held-name.com'])).toEqual([
      { domain: 'free-name.com', available: true, premium: false, registrar: 'openprovider' },
      { domain: 'taken-name.com', available: false, premium: false, registrar: 'openprovider' },
      { domain: 'held-name.com', available: false, premium: true, registrar: 'openprovider' },
    ])
    const [record] = await registrar.getDnsRecords('zone-test.com')
    expect(record).toMatchObject({ host: 'www', type: 'A', value: '192.0.2.1', ttl: 900 })
    await expect(registrar.createDnsRecord('zone-test.com', { ...record, id: null, host: 'mail', ttl: 300 })).rejects.toThrow('TTL values')
    await registrar.createDnsRecord('zone-test.com', { ...record, id: null, host: 'mail', ttl: 3600 })
    const update = requests.find((request) => request.method === 'PUT' && request.url.pathname.endsWith('/dns/zones/zone-test.com'))!
    expect(update.body).toEqual({ id: 7, name: 'zone-test.com', records: { add: [{ name: 'mail.zone-test.com', type: 'A', value: '192.0.2.1', ttl: 3600 }] } })
  })
})
