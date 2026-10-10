import 'server-only'
import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import { queryOne } from '../../db'
import { pythonDumps } from '../../lib/python-json'
import { flag, tldExtensions } from '../routing'
import {
  ContactValidationError, OpenproviderNotReady, PricingNotAvailableError, RegistrarUnavailable, SupplierFeatureUnavailable, emptyRecordExtras,
  type Availability, type Contact, type ContactDetails, type DnsHost, type DnsRecord, type DomainState, type Registrar, type RegistrationRequest, type SupplierPrice, type SupplierTld,
} from '../types'

/** Port of apps/domains/clients/openprovider.py, openprovider_lifecycle.py and registrars/openprovider.py. */

// Openprovider moved to /v1 (functionally identical); /v1beta is switched off on 2027-06-30 (developer.openprovider.com).
const ALLOWED_URLS = new Set(['https://api.sandbox.openprovider.nl/v1beta', 'https://api.openprovider.eu/v1', 'https://api.openprovider.eu/v1beta'])
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/

class ExpiredToken extends Error {}

const config = () => ({
  enabled: flag('OPENPROVIDER_ENABLED'),
  transactions: flag('OPENPROVIDER_TRANSACTIONS_ENABLED'),
  apiUrl: (process.env.OPENPROVIDER_API_URL?.trim() || 'https://api.sandbox.openprovider.nl/v1beta').replace(/\/+$/, ''),
  username: process.env.OPENPROVIDER_USERNAME?.trim() ?? '',
  password: process.env.OPENPROVIDER_PASSWORD ?? '',
  clientIp: process.env.OPENPROVIDER_CLIENT_IP?.trim() ?? '',
  defaultNameservers: (process.env.OPENPROVIDER_DEFAULT_NAMESERVERS ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  supportedExtensions: (process.env.OPENPROVIDER_SUPPORTED_EXTENSIONS ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  maxPriceIncreasePercent: process.env.OPENPROVIDER_MAX_PRICE_INCREASE_PERCENT?.trim() || '0',
})

const tokens = new Map<string, { token: string; expiry: number }>()
const contactHandles = new Map<string, { handle: string; expiry: number }>()

type Row = Record<string, unknown>

function supplierDate(value: unknown): string | null {
  if (!value) return null
  const text = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new RegistrarUnavailable('Invalid supplier date; reconciliation is required.')
  return text
}

export class OpenproviderRegistrar implements Registrar {
  readonly slug = 'openprovider'
  private readonly config = config()

  private configuration() {
    if (!this.config.enabled) throw new RegistrarUnavailable('The domain supplier integration is disabled.')
    if (!ALLOWED_URLS.has(this.config.apiUrl)) throw new RegistrarUnavailable('The domain supplier endpoint is not configured correctly.')
    if (!this.config.username || !this.config.password) throw new RegistrarUnavailable('The domain supplier credentials are not configured.')
    return this.config.apiUrl
  }

  private get transactionReady() {
    return this.config.enabled && this.config.transactions
  }

  private requireReady() {
    // Customer-visible: never name the upstream supplier.
    if (!this.transactionReady) throw new OpenproviderNotReady('Domain registration services are temporarily unavailable.')
  }

  private async send(method: string, path: string, init: { headers?: Record<string, string>; json?: unknown; params?: Record<string, string | number> } = {}): Promise<Row> {
    const url = new URL(this.configuration() + path)
    for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, String(value))
    let response: Response
    try {
      response = await fetch(url, {
        method,
        redirect: 'manual',
        headers: { ...(init.json === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
        signal: AbortSignal.timeout(25_000),
      })
    } catch {
      throw new RegistrarUnavailable('The domain supplier request could not be completed. Please try again later.')
    }
    if (response.status === 401) throw new ExpiredToken()
    let body: Row
    try {
      if (!response.ok || (response.status >= 300 && response.status < 400)) throw new Error('status')
      body = (await response.json()) as Row
    } catch {
      throw new RegistrarUnavailable('The domain supplier request could not be completed. Please try again later.')
    }
    if (!body || typeof body !== 'object' || body.code !== 0 || body.maintenance || !body.data || typeof body.data !== 'object' || Array.isArray(body.data))
      throw new RegistrarUnavailable('The domain supplier request could not be completed. Please try again later.')
    return body.data as Row
  }

  private async token(refresh = false) {
    const url = this.configuration()
    const key = createHash('sha256').update([url, this.config.username, this.config.password, this.config.clientIp].join('\0')).digest('hex')
    const cached = tokens.get(key)
    if (cached && cached.expiry > Date.now() && !refresh) return cached.token
    const payload: Row = { username: this.config.username, password: this.config.password }
    if (this.config.clientIp) payload.ip = this.config.clientIp
    let data: Row
    try {
      data = await this.send('POST', '/auth/login', { json: payload })
    } catch (error) {
      if (error instanceof ExpiredToken) throw new RegistrarUnavailable('The domain supplier authentication failed.')
      throw error
    }
    if (typeof data.token !== 'string' || !data.token) throw new RegistrarUnavailable('The domain supplier authentication response was invalid.')
    // Conservative local reuse window; a 401 refreshes once. Tokens stay in process memory only.
    tokens.clear()
    tokens.set(key, { token: data.token, expiry: Date.now() + 300_000 })
    return data.token
  }

  private async read(path: string, params?: Record<string, string | number>, method = 'GET', json?: unknown): Promise<Row> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0)
      try {
        return await this.send(method, path, { headers: { Authorization: `Bearer ${token}` }, params, json })
      } catch (error) {
        if (!(error instanceof ExpiredToken)) throw error
        if (attempt) throw new RegistrarUnavailable('Supplier authentication failed.')
      }
    }
    throw new RegistrarUnavailable('Supplier authentication failed.')
  }

  private async readResource(path: string, params?: Record<string, string | number>) {
    if (!/^\/(domains(?:\/\d+(?:\/authcode)?)?|customers\/[A-Za-z0-9_-]+|tlds(?:\/[a-z0-9.-]+)?|dns\/(zones\/[a-z0-9.-]+|nameservers\/[a-z0-9.-]+))$/.test(path))
      throw new RegistrarUnavailable('Invalid supplier resource.')
    return this.read(path, params)
  }

  private async write(method: 'POST' | 'PUT', path: string, payload: unknown) {
    this.configuration()
    if (!this.config.transactions) throw new OpenproviderNotReady('Domain registration services are temporarily unavailable.')
    if (!/^\/(customers|domains(?:\/transfer|\/\d+(?:\/renew)?)?|dns\/(zones\/[a-z0-9.-]+|nameservers(?:\/[a-z0-9.-]+)?))$/.test(path))
      throw new OpenproviderNotReady('Unsupported supplier mutation.')
    const token = await this.token()
    try {
      // Never automatically replay an irreversible mutation.
      const data = await this.send(method, path, { headers: { Authorization: `Bearer ${token}` }, json: payload })
      if (data.success === false) throw new RegistrarUnavailable('Supplier operation was not completed; reconcile before retrying.')
      return data
    } catch (error) {
      if (error instanceof ExpiredToken) throw new RegistrarUnavailable('Supplier authentication expired. Reconcile before retrying.')
      throw error
    }
  }

  async domainParts(domain: string) {
    const name = domain.trim().toLowerCase().replace(/\.$/, '')
    if (!DOMAIN_PATTERN.test(name)) throw new ContactValidationError('Provide a valid fully qualified domain name.')
    const known = await tldExtensions()
    const extension = known.sort((a, b) => b.length - a.length).find((value) => name.endsWith(value)) ?? `.${name.split('.').pop()}`
    return { name: name.slice(0, -extension.length), extension: extension.replace(/^\./, '') }
  }

  async checkDomains(domains: string[]): Promise<Availability[]> {
    this.requireReady()
    if (!domains.length) return []
    this.configuration()
    const normalized = domains.map((name) => name.trim().toLowerCase().replace(/\.$/, ''))
    const results: Availability[] = []
    for (let offset = 0; offset < normalized.length; offset += 10) {
      const batch = normalized.slice(offset, offset + 10)
      const data = await this.read('/domains/check', undefined, 'POST', { domains: await Promise.all(batch.map((name) => this.domainParts(name))), with_price: false })
      if (!Array.isArray(data.results)) throw new RegistrarUnavailable('The domain supplier availability response was invalid.')
      const mapped = new Map<string, Availability>()
      for (const row of data.results as Row[]) {
        // Documented statuses are "free", "reserved" and "in use"; is_premium is only present for premium names.
        // v1 accepted only "free"/"active" and required is_premium, so ordinary taken names failed the whole search.
        if (!row || typeof row.status !== 'string' || !['free', 'reserved', 'in use', 'active'].includes(row.status) || (row.is_premium !== undefined && typeof row.is_premium !== 'boolean'))
          throw new RegistrarUnavailable('The domain supplier availability response was invalid.')
        const name = row.domain
        if (typeof name !== 'string' || !batch.includes(name) || mapped.has(name)) throw new RegistrarUnavailable('The domain supplier returned an unexpected domain result.')
        mapped.set(name, { domain: name, available: row.status === 'free', premium: row.is_premium === true, registrar: 'openprovider' })
      }
      if (mapped.size !== batch.length) throw new RegistrarUnavailable('The domain supplier returned incomplete availability results.')
      results.push(...batch.map((name) => mapped.get(name)!))
    }
    return results
  }

  async quoteDomain(domain: string, operation: 'create' | 'renew' | 'transfer' = 'create', years = 1): Promise<SupplierPrice> {
    if (!Number.isInteger(years) || years < 1 || years > 10) throw new ContactValidationError('Provide a supported domain operation and period.')
    const parts = await this.domainParts(domain)
    const data = await this.read('/domains/prices', { 'domain.name': parts.name, 'domain.extension': parts.extension, operation, period: years })
    try {
      // Ordinary TLD caches must not absorb a premium/domain-specific rate.
      if (data.is_premium !== false || data.is_promotion !== false) throw new Error('special')
      const price = ((data.price as Row).reseller as Row)
      const amount = new Decimal(String(price.price))
      const currency = price.currency
      if (!amount.isFinite() || amount.isNegative() || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new Error('invalid')
      return { tld: `.${parts.extension}`, years, price_type: ({ create: 'register', renew: 'renew', transfer: 'transfer' } as const)[operation], currency, price: amount.toString() }
    } catch {
      throw new RegistrarUnavailable('The supplier price requires verification before it can be used.')
    }
  }

  private async domainInfo(domain: string) {
    const parts = await this.domainParts(domain)
    const data = await this.readResource('/domains', { full_name: `${parts.name}.${parts.extension}`, limit: 2 })
    if (!Array.isArray(data.results)) throw new RegistrarUnavailable('Invalid domain ownership response.')
    const rows = data.results as Row[]
    const exact = rows.filter((row) => row && typeof row === 'object' && (row.domain as Row)?.name === parts.name && (row.domain as Row)?.extension === parts.extension)
    if (exact.length > 1 || (rows.length && !exact.length)) throw new RegistrarUnavailable('Unexpected domain ownership response.')
    if (!exact.length) return null
    const row = exact[0]
    if (!Number.isInteger(row.id) || (row.id as number) <= 0) throw new RegistrarUnavailable('Missing supplier domain identifier.')
    return row
  }

  private async owned(domain: string) {
    const row = await this.domainInfo(domain)
    if (!row) throw new RegistrarUnavailable('Domain ownership could not be verified with this supplier account.')
    return row
  }

  async getRegistrationInfo(domain: string) {
    const row = await this.domainInfo(domain)
    return {
      domain,
      is_owner: row !== null,
      status: row ? (row.status === 'ACT' ? 'active' : 'pending') : 'not_found',
      provider_domain_id: row ? String(row.id) : null,
      expiration_date: row ? supplierDate(row.renewal_date) : null,
    }
  }

  static customerPayload(contact: Contact) {
    const required = [contact.first_name, contact.last_name, contact.email, contact.address1, contact.city, contact.postal_code, contact.country, contact.street_number, contact.phone_country_code, contact.phone_area_code, contact.phone_subscriber_number]
    if (required.some((value) => typeof value !== 'string' || !value.trim() || value.trim() === 'Unknown'))
      throw new ContactValidationError('Provide complete customer contacts, including street number and structured phone fields.')
    if (!/^[A-Z]{2}$/.test(contact.country.toUpperCase()) || ![contact.phone_country_code, contact.phone_area_code, contact.phone_subscriber_number].every((value) => /^\d+$/.test(value)))
      throw new ContactValidationError('Provide an ISO country code and numeric phone components.')
    return {
      name: { first_name: contact.first_name, last_name: contact.last_name },
      company_name: contact.organization || '',
      email: contact.email,
      address: { street: contact.address1, number: contact.street_number, suffix: contact.street_suffix, city: contact.city, state: contact.state, zipcode: contact.postal_code, country: contact.country.toUpperCase() },
      // Openprovider's customer schema writes the country calling code with a leading "+".
      phone: { country_code: `+${contact.phone_country_code}`, area_code: contact.phone_area_code, subscriber_number: contact.phone_subscriber_number },
    }
  }

  private async customerHandle(contact: Contact) {
    const payload = OpenproviderRegistrar.customerPayload(contact)
    // Scope includes endpoint and account so sandbox handles never cross into production.
    const key = createHash('sha256').update(JSON.stringify([this.configuration(), this.config.username, payload])).digest('hex')
    const cached = contactHandles.get(key)
    if (cached && cached.expiry > Date.now()) return cached.handle
    const result = await this.write('POST', '/customers', payload)
    if (typeof result.handle !== 'string' || !/^[A-Za-z0-9_-]+$/.test(result.handle)) throw new RegistrarUnavailable('The supplier customer handle was invalid.')
    contactHandles.set(key, { handle: result.handle, expiry: Date.now() + 86_400_000 })
    return result.handle
  }

  private async handles(contacts: ContactDetails) {
    const roles = { owner_handle: contacts.registrant, admin_handle: contacts.admin, billing_handle: contacts.billing, tech_handle: contacts.technical }
    // Validate all roles before creating any supplier customers.
    for (const contact of Object.values(roles)) OpenproviderRegistrar.customerPayload(contact)
    const result: Record<string, string> = {}
    for (const [key, contact] of Object.entries(roles)) result[key] = await this.customerHandle(contact)
    return result
  }

  private async priceGuard(domain: string, operation: 'create' | 'renew' | 'transfer', years: number) {
    const quote = await this.quoteDomain(domain, operation, years)
    const cached = await queryOne<{ price: string; code: string }>(
      `SELECT p.price, c.code FROM domains_domainprice p JOIN domains_registrar r ON r.id = p.registrar_id JOIN domains_tld t ON t.id = p.tld_id
         JOIN currencies_currency c ON c.id = p.currency_id
        WHERE r.slug = 'openprovider' AND t.extension = $1 AND p.price_type = $2 AND p.years = $3 LIMIT 1`,
      [quote.tld, quote.price_type, years],
    )
    const tolerance = new Decimal(this.config.maxPriceIncreasePercent)
    if (!cached || cached.code !== quote.currency || tolerance.isNegative() || !tolerance.isFinite() || new Decimal(quote.price).gt(new Decimal(cached.price).mul(tolerance.div(100).add(1))))
      throw new PricingNotAvailableError('Supplier pricing changed or is unavailable; refresh pricing before purchase.')
    return quote
  }

  async registerDomain(request: RegistrationRequest) {
    this.requireReady()
    await this.priceGuard(request.domain, 'create', request.years)
    const nameservers = request.nameservers.length ? request.nameservers : this.config.defaultNameservers
    if (!nameservers.length) throw new ContactValidationError('Registration requires verified nameservers.')
    for (const name of nameservers) await this.domainParts(name)
    const result = await this.write('POST', '/domains', {
      domain: await this.domainParts(request.domain), period: request.years, autorenew: 'off',
      name_servers: nameservers.map((name) => ({ name })), ...(await this.handles(request)),
    })
    if (!Number.isInteger(result.id) || (result.id as number) <= 0 || typeof result.status !== 'string' || !['ACT', 'REQ'].includes(result.status))
      throw new RegistrarUnavailable('Registration needs supplier reconciliation before retrying.')
    return {
      success: true, registrar: 'openprovider', domain: request.domain, order_id: String(result.id), transaction_id: null,
      expiration_date: supplierDate(result.renewal_date), pending: result.status !== 'ACT', message: result.status !== 'ACT' ? 'Registry processing is pending.' : '',
    }
  }

  async renewDomain(domain: string, years: number) {
    this.requireReady()
    const row = await this.owned(domain)
    const previous = supplierDate(row.renewal_date)
    await this.priceGuard(domain, 'renew', years)
    const result = await this.write('POST', `/domains/${row.id}/renew`, { period: years })
    const expiry = supplierDate((await this.owned(domain)).renewal_date)
    if (result.status !== 'ACT' || !previous || !expiry || expiry <= previous)
      throw new RegistrarUnavailable('Renewal is unresolved; do not repeat the payment or renewal without reconciliation.')
    return { domain_name: domain, renewed: true, registrar: 'openprovider', previous_expiration_date: previous, new_expiration_date: expiry, years, order_id: String(row.id), transaction_id: null }
  }

  async getContacts(domain: string): Promise<ContactDetails> {
    const row = await this.owned(domain)
    const contact = async (role: string): Promise<Contact> => {
      const handle = row[role]
      if (typeof handle !== 'string' || !/^[A-Za-z0-9_-]+$/.test(handle)) throw new RegistrarUnavailable('Supplier contact handle is missing.')
      const data = await this.readResource(`/customers/${handle}`)
      const name = (data.name ?? {}) as Row, address = (data.address ?? {}) as Row, phone = (data.phone ?? {}) as Row
      const text = (source: Row, key: string) => String(source[key] ?? '')
      return {
        first_name: text(name, 'first_name'), last_name: text(name, 'last_name'), organization: text(data, 'company_name'), email: text(data, 'email'),
        phone: `+${text(phone, 'country_code').replace(/^\+/, '')}${text(phone, 'area_code')}${text(phone, 'subscriber_number')}`,
        address1: text(address, 'street'), address2: '', city: text(address, 'city'), state: text(address, 'state'), postal_code: text(address, 'zipcode'), country: text(address, 'country'),
        street_number: text(address, 'number'), street_suffix: text(address, 'suffix'),
        phone_country_code: text(phone, 'country_code').replace(/^\+/, ''), phone_area_code: text(phone, 'area_code'), phone_subscriber_number: text(phone, 'subscriber_number'),
      }
    }
    return { registrant: await contact('owner_handle'), admin: await contact('admin_handle'), technical: await contact('tech_handle'), billing: await contact('billing_handle') }
  }

  async setContacts(domain: string, contacts: ContactDetails) {
    this.requireReady()
    const row = await this.owned(domain)
    await this.write('PUT', `/domains/${row.id}`, await this.handles(contacts))
    return { success: true, domain_name: domain, registrar: 'openprovider' }
  }

  async getNameservers(domain: string) {
    const row = await this.owned(domain)
    return ((row.name_servers ?? []) as Row[]).map((ns) => String(ns.name))
  }

  async setNameservers(domain: string, nameservers: string[]) {
    this.requireReady()
    if (!nameservers.length) throw new ContactValidationError('Provide at least one nameserver.')
    for (const name of nameservers) await this.domainParts(name)
    const row = await this.owned(domain)
    await this.write('PUT', `/domains/${row.id}`, { name_servers: nameservers.map((name) => ({ name })) })
    return { success: true, domain_name: domain, registrar: 'openprovider' }
  }

  async getDnsHosts(domain: string): Promise<DnsHost[]> {
    const row = await this.owned(domain)
    const hosts: DnsHost[] = []
    for (const ns of (row.name_servers ?? []) as Row[]) {
      const name = String(ns.name)
      if (name.endsWith(`.${domain}`)) {
        const data = await this.readResource(`/dns/nameservers/${name}`)
        hosts.push({ hostname: String(data.name), ipv4: (data.ip as string) || null, ipv6: (data.ip6 as string) || null })
      }
    }
    return hosts
  }

  async setDnsHosts(domain: string, hosts: DnsHost[]) {
    this.requireReady()
    await this.owned(domain)
    // Existing glue only: do not guess whether an unknown host should be created.
    for (const host of hosts) {
      if (!host.hostname.endsWith(`.${domain}`) || !(host.ipv4 || host.ipv6)) throw new ContactValidationError('Glue must belong to the domain and have an IP address.')
    }
    for (const host of hosts) {
      await this.readResource(`/dns/nameservers/${host.hostname}`)
      await this.write('PUT', `/dns/nameservers/${host.hostname}`, { name: host.hostname, ip: host.ipv4 ?? '', ip6: host.ipv6 ?? '' })
    }
    return { success: true, domain_name: domain, registrar: 'openprovider' }
  }

  /** Python `hashlib.sha256(json.dumps(row, sort_keys=True))`: default separators are ", " and ": ". */
  static recordId(row: Row) {
    return createHash('sha256').update(pythonDumps(row, { sortKeys: true })).digest('hex')
  }

  private async zone(domain: string) {
    await this.domainParts(domain)
    await this.owned(domain)
    // Records are only returned when explicitly requested; v1 omitted the flag, so every zone read failed.
    const data = await this.readResource(`/dns/zones/${domain}`, { with_records: 'true' })
    if (data.name !== domain || !Array.isArray(data.records)) throw new RegistrarUnavailable('The supplier DNS zone could not be verified.')
    return { id: data.id, records: (data.records as Row[]).map((row) => Object.fromEntries(['name', 'type', 'value', 'ttl', 'prio'].filter((key) => key in row).map((key) => [key, row[key]]))) }
  }

  private async zoneRecords(domain: string) {
    return (await this.zone(domain)).records
  }

  async getDnsRecords(domain: string): Promise<DnsRecord[]> {
    return (await this.zoneRecords(domain)).map((row) => ({
      ...emptyRecordExtras,
      id: OpenproviderRegistrar.recordId(row),
      type: row.type as DnsRecord['type'],
      host: String(row.name).replace(/\.$/, '') === domain ? '@' : String(row.name).replace(new RegExp(`\\.${domain.replace(/\./g, '\\.')}$`), ''),
      value: String(row.value),
      ttl: Number(row.ttl),
      priority: (row.prio as number | undefined) ?? null,
    }))
  }

  private static recordPayload(record: DnsRecord, domain: string) {
    if (!['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].includes(record.type)) throw new ContactValidationError('This record type requires a verified supplier-specific encoding.')
    // Openprovider stores any other TTL as 86400 without reporting it.
    if (![900, 3600, 10800, 21600, 43200, 86400].includes(record.ttl)) throw new ContactValidationError('Openprovider DNS supports TTL values of 900, 3600, 10800, 21600, 43200 or 86400 seconds.')
    const host = record.host === '@' || record.host === '' ? domain : record.host.endsWith(`.${domain}`) ? record.host : `${record.host}.${domain}`
    if (host !== domain && !host.endsWith(`.${domain}`)) throw new ContactValidationError('DNS record must belong to the zone.')
    const payload: Row = { name: host, type: record.type, value: record.value, ttl: record.ttl }
    if (record.priority !== null && record.priority !== undefined) payload.prio = record.priority
    return payload
  }

  private async mutateDns(domain: string, operation: 'add' | 'update' | 'remove', record?: DnsRecord, recordId?: string) {
    this.requireReady()
    const { id, records: rows } = await this.zone(domain)
    let delta: Row
    if (operation === 'add') delta = { add: [OpenproviderRegistrar.recordPayload(record!, domain)] }
    else {
      const identifier = operation === 'remove' ? recordId : record!.id
      const matches = rows.filter((row) => OpenproviderRegistrar.recordId(row) === identifier)
      if (matches.length !== 1) throw new ContactValidationError('DNS record changed or no longer exists; refresh before editing.')
      delta = operation === 'remove' ? { remove: matches } : { update: [{ original_record: matches[0], record: OpenproviderRegistrar.recordPayload(record!, domain) }] }
    }
    await this.write('PUT', `/dns/zones/${domain}`, { ...(id === undefined ? {} : { id }), name: domain, records: delta })
    return { success: true, domain_name: domain, registrar: 'openprovider' }
  }

  createDnsRecord(domain: string, record: DnsRecord) {
    return this.mutateDns(domain, 'add', record)
  }
  updateDnsRecord(domain: string, record: DnsRecord) {
    return this.mutateDns(domain, 'update', record)
  }
  deleteDnsRecord(domain: string, recordId: string) {
    return this.mutateDns(domain, 'remove', undefined, recordId)
  }

  /** GET /domains/{id}: live lock, WHOIS privacy and expiry (developer.openprovider.com, DomainService "Get domain"). */
  async getDomainState(domain: string): Promise<DomainState> {
    const row = await this.owned(domain)
    const data = await this.readResource(`/domains/${row.id}`)
    const yes = (key: string) => data[key] === true
    const authRequired = data.transfer_auth_code_required
    return {
      status: data.status === 'ACT' ? 'active' : typeof data.status === 'string' && data.status ? data.status.toLowerCase() : 'unknown',
      expires_on: supplierDate(data.renewal_date),
      locked: yes('is_locked'),
      lockable: yes('is_lockable'),
      privacy_enabled: yes('is_private_whois_enabled'),
      privacy_allowed: yes('is_private_whois_allowed'),
      auth_code_required_for_transfer: authRequired !== undefined && authRequired !== null && authRequired !== '' && authRequired !== '0' && authRequired !== false,
      can_renew: yes('can_renew'),
    }
  }

  /** PUT /domains/{id} with is_locked; refused when the registry does not support locking this domain. */
  async setLock(domain: string, locked: boolean) {
    this.requireReady()
    const state = await this.getDomainState(domain)
    if (!state.lockable) throw new SupplierFeatureUnavailable('Registrar lock is not available for this domain.')
    if (state.locked !== locked) await this.write('PUT', `/domains/${(await this.owned(domain)).id}`, { is_locked: locked })
    return { success: true, domain_name: domain, registrar: 'openprovider' }
  }

  /** PUT /domains/{id} with is_private_whois_enabled; refused when the extension does not allow WHOIS privacy. */
  async setPrivacy(domain: string, enabled: boolean) {
    this.requireReady()
    const state = await this.getDomainState(domain)
    if (!state.privacy_allowed) throw new SupplierFeatureUnavailable('WHOIS privacy is not available for this domain extension.')
    if (state.privacy_enabled !== enabled) await this.write('PUT', `/domains/${(await this.owned(domain)).id}`, { is_private_whois_enabled: enabled })
    return { success: true, domain_name: domain, registrar: 'openprovider' }
  }

  /** GET /domains/{id}/authcode (AuthCode "Get auth code") for a transfer to another registrar. */
  async getAuthCode(domain: string) {
    this.configuration()
    const row = await this.owned(domain)
    const data = await this.readResource(`/domains/${row.id}/authcode`)
    if (data.success === false || typeof data.auth_code !== 'string' || !data.auth_code)
      throw new SupplierFeatureUnavailable('A transfer code is not available for this domain online. Please contact support.')
    return data.auth_code
  }

  /**
   * GET /tlds (TldService "List tlds") with limit/offset pagination and prices. Reads are idempotent, so transient
   * failures are retried with backoff; the whole sync fails rather than storing a partial catalog.
   */
  async listTlds(): Promise<SupplierTld[]> {
    this.configuration()
    const pageSize = 100
    const results: SupplierTld[] = []
    for (let offset = 0, page = 0; page < 100; offset += pageSize, page++) {
      let data: Row | undefined
      for (let attempt = 1; !data; attempt++) {
        try {
          data = await this.readResource('/tlds', { limit: pageSize, offset, with_price: 'true', with_restrictions: 'true' })
        } catch (error) {
          if (!(error instanceof RegistrarUnavailable) || attempt >= 3) throw error
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
        }
      }
      if (!Array.isArray(data.results)) throw new RegistrarUnavailable('The supplier catalog response was invalid.')
      for (const row of data.results as Row[]) results.push(OpenproviderRegistrar.parseTld(row))
      const total = typeof data.total === 'number' ? data.total : 0
      if (!(data.results as Row[]).length || offset + pageSize >= total) return results
    }
    throw new RegistrarUnavailable('The supplier catalog is larger than expected; review before importing.')
  }

  static parseTld(row: Row): SupplierTld {
    if (!row || typeof row.name !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(row.name)) throw new RegistrarUnavailable('The supplier catalog contained an invalid extension.')
    const table = (row.prices ?? {}) as Record<string, Record<string, Row> | undefined>
    const price = (key: string) => {
      const cost = table[key]?.reseller
      if (!cost || cost.price === undefined || cost.price === null) return null
      const amount = new Decimal(String(cost.price))
      if (!amount.isFinite() || amount.isNegative() || !/^[A-Z]{3}$/.test(String(cost.currency))) return null
      return { currency: String(cost.currency), price: amount.toString() }
    }
    const setup = table.setup_price?.reseller?.price
    return {
      extension: `.${row.name}`,
      active: row.status === 'ACT',
      min_period: typeof row.min_period === 'number' ? row.min_period : null,
      max_period: typeof row.max_period === 'number' ? row.max_period : null,
      renew_available: row.renew_available === true,
      transfer_available: row.transfer_available === true,
      transfer_auth_code_required: row.is_transfer_auth_code_required === true,
      privacy_allowed: row.is_private_whois_allowed === true,
      dnssec_allowed: row.dnssec_allowed === true,
      restrictions: Array.isArray(row.restrictions) ? row.restrictions : [],
      setup_fee: setup !== undefined && setup !== null && !new Decimal(String(setup)).isZero(),
      prices: { register: price('create_price'), renew: price('renew_price'), transfer: price('transfer_price') },
    }
  }

  /** One-year wholesale lifecycle pricing for explicitly approved extensions (sync_openprovider_catalog). */
  async getPricing(action: 'REGISTER' | 'RENEW' | 'TRANSFER'): Promise<SupplierPrice[]> {
    const keys = { REGISTER: ['create_price', 'register'], RENEW: ['renew_price', 'renew'], TRANSFER: ['transfer_price', 'transfer'] } as const
    if (!this.config.supportedExtensions.length) throw new OpenproviderNotReady('Configure explicitly approved Openprovider extensions before catalog import.')
    const [priceKey, priceType] = keys[action]
    const prices: SupplierPrice[] = []
    for (const extension of this.config.supportedExtensions) {
      const name = extension.replace(/^\./, '').toLowerCase()
      if (!/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(name)) throw new OpenproviderNotReady('Invalid configured extension.')
      const row = await this.readResource(`/tlds/${name}`)
      if (row.name !== name || row.status !== 'ACT' || row.min_period !== 1) throw new OpenproviderNotReady('Extension eligibility and registration periods require verification.')
      if (action === 'RENEW' && row.renew_available !== true) continue
      if (action === 'TRANSFER' && row.transfer_available !== true) continue
      const table = (row.prices ?? {}) as Record<string, Record<string, Row>>
      try {
        // Exclude TLDs needing extra setup fees rather than underquoting a purchase.
        if (!new Decimal(String(table.setup_price?.reseller?.price ?? 0)).isZero()) throw new Error('setup')
        const cost = table[priceKey].reseller
        const amount = new Decimal(String(cost.price))
        if (!amount.isFinite() || amount.isNegative() || !/^[A-Z]{3}$/.test(String(cost.currency))) throw new Error('invalid')
        prices.push({ tld: `.${name}`, years: 1, price_type: priceType, currency: String(cost.currency), price: amount.toString() })
      } catch {
        throw new RegistrarUnavailable('Catalog pricing requires account verification.')
      }
    }
    return prices
  }
}
