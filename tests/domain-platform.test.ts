import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { DomainState, Registrar, SupplierTld } from '../server/domains/types'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-domain-platform-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

const SUPPLIER_ENV = ['OPENPROVIDER_ENABLED', 'OPENPROVIDER_TRANSACTIONS_ENABLED', 'OPENPROVIDER_USERNAME', 'OPENPROVIDER_PASSWORD', 'OPENPROVIDER_API_URL'] as const

suite('Openprovider adapter: domain security and catalog (documented /v1 operations)', () => {
  const realFetch = globalThis.fetch
  type Call = { method: string; path: string; body: unknown }
  let calls: Call[] = []
  let domainRecord: Record<string, unknown>

  function mockSupplier(tldPages: Record<number, unknown[]> = {}, total = 0) {
    calls = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(String(input))
      const path = target.pathname.replace(/^\/v1/, '')
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method: init?.method ?? 'GET', path: `${path}${target.search}`, body })
      const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }))
      if (path === '/auth/login') return ok({ token: 'synthetic-token' })
      if (path === '/domains' && target.searchParams.get('full_name')) return ok({ results: [{ id: 42, domain: { name: 'example', extension: 'com' }, renewal_date: '2027-03-01 00:00:00' }] })
      if (path === '/domains/42' && (init?.method ?? 'GET') === 'GET') return ok(domainRecord)
      if (path === '/domains/42' && init?.method === 'PUT') return ok({ id: 42, status: 'ACT' })
      if (path === '/domains/42/authcode') return ok({ auth_code: 'EPP-SYNTHETIC-1', success: true, type: 'external' })
      if (path === '/tlds') return ok({ results: tldPages[Number(target.searchParams.get('offset'))] ?? [], total })
      return new Response('{}', { status: 404 })
    }) as typeof fetch
  }

  beforeAll(async () => {
    await (await import('../server/domains/service')).seedTlds()
  })
  beforeEach(() => {
    process.env.OPENPROVIDER_ENABLED = 'true'
    process.env.OPENPROVIDER_TRANSACTIONS_ENABLED = 'true'
    process.env.OPENPROVIDER_USERNAME = 'synthetic'
    process.env.OPENPROVIDER_PASSWORD = 'synthetic'
    process.env.OPENPROVIDER_API_URL = 'https://api.openprovider.eu/v1'
    domainRecord = { id: 42, status: 'ACT', renewal_date: '2027-03-01 00:00:00', is_locked: false, is_lockable: true, is_private_whois_enabled: false, is_private_whois_allowed: true, transfer_auth_code_required: '1', can_renew: true }
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    SUPPLIER_ENV.forEach((key) => delete process.env[key])
  })
  afterAll(async () => (await import('../server/db')).database().end())

  it('reads the live state and changes lock and privacy only through PUT /domains/{id}', async () => {
    mockSupplier()
    const { OpenproviderRegistrar } = await import('../server/domains/registrars/openprovider')
    const supplier = new OpenproviderRegistrar()
    expect(await supplier.getDomainState('example.com')).toEqual({ status: 'active', expires_on: '2027-03-01', locked: false, lockable: true, privacy_enabled: false, privacy_allowed: true, auth_code_required_for_transfer: true, can_renew: true })
    expect(calls.find((call) => call.path === '/domains/42')).toMatchObject({ method: 'GET' })

    await supplier.setLock('example.com', true)
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([{ method: 'PUT', path: '/domains/42', body: { is_locked: true } }])
    await supplier.setPrivacy('example.com', true)
    expect(calls.filter((call) => call.method === 'PUT').at(-1)).toEqual({ method: 'PUT', path: '/domains/42', body: { is_private_whois_enabled: true } })

    // Already in the requested state: no write at all.
    calls = []
    await supplier.setLock('example.com', false)
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([])
    expect(await supplier.getAuthCode('example.com')).toBe('EPP-SYNTHETIC-1')
  })

  it('refuses unsupported or disabled actions without writing, and never names the supplier', async () => {
    mockSupplier()
    const { OpenproviderRegistrar } = await import('../server/domains/registrars/openprovider')
    domainRecord = { ...domainRecord, is_lockable: false, is_private_whois_allowed: false }
    await expect(new OpenproviderRegistrar().setLock('example.com', true)).rejects.toMatchObject({ body: { detail: 'Registrar lock is not available for this domain.' } })
    await expect(new OpenproviderRegistrar().setPrivacy('example.com', true)).rejects.toMatchObject({ body: { detail: 'WHOIS privacy is not available for this domain extension.' } })
    process.env.OPENPROVIDER_TRANSACTIONS_ENABLED = 'false'
    const error = await new OpenproviderRegistrar().setLock('example.com', true).catch((caught) => caught)
    expect(error.body.detail).toBe('Domain registration services are temporarily unavailable.')
    expect(JSON.stringify(error.body)).not.toMatch(/openprovider/i)
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([])
  })

  it('pages through GET /tlds and parses prices, periods and restrictions', async () => {
    const tld = (name: string, extra: Record<string, unknown> = {}) => ({
      name, status: 'ACT', min_period: 1, max_period: 10, renew_available: true, transfer_available: true, is_transfer_auth_code_required: true,
      is_private_whois_allowed: true, dnssec_allowed: true, restrictions: [], prices: { create_price: { reseller: { price: 8.5, currency: 'USD' } }, renew_price: { reseller: { price: 9, currency: 'USD' } }, transfer_price: { reseller: { price: 8, currency: 'USD' } } }, ...extra,
    })
    const first = Array.from({ length: 100 }, (_, index) => tld(`t${index}`))
    mockSupplier({ 0: first, 100: [tld('last', { prices: { create_price: { reseller: { price: 3, currency: 'EUR' } }, setup_price: { reseller: { price: 50, currency: 'EUR' } } } })] }, 101)
    const { OpenproviderRegistrar } = await import('../server/domains/registrars/openprovider')
    const tlds = await new OpenproviderRegistrar().listTlds()
    expect(tlds).toHaveLength(101)
    expect(calls.filter((call) => call.path.startsWith('/tlds')).map((call) => new URLSearchParams(call.path.split('?')[1]).get('offset'))).toEqual(['0', '100'])
    expect(tlds[0]).toMatchObject({ extension: '.t0', active: true, prices: { register: { currency: 'USD', price: '8.5' }, renew: { price: '9' }, transfer: { price: '8' } } })
    expect(tlds[100]).toMatchObject({ extension: '.last', setup_fee: true, prices: { register: { currency: 'EUR', price: '3' }, renew: null } })
  })
})

suite('domain platform API: owner security controls, branding and catalog sync', () => {
  let api: typeof import('../server/api')
  let ip = 0
  const run = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 5)}`
  const state: Record<string, DomainState> = {}

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.2.${++ip % 250}` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function customer(role: 'Customer' | 'Support' = 'Customer') {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `platform-${role}-${run}-${++ip}@example.test`
    const id = await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: role !== 'Customer', is_email_verified: true })
      await addToGroup(client, user.id, role)
      return user.id as string
    })
    return { id, email, access: (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body.access as string }
  }

  async function ownDomain(ownerId: string, name: string, registrar = 'openprovider') {
    const { queryOne } = await import('../server/db')
    return (await queryOne<{ id: string }>(
      `INSERT INTO domains_domain (id, domain_name, status, registration_years, registrar_order_id, registrar_transaction_id, auto_renew, locked, privacy_enabled, expires_at, created_at, updated_at, owner_id, registrar_id, tld_id)
       SELECT gen_random_uuid_fallback(), $1, 'active', 1, '1', '', false, false, false, '2027-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, r.id, (SELECT id FROM domains_tld WHERE extension = '.com') FROM domains_registrar r WHERE r.slug = $3
       RETURNING id`.replace('gen_random_uuid_fallback()', `'${crypto.randomUUID()}'`),
      [name, ownerId, registrar],
    ))!.id
  }

  const fake: Partial<Registrar> & { slug: string; catalog: SupplierTld[] } = {
    slug: 'openprovider',
    catalog: [],
    getDomainState: async (domain) => state[domain],
    setLock: async (domain, locked) => { state[domain] = { ...state[domain], locked }; return { success: true, domain_name: domain, registrar: 'openprovider' } },
    setPrivacy: async (domain, enabled) => { state[domain] = { ...state[domain], privacy_enabled: enabled }; return { success: true, domain_name: domain, registrar: 'openprovider' } },
    getAuthCode: async () => 'EPP-SYNTHETIC-CODE',
    listTlds: async () => fake.catalog,
  }

  beforeAll(async () => {
    api = await import('../server/api')
    const { transaction } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
    const domains = await import('../server/domains/service')
    await domains.seedTlds()
    await domains.seedSupplierRecords()
    await (await import('../server/pricing/engine')).seedCurrencies()
    ;(await import('../server/domains/registrars')).setRegistrarOverride((slug) => (slug === 'openprovider' ? (fake as unknown as Registrar) : undefined))
  })
  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())
  afterAll(async () => {
    ;(await import('../server/domains/registrars')).setRegistrarOverride(null)
    await (await import('../server/db')).database().end()
  })

  it('lets only the owner read and change lock and privacy, mirroring the result locally and auditing it', async () => {
    const owner = await customer()
    const other = await customer()
    const name = `secure-${run}.com`
    const id = await ownDomain(owner.id, name)
    state[name] = { status: 'active', expires_on: '2027-01-01', locked: false, lockable: true, privacy_enabled: false, privacy_allowed: true, auth_code_required_for_transfer: true, can_renew: true }

    expect((await call('GET', `/domains/customer/domains/${id}/status/`, { token: other.access })).status).toBe(404)
    expect((await call('GET', `/domains/customer/domains/${id}/status/`, { token: owner.access })).body).toEqual({
      domain_id: id, domain_name: name, status: 'active', expires_on: '2027-01-01', locked: false, lock_available: true, privacy_enabled: false, privacy_available: true, transfer_code_required: true, renewable: true,
    })
    expect((await call('PUT', `/domains/customer/domains/${id}/lock/`, { token: owner.access, body: { locked: true } })).body).toMatchObject({ locked: true })
    expect((await call('PUT', `/domains/customer/domains/${id}/privacy/`, { token: owner.access, body: { enabled: true } })).body).toMatchObject({ privacy_enabled: true })
    const detail = (await call('GET', `/domains/customer/domains/${id}/`, { token: owner.access })).body
    expect(detail).toMatchObject({ locked: true, privacy_enabled: true, registrar: 'Maven Host' })

    const { query } = await import('../server/db')
    expect((await query<{ event: string }>(`SELECT event FROM audit_auditlog WHERE object_id = $1 ORDER BY id`, [id])).map((row) => row.event)).toEqual(['domain_locked', 'domain_privacy_enabled'])
  }, 60_000)

  it('shows the transfer code only to the owner, emails the owner and never logs the code', async () => {
    const owner = await customer()
    const name = `transfer-${run}.com`
    const id = await ownDomain(owner.id, name)
    const { sentEmails } = await import('../server/communications/email')
    const before = sentEmails().length
    expect((await call('POST', `/domains/customer/domains/${id}/auth-code/`, { token: owner.access })).body).toEqual({ domain_id: id, domain_name: name, auth_code: 'EPP-SYNTHETIC-CODE' })
    const message = sentEmails().slice(before).find((item) => item.to[0] === owner.email)
    expect(message?.subject).toBe(`Transfer code retrieved for ${name}`)
    expect(message?.text).not.toContain('EPP-SYNTHETIC-CODE')
    const { query } = await import('../server/db')
    const audits = await query<{ event: string; metadata: unknown; message: string }>(`SELECT event, metadata, message FROM audit_auditlog WHERE object_id = $1`, [id])
    expect(audits.map((row) => row.event)).toEqual(['domain_auth_code_retrieved'])
    expect(JSON.stringify(audits)).not.toContain('EPP-SYNTHETIC-CODE')
  }, 60_000)

  it('brands customer views as Maven Host while staff still see the supplier, and fails closed without a capability', async () => {
    const owner = await customer()
    const support = await customer('Support')
    const id = await ownDomain(owner.id, `brand-${run}.com`)
    expect((await call('GET', '/domains/customer/domains/', { token: owner.access })).body).toEqual([expect.objectContaining({ id, registrar: 'Maven Host' })])
    expect((await call('GET', `/staff/customers/${owner.id}/domains/`, { token: support.access })).body).toEqual([expect.objectContaining({ id, registrar: 'Openprovider' })])

    const standbyId = await ownDomain(owner.id, `standby-${run}.co.ke`, 'register_ke')
    expect((await call('PUT', `/domains/customer/domains/${standbyId}/lock/`, { token: owner.access, body: { locked: true } })).body).toEqual({
      detail: 'This action is not available for this domain online yet. Please contact Maven Host support.', code: 'supplier_feature_unavailable',
    })
  }, 60_000)

  it('syncs the catalog: new extensions inactive, prices only where offered, withdrawn extensions unsupported', async () => {
    const tld = (extension: string, extra: Partial<SupplierTld> = {}): SupplierTld => ({
      extension, active: true, min_period: 1, max_period: 10, renew_available: true, transfer_available: true, transfer_auth_code_required: true, privacy_allowed: true,
      dnssec_allowed: true, restrictions: [], setup_fee: false,
      prices: { register: { currency: 'USD', price: '7.10' }, renew: { currency: 'USD', price: '8.20' }, transfer: { currency: 'USD', price: '7.00' } }, ...extra,
    })
    const fresh = `.n${run}`.slice(0, 20)
    const setup = `.s${run}`.slice(0, 20)
    const gone = `.g${run}`.slice(0, 20)
    fake.catalog = [tld(fresh), tld(setup, { setup_fee: true }), tld(gone)]
    const { syncDomainCatalog } = await import('../server/domains/platform')
    await syncDomainCatalog()
    fake.catalog = [tld(fresh, { prices: { register: { currency: 'USD', price: '7.50' }, renew: null, transfer: { currency: 'XYZ', price: '1' } }, renew_available: false }), tld(setup, { setup_fee: true })]
    const summary = await syncDomainCatalog()
    // Renewal no longer offered and transfer in an unknown currency: both cached prices are withdrawn, as are the
    // setup-fee extension's and the withdrawn extension's prices.
    expect(summary).toMatchObject({ extensions: 2, added: 0, supported: 2, priced: 1, price_changes: 1, skipped_currency: 1 })
    expect(summary.withdrawn_prices).toBeGreaterThanOrEqual(5)
    expect(summary.unsupported).toBeGreaterThanOrEqual(1)

    const { query, queryOne } = await import('../server/db')
    expect(await queryOne(`SELECT is_active, provider_supported, provider_metadata->'openprovider'->>'renew_available' AS renew FROM domains_tld WHERE extension = $1`, [fresh])).toEqual({ is_active: false, provider_supported: true, renew: 'false' })
    expect(await queryOne(`SELECT provider_supported FROM domains_tld WHERE extension = $1`, [gone])).toEqual({ provider_supported: false })
    const prices = await query<{ extension: string; price_type: string; price: string }>(
      `SELECT t.extension, p.price_type, p.price FROM domains_domainprice p JOIN domains_tld t ON t.id = p.tld_id WHERE t.extension = ANY($1) ORDER BY 1, 2`,
      [[fresh, setup]],
    )
    expect(prices).toEqual([{ extension: fresh, price_type: 'register', price: '7.50' }])
    expect(await queryOne(`SELECT count(*)::integer AS n FROM domains_domainprice p JOIN domains_tld t ON t.id = p.tld_id WHERE t.extension = $1`, [gone])).toEqual({ n: 0 })
  }, 60_000)
})
