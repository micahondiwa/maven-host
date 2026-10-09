import 'server-only'
import { randomUUID } from 'node:crypto'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { notFound } from '../http/errors'
import { calculatePrice, currencyByCode, defaultPricingRule, type Currency } from '../pricing/engine'
import { audit } from '../audit/audit'
import { dispatch } from '../events/bus'
import { assertSupplierReady, extensionFor, routingConfig, slugForExtension, tldExtensions } from './routing'
import { registrarFor } from './registrars'
import {
  DomainNotRenewableError, DomainRegistrationPending, DomainUnavailableError, PricingNotAvailableError,
  type Availability, type ContactDetails, type DnsHost, type DnsRecord, type RegistrationRequest, type RegistrationResult,
} from './types'

/** Port of apps/domains/services (search, customer domains, registration, renewal, management). */

export class DomainCatalogUnavailable extends Error {}

type DomainRow = {
  id: string; owner_id: string; registrar_id: number; tld_id: number | null; domain_name: string; status: string; registration_years: number
  registrar_order_id: string; registrar_transaction_id: string; auto_renew: boolean; locked: boolean; privacy_enabled: boolean
  expires_at: string | null; created_at: Date; updated_at: Date; registrar_slug: string; registrar_name: string; tld_extension: string | null
}

const DOMAIN_SELECT = `SELECT d.*, r.slug AS registrar_slug, r.name AS registrar_name, t.extension AS tld_extension
  FROM domains_domain d JOIN domains_registrar r ON r.id = d.registrar_id LEFT JOIN domains_tld t ON t.id = d.tld_id`

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', active: 'Active', expired: 'Expired', transferred: 'Transferred', suspended: 'Suspended', cancelled: 'Cancelled' }
export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status

// --- Search (CustomerSearchService), cached for 30 seconds like v1 ---

const searchCache = new Map<string, { expires: number; payload: unknown }>()
const PRIORITY = ['.com', '.net', '.org', '.co', '.io', '.info', '.biz', '.me']

type Price = { product_id: number; usd: string }

export async function searchDomains(input: { domain: string; years: number; suggestionLimit: number; suggestionOffset: number }) {
  const key = JSON.stringify([routingConfig.enabled, routingConfig.defaultRegistrar, routingConfig.generalRegistrar, routingConfig.countryRegistrars, input])
  const cached = searchCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.payload
  const payload = await runSearch(input)
  if (searchCache.size > 2000) searchCache.clear()
  searchCache.set(key, { expires: Date.now() + 30_000, payload })
  return payload
}

async function runSearch({ domain: rawDomain, years, suggestionLimit, suggestionOffset }: { domain: string; years: number; suggestionLimit: number; suggestionOffset: number }) {
  let domain = rawDomain.trim().toLowerCase()
  const routed = routingConfig.enabled
  const registrarSlug = routingConfig.defaultRegistrar
  const tlds = await query<{ id: number; extension: string; is_featured: boolean; registration_order: number }>(
    `SELECT id, extension, is_featured, registration_order FROM domains_tld WHERE is_active ${routed ? '' : 'AND provider_supported'} ORDER BY registration_order DESC`,
  )
  let supported = tlds.map((tld) => tld.extension)
  if (routed) {
    const pairs = new Set((await query<{ pair: string }>(
      `SELECT DISTINCT t.extension || '|' || r.slug AS pair FROM domains_domainprice p JOIN domains_tld t ON t.id = p.tld_id JOIN domains_registrar r ON r.id = p.registrar_id
        WHERE t.is_active AND r.is_active AND p.price_type = 'register' AND p.years = $1`,
      [years],
    )).map((row) => row.pair))
    supported = supported.filter((extension) => pairs.has(`${extension}|${slugForExtension(extension)}`))
  }
  if (!supported.length && !(await queryOne('SELECT 1 FROM domains_tld LIMIT 1'))) throw new DomainCatalogUnavailable()
  if (!domain.includes('.')) {
    const preferred = ['.com', '.net', '.org'].find((ext) => supported.includes(ext)) ?? supported[0]
    if (!preferred) throw new DomainCatalogUnavailable()
    domain += preferred
  }
  const matching = [...supported].sort((a, b) => b.length - a.length).find((ext) => domain.endsWith(ext)) ?? null
  const fallback = [...routingConfig.countryExtensions].sort((a, b) => b.length - a.length).find((ext) => domain.endsWith(ext)) ?? `.${domain.split('.').pop()}`
  const searched = matching ?? fallback
  const namePart = domain.slice(0, -searched.length)
  const pageSize = Math.min(suggestionLimit, 49)

  const candidateRows = await query<{ extension: string; is_featured: boolean; registration_order: number }>(
    routed
      ? `SELECT DISTINCT t.extension, t.is_featured, t.registration_order FROM domains_tld t JOIN domains_domainprice p ON p.tld_id = t.id JOIN domains_registrar r ON r.id = p.registrar_id
          WHERE t.is_active AND p.price_type = 'register' AND p.years = $1 AND r.is_active AND t.extension = ANY($2)`
      : `SELECT DISTINCT t.extension, t.is_featured, t.registration_order FROM domains_tld t JOIN domains_domainprice p ON p.tld_id = t.id JOIN domains_registrar r ON r.id = p.registrar_id
          JOIN currencies_currency c ON c.id = p.currency_id
          WHERE t.is_active AND t.provider_supported AND p.price_type = 'register' AND p.years = $1 AND r.slug = $2 AND c.code = 'USD'`,
    routed ? [years, supported] : [years, registrarSlug],
  )
  const priority = (ext: string) => (PRIORITY.includes(ext) ? PRIORITY.indexOf(ext) : 100)
  const ordered = candidateRows
    .filter((row) => row.extension !== matching)
    .sort((a, b) => priority(a.extension) - priority(b.extension) || Number(b.is_featured) - Number(a.is_featured) || a.registration_order - b.registration_order || (a.extension < b.extension ? -1 : a.extension > b.extension ? 1 : 0))
    .map((row) => row.extension)
  const extensionPage = ordered.slice(suggestionOffset, suggestionOffset + pageSize + 1)
  const pricedExtensions = extensionPage.slice(0, pageSize)
  const alternatives = pricedExtensions.map((ext) => namePart + ext)
  const names = [...(matching ? [domain] : []), ...alternatives]

  const groups = new Map<string, string[]>()
  for (const name of names) {
    const extension = name === domain ? matching! : pricedExtensions[alternatives.indexOf(name)]
    const slug = routed ? slugForExtension(extension) : registrarSlug
    groups.set(slug, [...(groups.get(slug) ?? []), name])
  }
  const checked = new Map<string, Availability>()
  for (const [slug, batch] of groups) {
    if (routed) assertSupplierReady(slug)
    for (const item of await registrarFor(slug).checkDomains(batch)) checked.set(item.domain.toLowerCase(), item)
  }
  const exactSlug = routed ? slugForExtension(searched) : registrarSlug
  const exact = checked.get(domain) ?? { domain, available: false, premium: false, registrar: exactSlug }
  const result: { domain: string; available: boolean; premium: boolean; registrar: string; message: string | null; prices: Record<string, Price>; suggestions: unknown[]; next_offset: number | null } = {
    domain: exact.domain, available: exact.available, premium: exact.premium, registrar: exact.registrar,
    message: matching ? null : 'This extension is not currently supported for registration.',
    prices: {}, suggestions: [], next_offset: pageSize && extensionPage.length > pageSize ? suggestionOffset + pageSize : null,
  }

  const rule = await defaultPricingRule()
  const usd = await currencyByCode('USD')
  const prices = new Map<string, Record<string, Price>>()
  if (rule && usd) {
    const rows = await query<{ id: number; price: string; price_type: string; extension: string; slug: string; currency_id: number }>(
      `SELECT p.id, p.price, p.price_type, t.extension, r.slug, p.currency_id FROM domains_domainprice p JOIN domains_tld t ON t.id = p.tld_id JOIN domains_registrar r ON r.id = p.registrar_id
        WHERE t.extension = ANY($1) AND p.years = $2 ORDER BY t.extension, p.price_type, p.years`,
      [[...(matching ? [matching] : []), ...pricedExtensions], years],
    )
    const currencies = new Map<number, Currency>()
    for (const row of rows) {
      const expected = routed ? slugForExtension(row.extension) : registrarSlug
      if (row.slug !== expected) continue
      if (!currencies.has(row.currency_id)) currencies.set(row.currency_id, (await queryOne<Currency>('SELECT * FROM currencies_currency WHERE id = $1', [row.currency_id]))!)
      const quote = await calculatePrice({ supplierPrice: row.price, supplierCurrency: currencies.get(row.currency_id)!, targetCurrency: usd, rule })
      const key = `${row.extension}|${expected}`
      prices.set(key, { ...(prices.get(key) ?? {}), [row.price_type]: { product_id: row.id, usd: quote.sellingPrice } })
    }
  }
  if (exact.available && !exact.premium && matching) result.prices = prices.get(`${matching}|${exact.registrar}`) ?? {}
  pricedExtensions.forEach((extension, index) => {
    const value = checked.get(alternatives[index])
    if (value)
      result.suggestions.push({
        domain: value.domain, available: value.available, premium: value.premium,
        registration_price: value.available && !value.premium ? prices.get(`${extension}|${value.registrar}`)?.register ?? null : null,
      })
  })
  return result
}

// --- Public catalog (api/views/catalog.py) ---

export async function listTlds(params: URLSearchParams) {
  const search = params.get('search')
  return query(
    `SELECT id, extension, display_name, is_featured, supports_dnssec, supports_idn FROM domains_tld
      WHERE is_active AND provider_supported ${params.get('featured') === 'true' ? 'AND is_featured' : ''}
        ${search ? `AND (extension ILIKE $1 OR display_name ILIKE $1)` : ''}
      ORDER BY registration_order, extension`,
    search ? [`%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`] : [],
  )
}

export async function listDomainPrices(params: URLSearchParams) {
  const tld = params.get('tld')
  const priceType = params.get('price_type')
  const values: unknown[] = []
  let filters = ''
  if (tld) {
    values.push(tld.startsWith('.') ? tld : `.${tld}`)
    filters += ` AND upper(t.extension) = upper($${values.length})`
  }
  if (priceType) {
    values.push(priceType)
    filters += ` AND p.price_type = $${values.length}`
  }
  const rows = await query<{ id: number; price: string; price_type: string; years: number; extension: string; currency_id: number }>(
    `SELECT p.id, p.price, p.price_type, p.years, t.extension, p.currency_id FROM domains_domainprice p JOIN domains_registrar r ON r.id = p.registrar_id
       JOIN domains_tld t ON t.id = p.tld_id JOIN currencies_currency c ON c.id = p.currency_id
      WHERE r.is_active AND t.is_active AND t.provider_supported AND c.code = 'USD'${filters} ORDER BY t.registration_order, t.extension, p.price_type, p.years`,
    values,
  )
  const rule = await defaultPricingRule()
  const usd = await currencyByCode('USD')
  const kes = await currencyByCode('KES')
  if (!rule || !usd || !kes) return []
  return Promise.all(rows.map(async (row) => ({
    product_id: row.id, tld: row.extension, price_type: row.price_type, years: row.years,
    usd: (await calculatePrice({ supplierPrice: row.price, supplierCurrency: usd, targetCurrency: usd, rule })).sellingPrice,
    kes: (await calculatePrice({ supplierPrice: row.price, supplierCurrency: usd, targetCurrency: kes, rule })).sellingPrice,
  })))
}

// --- Customer domains ---

export async function ownedDomain(ownerId: string, domainId: string, db: Queryable = database()) {
  const domain = await queryOne<DomainRow>(`${DOMAIN_SELECT} WHERE d.owner_id = $1 AND d.id = $2`, [ownerId, domainId], db)
  if (!domain) throw notFound('No Domain matches the given query.')
  return domain
}

export async function listCustomerDomains(ownerId: string) {
  return (await query<DomainRow>(`${DOMAIN_SELECT} WHERE d.owner_id = $1 ORDER BY d.domain_name`, [ownerId])).map((domain) => ({
    id: domain.id, domain_name: domain.domain_name, registrar: domain.registrar_name, status: statusLabel(domain.status), expires_at: domain.expires_at, auto_renew: domain.auto_renew,
  }))
}

export function domainDetail(domain: DomainRow) {
  return {
    id: domain.id, domain_name: domain.domain_name, registrar: domain.registrar_name, tld: domain.tld_extension, status: statusLabel(domain.status),
    registration_years: domain.registration_years, expires_at: domain.expires_at, auto_renew: domain.auto_renew, locked: domain.locked, privacy_enabled: domain.privacy_enabled,
  }
}

const registrarOf = (domain: DomainRow) => registrarFor(domain.registrar_slug)

export const domainManagement = {
  contacts: async (ownerId: string, id: string) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).getContacts(domain.domain_name)
  },
  updateContacts: async (ownerId: string, id: string, contacts: ContactDetails) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).setContacts(domain.domain_name, contacts)
  },
  nameservers: async (ownerId: string, id: string) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).getNameservers(domain.domain_name)
  },
  updateNameservers: async (ownerId: string, id: string, nameservers: string[]) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).setNameservers(domain.domain_name, nameservers)
  },
  hosts: async (ownerId: string, id: string) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).getDnsHosts(domain.domain_name)
  },
  updateHosts: async (ownerId: string, id: string, hosts: DnsHost[]) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).setDnsHosts(domain.domain_name, hosts)
  },
  records: async (ownerId: string, id: string) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).getDnsRecords(domain.domain_name)
  },
  createRecord: async (ownerId: string, id: string, record: DnsRecord) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).createDnsRecord(domain.domain_name, record)
  },
  updateRecord: async (ownerId: string, id: string, record: DnsRecord) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).updateDnsRecord(domain.domain_name, record)
  },
  deleteRecord: async (ownerId: string, id: string, recordId: string) => {
    const domain = await ownedDomain(ownerId, id)
    return registrarOf(domain).deleteDnsRecord(domain.domain_name, recordId)
  },
}

// --- Registration (RegistrationService) ---

/** `domains.domain.registered` (DomainRegisteredEvent): notifications and hosting listen on the event bus. */
function announceRegistered(domain: { id: string; domain_name: string; registrar_order_id: string; registrar_transaction_id: string; expires_at: string | null }, ownerId: string, registrar: string) {
  void dispatch('domains.domain.registered', {
    domain_id: domain.id, domain_name: domain.domain_name, customer_id: ownerId, registrar,
    registrar_order_id: domain.registrar_order_id || '', registrar_transaction_id: domain.registrar_transaction_id || '', expires_at: domain.expires_at,
  })
}

const reconciled = (domain: DomainRow, message: string): RegistrationResult => ({
  success: true, registrar: domain.registrar_slug, domain: domain.domain_name, order_id: domain.registrar_order_id || null,
  transaction_id: domain.registrar_transaction_id || null, expiration_date: domain.expires_at, message, pending: false,
})

/**
 * Registers with a durable local PENDING intent before the irreversible supplier call, and reconciles an earlier
 * attempt instead of purchasing twice.
 */
export async function registerDomain(ownerId: string, request: RegistrationRequest): Promise<RegistrationResult> {
  const domainName = request.domain.trim().toLowerCase()
  const known = await tldExtensions()
  const existing = await queryOne<DomainRow>(`${DOMAIN_SELECT} WHERE d.domain_name = $1`, [domainName])
  const supplierSlug = existing ? existing.registrar_slug : request.supplierSlug || slugForExtension(extensionFor(domainName, known))
  const registrar = registrarFor(supplierSlug)

  if (existing) {
    if (existing.owner_id !== ownerId) throw new DomainUnavailableError(`Domain '${domainName}' is already owned by another customer.`)
    if (existing.status === 'active') return reconciled(existing, 'Domain registration already reconciled.')
    if (existing.status === 'pending') {
      let lookup: Awaited<ReturnType<typeof registrar.getRegistrationInfo>> | null
      try {
        lookup = await registrar.getRegistrationInfo(domainName)
      } catch (error) {
        // A crash may have happened before the supplier call; availability distinguishes that from a completed purchase.
        const availability = (await registrar.checkDomains([domainName]))[0]
        if (!availability.available)
          throw new Error(`Domain registration for '${domainName}' is unresolved and the provider reports the domain unavailable. Manual reconciliation is required before retrying.`, { cause: error })
        lookup = null
      }
      const hasSupplierReference = Boolean(existing.registrar_order_id || existing.registrar_transaction_id)
      if (!lookup && hasSupplierReference) throw new DomainRegistrationPending('The accepted registry request requires reconciliation before any retry.')
      if (lookup && !lookup.is_owner && lookup.status === 'not_found') {
        if (hasSupplierReference) throw new DomainRegistrationPending('The accepted registry request is not yet visible; no repeat purchase was made.')
        if ((await registrar.checkDomains([domainName]))[0].available) lookup = null
      }
      if (lookup) {
        if (lookup.is_owner && !['active', 'act', 'ok'].includes(lookup.status.toLowerCase())) throw new DomainRegistrationPending('Registration is still processing at the registry; no repeat purchase was made.')
        if (lookup.is_owner) {
          const updated = (await queryOne<DomainRow>(
            `UPDATE domains_domain SET status = 'active', expires_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
            [existing.id, lookup.expiration_date],
          ))!
          announceRegistered(updated, ownerId, existing.registrar_slug)
          return { ...reconciled({ ...existing, ...updated }, 'Recovered provider-side registration.') }
        }
        throw new Error(`Domain registration for '${domainName}' is pending locally but provider ownership could not be confirmed. Manual reconciliation is required before retrying.`)
      }
    }
  }

  const availability = (await registrar.checkDomains([domainName]))[0]
  if (!availability.available) throw new DomainUnavailableError(`Domain '${domainName}' is no longer available.`)
  const extension = extensionFor(domainName, known)
  const supplierPrice = await queryOne<{ registrar_id: number; registrar_slug: string; tld_id: number }>(
    `SELECT p.registrar_id, r.slug AS registrar_slug, p.tld_id FROM domains_domainprice p JOIN domains_registrar r ON r.id = p.registrar_id JOIN domains_tld t ON t.id = p.tld_id
      WHERE r.slug = $1 AND t.extension = $2 AND p.years = $3 AND p.price_type = 'register' LIMIT 1`,
    [availability.registrar, extension, request.years],
  )
  if (!supplierPrice) throw new PricingNotAvailableError(`No registration pricing exists for ${extension} (${request.years} year(s)).`)
  assertSupplierReady(supplierPrice.registrar_slug)

  const intent = await transaction(async (client) => {
    await client.query(
      `INSERT INTO domains_domain (id, domain_name, status, registration_years, registrar_order_id, registrar_transaction_id, auto_renew, locked, privacy_enabled,
         expires_at, created_at, updated_at, owner_id, registrar_id, tld_id)
       VALUES ($1, $2, 'pending', $3, '', '', false, true, false, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5, $6) ON CONFLICT (domain_name) DO NOTHING`,
      [randomUUID(), domainName, request.years, ownerId, supplierPrice.registrar_id, supplierPrice.tld_id],
    )
    return (await queryOne<DomainRow>(`${DOMAIN_SELECT} WHERE d.domain_name = $1`, [domainName], client))!
  })
  if (intent.owner_id !== ownerId) throw new DomainUnavailableError(`Domain '${domainName}' is already owned by another customer.`)
  if (intent.status === 'active') return reconciled(intent, 'Domain registration already reconciled.')

  // No database transaction spans the irreversible supplier call; the PENDING intent is already durable.
  const result = await registrar.registerDomain({ ...request, domain: domainName })
  if (!result.success) throw new Error(result.message || `Registrar rejected registration of '${domainName}'.`)
  if (result.pending) {
    await database().query(
      `UPDATE domains_domain SET registrar_order_id = $2, registrar_transaction_id = $3, expires_at = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [intent.id, result.order_id ?? '', result.transaction_id ?? '', result.expiration_date],
    )
    throw new DomainRegistrationPending('Registration was accepted and is processing at the registry; no repeat purchase is needed.')
  }
  const updated = (await queryOne<DomainRow>(
    `UPDATE domains_domain SET status = 'active', registrar_order_id = $2, registrar_transaction_id = $3, expires_at = $4, registration_years = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [intent.id, result.order_id ?? '', result.transaction_id ?? '', result.expiration_date, request.years],
  ))!
  announceRegistered(updated, ownerId, result.registrar)
  return result
}

// --- Renewal (RenewalService) ---

export async function renewDomain(ownerId: string, domainId: string, years: number) {
  const domain = await queryOne<DomainRow>(`${DOMAIN_SELECT} WHERE d.owner_id = $1 AND d.id = $2 AND d.status <> 'suspended'`, [ownerId, domainId])
  if (!domain) throw notFound('No Domain matches the given query.')
  const supplierPrice = await queryOne('SELECT 1 FROM domains_domainprice WHERE registrar_id = $1 AND tld_id IS NOT DISTINCT FROM $2 AND years = $3 AND price_type = \'renew\' LIMIT 1', [domain.registrar_id, domain.tld_id, years])
  if (!supplierPrice) throw new PricingNotAvailableError('Renewal pricing is unavailable.')
  if (!(await defaultPricingRule())) throw new DomainNotRenewableError('PricingRule matching query does not exist.')
  const result = await registrarOf(domain).renewDomain(domain.domain_name, years)
  if (result.renewed) {
    let expires = result.new_expiration_date
    if (!expires && domain.expires_at) {
      // Legacy suppliers without an authoritative date retain the prior fallback.
      const next = new Date(`${domain.expires_at}T00:00:00Z`)
      next.setUTCDate(next.getUTCDate() + 365 * years)
      expires = next.toISOString().slice(0, 10)
    }
    await database().query(
      `UPDATE domains_domain SET expires_at = $2, registration_years = registration_years + $3, registrar_order_id = COALESCE(NULLIF($4, ''), registrar_order_id),
         registrar_transaction_id = COALESCE(NULLIF($5, ''), registrar_transaction_id), status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [domain.id, expires ?? domain.expires_at, years, result.order_id ?? '', result.transaction_id ?? ''],
    )
  }
  return result
}

// --- Staff operations (DomainOperationService) ---

export async function staffSetAutoRenew(input: { actorId: string; customerId: string; domainId: string; enabled: boolean; idempotencyKey: string; ipAddress?: string | null }) {
  return transaction(async (client) => {
    const domain = await queryOne<DomainRow>('SELECT * FROM domains_domain WHERE owner_id = $1 AND id = $2 FOR UPDATE', [input.customerId, input.domainId], client)
    if (!domain) return null
    const existing = await queryOne<{ id: string; domain_id: string; status: string; target_auto_renew: boolean }>(
      `SELECT id, domain_id, status, target_auto_renew FROM domains_domainoperation WHERE domain_id = $1 AND actor_id = $2 AND action = 'set_auto_renew' AND idempotency_key = $3`,
      [domain.id, input.actorId, input.idempotencyKey],
      client,
    )
    if (existing) return existing
    const operationId = randomUUID()
    await client.query(
      `INSERT INTO domains_domainoperation (id, action, idempotency_key, status, previous_auto_renew, target_auto_renew, result_payload, completed_at, created_at, updated_at, actor_id, domain_id)
       VALUES ($1, 'set_auto_renew', $2, 'pending', $3, $4, '{}', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5, $6)`,
      [operationId, input.idempotencyKey, domain.auto_renew, input.enabled, input.actorId, domain.id],
    )
    await client.query('UPDATE domains_domain SET auto_renew = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [domain.id, input.enabled])
    await audit({
      event: input.enabled ? 'domain_autorenew_enabled' : 'domain_autorenew_disabled', category: 'domain', status: 'success', performedBy: input.actorId,
      target: { appLabel: 'domains', model: 'domain', id: domain.id }, message: 'Domain auto-renew setting updated.', ipAddress: input.ipAddress ?? null,
      metadata: { customer_id: input.customerId, previous_auto_renew: domain.auto_renew, auto_renew: input.enabled, operation_id: operationId },
    }, client)
    await client.query(
      `UPDATE domains_domainoperation SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP, result_payload = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [operationId, JSON.stringify({ domain_id: domain.id, auto_renew: input.enabled })],
    )
    return { id: operationId, domain_id: domain.id, status: 'succeeded', target_auto_renew: input.enabled }
  })
}

// --- Catalog maintenance commands ---

/** import_supplier_prices: validated schedule for an approved supplier; never activates TLDs. */
export async function importSupplierPrices(slug: string, prices: { tld: string; years: number; price_type: string; currency: string; price: string }[]) {
  if (slug !== 'openprovider' || !prices.length) throw new Error('An explicit nonempty standby supplier price schedule is required.')
  const seen = new Set<string>()
  return transaction(async (client) => {
    const registrar = await queryOne<{ id: number }>('SELECT id FROM domains_registrar WHERE slug = $1', [slug], client)
    if (!registrar) throw new Error('Registrar matching query does not exist.')
    for (const row of prices) {
      const extension = row.tld.toLowerCase()
      const key = `${extension}|${row.price_type}|${row.years}`
      const currency = await currencyByCode(row.currency, client)
      if (!/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(extension) || extension.length > 20 || !['register', 'renew', 'transfer'].includes(row.price_type) || row.years < 1 || row.years > 10 || !/^\d+(\.\d+)?$/.test(row.price) || !currency || seen.has(key))
        throw new Error('The supplier schedule has invalid, unsupported or duplicate rows.')
      seen.add(key)
      await client.query(
        `INSERT INTO domains_tld (extension, display_name, is_active, supports_dnssec, supports_idn, registration_order, is_featured, provider_supported, provider_metadata, last_synced_at, created_at, updated_at)
         VALUES ($1, $2, false, false, false, 0, false, false, '{}', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (extension) DO NOTHING`,
        [extension, extension.replace(/^\./, '')],
      )
      const tld = (await queryOne<{ id: number }>('SELECT id FROM domains_tld WHERE extension = $1', [extension], client))!
      await client.query(
        `UPDATE domains_tld SET provider_metadata = provider_metadata || jsonb_build_object($2::text, jsonb_build_object('catalog_imported', true, 'synced_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'))) WHERE id = $1`,
        [tld.id, slug],
      )
      await client.query(
        `INSERT INTO domains_domainprice (price_type, years, price, last_synced_at, created_at, updated_at, currency_id, registrar_id, tld_id)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5, $6)
         ON CONFLICT (registrar_id, tld_id, price_type, years) DO UPDATE SET currency_id = EXCLUDED.currency_id, price = EXCLUDED.price, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
        [row.price_type, row.years, row.price, currency.id, registrar.id, tld.id],
      )
    }
    return prices.length
  })
}

/** seed_supplier_workflows: inactive supplier records for the approved providers. */
export async function seedSupplierRecords(db: Queryable = database()) {
  await db.query(`UPDATE domains_registrar SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE slug = 'kenic'`)
  const output: string[] = []
  for (const [slug, name, website] of [
    ['openprovider', 'Openprovider', 'https://www.openprovider.com'],
    ['register_ke', 'Register.co.ke', 'https://register.co.ke/'],
    ['registry_tz', 'registry.co.tz', 'https://registry.co.tz/'],
  ]) {
    const result = await db.query(
      `INSERT INTO domains_registrar (name, slug, website, is_active, created_at, updated_at) VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (slug) DO NOTHING`,
      [name, slug, website],
    )
    const row = (await queryOne<{ is_active: boolean }>('SELECT is_active FROM domains_registrar WHERE slug = $1', [slug], db))!
    output.push(`${name}: ${result.rowCount ? 'created' : 'existing'}; active=${row.is_active}`)
  }
  return output
}

const DEFAULT_TLDS: [string, string, boolean][] = [
  ['.com', 'Commercial', true], ['.net', 'Network', false], ['.org', 'Organization', false], ['.io', 'Technology', false],
  ['.co.ke', 'Kenya Commercial', true], ['.ac.ke', 'Kenya Academic', false], ['.co.tz', 'Tanzania Commercial', false],
]

/** seed_tlds (plus Tanzania's .co.tz, routed to registry.co.tz). */
export async function seedTlds(db: Queryable = database()) {
  for (const [order, [extension, name, featured]] of DEFAULT_TLDS.entries())
    await db.query(
      `INSERT INTO domains_tld (extension, display_name, is_active, supports_dnssec, supports_idn, registration_order, is_featured, provider_supported, provider_metadata, last_synced_at, created_at, updated_at)
       VALUES ($1, $2, true, true, false, $3, $4, true, '{}', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (extension) DO UPDATE SET display_name = EXCLUDED.display_name, registration_order = EXCLUDED.registration_order, is_featured = EXCLUDED.is_featured,
         supports_dnssec = EXCLUDED.supports_dnssec, supports_idn = EXCLUDED.supports_idn, is_active = true, updated_at = CURRENT_TIMESTAMP`,
      [extension, name, order, featured],
    )
  return DEFAULT_TLDS.length
}
