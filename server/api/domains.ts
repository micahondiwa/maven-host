import 'server-only'
import { isIP } from 'node:net'
import { queryOne } from '../db'
import { AllowAny, json, Router, type Context } from '../http/router'
import { HttpError, ValidationError } from '../http/errors'
import { f, fieldError, invalid, validate } from '../http/validation'
import { staffPermission } from '../auth/permissions'
import * as domains from '../domains/service'
import { domainSecurity } from '../domains/platform'
import { renewalQuote, setAutoRenew } from '../domains/renewals'
import { PricingNotAvailableError, RegistrarUnavailable, emptyRecordExtras, type ContactDetails, type DnsRecord } from '../domains/types'

/** apps/domains/api/urls.py and customer_urls.py */

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const BUSINESS_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

const searchSchema = {
  domain: f.string({ maxLength: 253 }).check((raw) => {
    let value = raw.trim().toLowerCase()
    if (!value.includes('.')) {
      value = value.replace(/\s+/g, '-')
      if (BUSINESS_NAME_PATTERN.test(value)) return value
    }
    if (value.includes('@') || !DOMAIN_PATTERN.test(value)) invalid('Enter a business name or a domain such as yourbusiness.com. Use letters, numbers, spaces or hyphens.')
    return value
  }),
  years: f.integer({ min: 1, max: 10, default: 1 }),
  suggestion_limit: f.integer({ min: 0, max: 49, default: 49 }),
  suggestion_offset: f.integer({ min: 0, max: 10000, default: 0 }),
}

const optionalText = (maxLength: number) => f.string({ maxLength, allowBlank: true, default: '' })
const contactSchema = {
  first_name: f.string({ maxLength: 100 }), last_name: f.string({ maxLength: 100 }), organization: optionalText(255), email: f.email(),
  phone: f.string({ maxLength: 50 }), address1: f.string({ maxLength: 255 }), address2: optionalText(255), city: f.string({ maxLength: 100 }),
  state: f.string({ maxLength: 100 }), postal_code: f.string({ maxLength: 30 }), country: f.string({ maxLength: 2 }),
  street_number: optionalText(30), street_suffix: optionalText(30), phone_country_code: optionalText(5), phone_area_code: optionalText(10), phone_subscriber_number: optionalText(20),
}
const contactsSchema = { registrant: f.object(contactSchema), admin: f.object(contactSchema), technical: f.object(contactSchema), billing: f.object(contactSchema) }

const hostname = (message: string) => f.string({ maxLength: 253 }).check((value) => {
  const normalized = value.trim().toLowerCase()
  if (!normalized.includes('.')) invalid(message)
  return normalized
})

const recordSchema = {
  id: f.string({ default: null as unknown as string }).nullable(),
  type: f.choice(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'] as const),
  host: f.string({ maxLength: 255 }).check((value) => value.trim().toLowerCase()),
  value: f.string(),
  ttl: f.integer({ min: 60, max: 86400 }),
  priority: f.integer().nullable().optional(),
  weight: f.integer().nullable().optional(),
  port: f.integer().nullable().optional(),
  protocol: f.string({ allowBlank: true }).optional(),
  flag: f.integer().nullable().optional(),
  tag: f.string({ allowBlank: true }).optional(),
}

/** DNSRecordSerializer.validate */
function validateRecord(values: Record<string, unknown>) {
  const type = values.type
  if (type === 'A' && isIP(String(values.value)) !== 4) fieldError('value', 'Invalid IPv4 address.')
  if (type === 'AAAA' && isIP(String(values.value)) !== 6) fieldError('value', 'Invalid IPv6 address.')
  if (type === 'MX' && (values.priority === undefined || values.priority === null)) fieldError('priority', 'MX records require priority.')
  if (type === 'SRV') for (const field of ['priority', 'weight', 'port', 'protocol']) if (values[field] === undefined || values[field] === null || values[field] === '') fieldError(field, `${field} is required.`)
  if (type === 'CAA') {
    if (values.flag === undefined || values.flag === null) fieldError('flag', 'CAA flag required.')
    if (!values.tag) fieldError('tag', 'CAA tag required.')
  }
}

function toRecord(values: Record<string, unknown>, id?: string): DnsRecord {
  return { ...emptyRecordExtras, ...values, id: id ?? (values.id as string | null) ?? null } as DnsRecord
}

async function readRecord(ctx: Context, id?: string) {
  const body = await ctx.body<{ record?: unknown }>()
  const data = validate({ record: f.object(recordSchema) }, body)
  try {
    validateRecord(data.record)
  } catch (error) {
    if (error instanceof ValidationError) throw new ValidationError({ record: error.errors })
    throw error
  }
  return toRecord(data.record, id)
}
const user = (ctx: Context) => ctx.authenticatedUser.id

async function search(ctx: Context) {
  const data = validate(searchSchema, Object.fromEntries(ctx.query))
  try {
    return await domains.searchDomains({ domain: data.domain, years: data.years, suggestionLimit: data.suggestion_limit, suggestionOffset: data.suggestion_offset })
  } catch (error) {
    if (error instanceof domains.DomainCatalogUnavailable)
      return json({ detail: 'Domain search is temporarily unavailable. Please try again later.', code: 'domain_catalog_unavailable' }, 503)
    if (error instanceof RegistrarUnavailable) return json({ detail: 'Domain registrar lookup failed.', code: 'registrar_unavailable' }, 502)
    throw error
  }
}

const registrationSchema = {
  domain: f.string({ maxLength: 253 }).optional(),
  domain_name: f.string({ maxLength: 253 }).optional(),
  years: f.integer({ min: 1, max: 10, default: 1 }),
  registrant: f.object(contactSchema).optional(),
  admin: f.object(contactSchema).optional(),
  billing: f.object(contactSchema).optional(),
  technical: f.object(contactSchema).optional(),
  nameservers: f.list(f.string(), { default: () => [] }),
}

async function register(ctx: Context) {
  const data = validate(registrationSchema, await ctx.body())
  const domain = data.domain || data.domain_name
  if (!domain) throw new ValidationError({ domain: ['A domain name is required.'] })
  const owner = ctx.authenticatedUser
  const fallback = {
    first_name: owner.first_name || 'Customer', last_name: owner.last_name || 'Customer', organization: '', email: owner.email, phone: '+254700000000',
    address1: '', address2: '', city: 'Nairobi', state: 'Nairobi', postal_code: '00100', country: 'KE',
    street_number: '', street_suffix: '', phone_country_code: '', phone_area_code: '', phone_subscriber_number: '',
  }
  try {
    const result = await domains.registerDomain(owner.id, {
      domain, years: data.years, nameservers: data.nameservers,
      registrant: data.registrant ?? fallback, admin: data.admin ?? fallback, billing: data.billing ?? fallback, technical: data.technical ?? fallback,
    } as never)
    return json({ success: result.success, registrar: result.registrar, domain: result.domain, domain_name: result.domain, order_id: result.order_id, transaction_id: result.transaction_id, expiration_date: result.expiration_date, message: result.message }, 201)
  } catch (error) {
    if (error instanceof PricingNotAvailableError) return json(error.body, 409)
    throw error
  }
}

const mutation = (result: { success: boolean; domain_name: string; registrar: string }, status = 200) =>
  json({ success: result.success, domain_name: result.domain_name, registrar: domains.CUSTOMER_REGISTRAR }, status)

export const domainRoutes = new Router()
  .get('tlds/', (ctx) => domains.listTlds(ctx.query), { authenticate: false, permissions: [AllowAny] })
  .get('pricing/', (ctx) => domains.listDomainPrices(ctx.query), { authenticate: false, permissions: [AllowAny] })
  .get('search/', search, { authenticate: false, permissions: [AllowAny], throttle: 'domain_search' })
  .get('customer/search/', search, { authenticate: false, permissions: [AllowAny], throttle: 'domain_search' })
  // Internal/admin registration; customer purchases are fulfilled from paid orders.
  .post('customer/register/', register, { permissions: [staffPermission('register_domain')] })
  .get('customer/domains/', (ctx) => domains.listCustomerDomains(user(ctx)))
  .get('customer/domains/<uuid:id>/', async (ctx) => domains.domainDetail(await domains.ownedDomain(user(ctx), ctx.params.id)))
  // v1 let any customer renew at the registrar without paying; renewals now require staff renewal rights
  // until they are sold through checkout.
  .post('customer/domains/<uuid:id>/renew/', async (ctx) => {
    const data = validate({ years: f.integer({ min: 1, max: 10, default: 1 }) }, await ctx.body())
    try {
      return await domains.renewDomain(user(ctx), ctx.params.id, data.years)
    } catch (error) {
      if (error instanceof PricingNotAvailableError) return json(error.body, 409)
      throw error
    }
  }, { permissions: [staffPermission('renew_domain')] })
  .get('customer/domains/<uuid:id>/contacts/', (ctx) => domains.domainManagement.contacts(user(ctx), ctx.params.id))
  .put('customer/domains/<uuid:id>/contacts/', async (ctx) => {
    const data = validate(contactsSchema, await ctx.body())
    return mutation(await domains.domainManagement.updateContacts(user(ctx), ctx.params.id, data as ContactDetails))
  })
  .get('customer/domains/<uuid:id>/nameservers/', async (ctx) => ({ nameservers: (await domains.domainManagement.nameservers(user(ctx), ctx.params.id)).map((hostname) => ({ hostname })) }))
  .put('customer/domains/<uuid:id>/nameservers/', async (ctx) => {
    const data = validate({ nameservers: f.list(f.object({ hostname: hostname('A valid nameserver hostname is required.') })) }, await ctx.body())
    if (data.nameservers.length < 2) throw new ValidationError({ nameservers: ['Ensure this field has at least 2 elements.'] })
    if (data.nameservers.length > 13) throw new ValidationError({ nameservers: ['Ensure this field has no more than 13 elements.'] })
    return mutation(await domains.domainManagement.updateNameservers(user(ctx), ctx.params.id, data.nameservers.map((item) => item.hostname)))
  })
  .get('customer/domains/<uuid:id>/dns-hosts/', async (ctx) => ({ hosts: await domains.domainManagement.hosts(user(ctx), ctx.params.id) }))
  .put('customer/domains/<uuid:id>/dns-hosts/', async (ctx) => {
    const host = f.object({ hostname: hostname('A fully-qualified hostname is required.'), ipv4: f.string({ allowBlank: true }).nullable().optional(), ipv6: f.string({ allowBlank: true }).nullable().optional() }).check((value) => {
      if (!value.ipv4 && !value.ipv6) invalid('Either an IPv4 or IPv6 address is required.')
      if (value.ipv4 && isIP(value.ipv4) !== 4) invalid('Invalid IPv4 address.')
      if (value.ipv6 && isIP(value.ipv6) !== 6) invalid('Invalid IPv6 address.')
    })
    const data = validate({ hosts: f.list(host) }, await ctx.body())
    return mutation(await domains.domainManagement.updateHosts(user(ctx), ctx.params.id, data.hosts.map((item) => ({ hostname: item.hostname, ipv4: item.ipv4 || null, ipv6: item.ipv6 || null }))))
  })
  .get('customer/domains/<uuid:id>/dns-records/', async (ctx) => ({ records: await domains.domainManagement.records(user(ctx), ctx.params.id) }))
  .post('customer/domains/<uuid:id>/dns-records/', async (ctx) => mutation(await domains.domainManagement.createRecord(user(ctx), ctx.params.id, await readRecord(ctx)), 201))
  .patch('customer/domains/<uuid:id>/dns-records/<str:record_id>/', async (ctx) => mutation(await domains.domainManagement.updateRecord(user(ctx), ctx.params.id, await readRecord(ctx, ctx.params.record_id))))
  .delete('customer/domains/<uuid:id>/dns-records/<str:record_id>/', async (ctx) => mutation(await domains.domainManagement.deleteRecord(user(ctx), ctx.params.id, ctx.params.record_id)))
  // Domain platform: live registry state and owner security controls (registrar lock, WHOIS privacy, transfer code).
  .get('customer/domains/<uuid:id>/status/', (ctx) => domainSecurity.state(user(ctx), ctx.params.id))
  .put('customer/domains/<uuid:id>/lock/', async (ctx) => {
    const data = validate({ locked: f.boolean() }, await ctx.body())
    return domainSecurity.setLock(user(ctx), ctx.params.id, data.locked, { userId: user(ctx), ip: ctx.ip })
  }, { throttle: 'domain_security' })
  .put('customer/domains/<uuid:id>/privacy/', async (ctx) => {
    const data = validate({ enabled: f.boolean() }, await ctx.body())
    return domainSecurity.setPrivacy(user(ctx), ctx.params.id, data.enabled, { userId: user(ctx), ip: ctx.ip })
  }, { throttle: 'domain_security' })
  // Renewals (phase 2): quote for the portal and the Maven Host auto-renew switch; payment goes through the cart.
  .get('customer/domains/<uuid:id>/renewal/', (ctx) => renewalQuote(user(ctx), ctx.params.id))
  .put('customer/domains/<uuid:id>/auto-renew/', async (ctx) => {
    const data = validate({ enabled: f.boolean() }, await ctx.body())
    return setAutoRenew(user(ctx), ctx.params.id, data.enabled, { userId: user(ctx), ip: ctx.ip })
  }, { throttle: 'domain_security' })
  .post('customer/domains/<uuid:id>/auth-code/', (ctx) => domainSecurity.authCode(user(ctx), ctx.params.id, { userId: user(ctx), ip: ctx.ip }), { throttle: 'domain_auth_code' })

/** /api/v1/customer/ (customer_urls.py) */
export const customerRoutes = new Router().post('register/', register, { permissions: [staffPermission('register_domain')] })

/** Staff customer-domain views (apps/accounts/api/views/customer_domains.py, customer_domain_operations.py). */
export const staffCustomerDomainRoutes = new Router()
  .get('<uuid:customer_id>/domains/', async (ctx) => {
    await staffCustomer(ctx)
    return domains.listCustomerDomains(ctx.params.customer_id, 'staff')
  }, { permissions: [staffPermission('view_customer'), staffPermission('view_domain')] })
  .get('<uuid:customer_id>/domains/<uuid:domain_id>/', async (ctx) => {
    await staffCustomer(ctx)
    return domains.domainDetail(await domains.ownedDomain(ctx.params.customer_id, ctx.params.domain_id), 'staff')
  }, { permissions: [staffPermission('view_customer'), staffPermission('view_domain')] })
  .post('<uuid:customer_id>/domains/<uuid:domain_id>/auto-renew/', async (ctx) => {
    await staffCustomer(ctx)
    const data = validate({ enabled: f.boolean() }, await ctx.body())
    const key = ctx.header('idempotency-key')
    if (!key || key.length > 255) throw new ValidationError({ 'Idempotency-Key': ['A unique Idempotency-Key header is required (max 255 characters).'] })
    const operation = await domains.staffSetAutoRenew({ actorId: ctx.authenticatedUser.id, customerId: ctx.params.customer_id, domainId: ctx.params.domain_id, enabled: data.enabled, idempotencyKey: key, ipAddress: ctx.ip })
    if (!operation) return json({ detail: 'Domain not found.' }, 404)
    return { domain_id: operation.domain_id, status: operation.status, auto_renew: operation.target_auto_renew }
  }, { permissions: [staffPermission('view_customer'), staffPermission('manage_domain_autorenew')] })

async function staffCustomer(ctx: Context) {
  const customer = await queryOne('SELECT 1 FROM accounts_user WHERE id = $1 AND NOT is_staff AND NOT is_superuser', [ctx.params.customer_id])
  if (!customer) throw new HttpError(404, { detail: 'No User matches the given query.' })
}

