import 'server-only'
import { XMLParser } from 'fast-xml-parser'
import { tldExtensions } from '../routing'
import { ContactValidationError, RegistrarUnavailable, emptyRecordExtras, type Availability, type Contact, type ContactDetails, type DnsHost, type DnsRecord, type Registrar, type RegistrationRequest } from '../types'

/**
 * Port of apps/domains/clients/namecheap.py. Namecheap is no longer an approved supplier for new registrations;
 * this adapter remains so domains already held at Namecheap can still be managed and renewed.
 */

type Node = Record<string, unknown>

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, processEntities: false, parseAttributeValue: false, parseTagValue: false })

const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value])
const attr = (node: Node | undefined, name: string) => (node?.[`@${name}`] as string | undefined) ?? undefined
const isTrue = (value: string | undefined) => (value ?? 'false').toLowerCase() === 'true'
const text = (node: Node | undefined, name: string) => {
  const value = node?.[name]
  return typeof value === 'string' ? value.trim() : value && typeof value === 'object' && '#text' in (value as Node) ? String((value as Node)['#text']).trim() : ''
}

/** "MM/DD/YYYY" → "YYYY-MM-DD" */
function namecheapDate(value: string | undefined) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value?.trim() ?? '')
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : null
}

export class NamecheapRegistrar implements Registrar {
  readonly slug = 'namecheap'
  private readonly baseUrl = (process.env.NAMECHEAP_SANDBOX ?? 'true').trim().toLowerCase() === 'false' ? 'https://api.namecheap.com/xml.response' : 'https://api.sandbox.namecheap.com/xml.response'

  private async request(command: string, params: Record<string, string | number>, method: 'GET' | 'POST' = 'GET'): Promise<Node> {
    const payload = new URLSearchParams({
      ApiUser: process.env.NAMECHEAP_API_USER ?? '',
      ApiKey: process.env.NAMECHEAP_API_KEY ?? '',
      UserName: process.env.NAMECHEAP_USERNAME ?? '',
      ClientIp: process.env.NAMECHEAP_CLIENT_IP ?? '',
      Command: command,
      ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    })
    let body: string
    try {
      const response = method === 'POST'
        ? await fetch(this.baseUrl, { method: 'POST', body: payload, signal: AbortSignal.timeout(30_000) })
        : await fetch(`${this.baseUrl}?${payload}`, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      body = await response.text()
    } catch (error) {
      console.error(`Namecheap request for '${command}' failed`, error)
      throw new RegistrarUnavailable('Domain registrar lookup failed.')
    }
    const root = (parser.parse(body) as Node).ApiResponse as Node | undefined
    if (!root || attr(root, 'Status') !== 'OK') {
      const errors = asArray(((root?.Errors as Node | undefined)?.Error) as Node | Node[] | undefined)
      console.error(`Namecheap ${command} error`, errors.map((error) => `[${attr(error, 'Number') ?? 'Unknown'}] ${text({ v: error }, 'v')}`).join('; '))
      throw new RegistrarUnavailable('Domain registrar lookup failed.')
    }
    return (root.CommandResponse ?? {}) as Node
  }

  private async split(domain: string) {
    const name = domain.trim().toLowerCase().replace(/\.$/, '')
    const labels = name.split('.')
    if (labels.length < 2) throw new ContactValidationError(`Invalid domain name '${name}'.`)
    const known = new Set(await tldExtensions())
    const suffixes = labels.slice(1).map((_, index) => `.${labels.slice(index + 1).join('.')}`).sort((a, b) => b.length - a.length)
    for (const suffix of suffixes) if (known.has(suffix) && name.length > suffix.length) return { SLD: name.slice(0, -suffix.length), TLD: suffix.slice(1) }
    return { SLD: labels[labels.length - 2], TLD: labels[labels.length - 1] }
  }

  async checkDomains(domains: string[]): Promise<Availability[]> {
    const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))]
    const results = new Map<string, Availability>()
    for (let offset = 0; offset < normalized.length; offset += 50) {
      const batch = normalized.slice(offset, offset + 50)
      const response = await this.request('namecheap.domains.check', { DomainList: batch.join(',') })
      for (const element of asArray(response.DomainCheckResult as Node | Node[])) {
        const domain = (attr(element, 'Domain') ?? '').trim().toLowerCase()
        if (domain) results.set(domain, { domain, available: isTrue(attr(element, 'Available')), premium: isTrue(attr(element, 'IsPremiumName')), registrar: 'namecheap' })
      }
      if (batch.some((domain) => !results.has(domain))) throw new RegistrarUnavailable('Domain registrar lookup failed.')
    }
    return normalized.map((domain) => results.get(domain)!)
  }

  async getRegistrationInfo(domain: string) {
    const result = (await this.request('namecheap.domains.getInfo', { DomainName: domain })).DomainGetInfoResult as Node | undefined
    if (!result) throw new RegistrarUnavailable('Namecheap returned no DomainGetInfoResult.')
    return {
      domain: attr(result, 'DomainName') ?? domain,
      is_owner: isTrue(attr(result, 'IsOwner')),
      status: attr(result, 'Status') ?? 'unknown',
      provider_domain_id: attr(result, 'ID') ?? null,
      expiration_date: namecheapDate(text(result.DomainDetails as Node, 'ExpiredDate')),
    }
  }

  private static contactPayload(prefix: string, contact: Contact) {
    return {
      [`${prefix}FirstName`]: contact.first_name, [`${prefix}LastName`]: contact.last_name, [`${prefix}OrganizationName`]: contact.organization || '',
      [`${prefix}Address1`]: contact.address1, [`${prefix}Address2`]: contact.address2 || '', [`${prefix}City`]: contact.city,
      [`${prefix}StateProvince`]: contact.state, [`${prefix}PostalCode`]: contact.postal_code, [`${prefix}Country`]: contact.country,
      [`${prefix}Phone`]: contact.phone, [`${prefix}EmailAddress`]: contact.email,
    }
  }

  private static contactsPayload(contacts: ContactDetails) {
    return {
      ...NamecheapRegistrar.contactPayload('Registrant', contacts.registrant), ...NamecheapRegistrar.contactPayload('Admin', contacts.admin),
      ...NamecheapRegistrar.contactPayload('Tech', contacts.technical), ...NamecheapRegistrar.contactPayload('AuxBilling', contacts.billing),
    }
  }

  async registerDomain(request: RegistrationRequest) {
    const payload: Record<string, string | number> = { DomainName: request.domain, Years: request.years, ...NamecheapRegistrar.contactsPayload(request) }
    if (request.nameservers.length) payload.Nameservers = request.nameservers.join(',')
    const result = (await this.request('namecheap.domains.create', payload, 'POST')).DomainCreateResult as Node | undefined
    if (!result) throw new RegistrarUnavailable('Missing DomainCreateResult element.')
    const registered = isTrue(attr(result, 'Registered'))
    return {
      success: registered, registrar: 'namecheap', domain: attr(result, 'Domain') ?? request.domain, order_id: attr(result, 'OrderID') ?? null,
      transaction_id: attr(result, 'TransactionID') ?? null, expiration_date: namecheapDate(attr(result, 'ExpiredDate')), pending: false,
      message: registered ? 'Domain registered successfully.' : 'Registration failed.',
    }
  }

  async renewDomain(domain: string, years: number) {
    // v1 searched for the result without the response namespace, so every renewal crashed after the purchase.
    const result = (await this.request('namecheap.domains.renew', { DomainName: domain, Years: years })).DomainRenewResult as Node | undefined
    if (!result) throw new RegistrarUnavailable('Renewal is unresolved; do not repeat the payment or renewal without reconciliation.')
    return {
      domain_name: attr(result, 'DomainName') ?? attr(result, 'Domain') ?? domain, renewed: true, registrar: 'namecheap',
      previous_expiration_date: null, new_expiration_date: namecheapDate(text(result.DomainDetails as Node, 'ExpiredDate')),
      years: Number.parseInt(attr(result, 'Years') ?? String(years), 10) || years, order_id: attr(result, 'OrderID') ?? null, transaction_id: attr(result, 'TransactionID') ?? null,
    }
  }

  async getContacts(domain: string): Promise<ContactDetails> {
    const result = (await this.request('namecheap.domains.getContacts', { DomainName: domain })).DomainContactsResult as Node | undefined
    if (!result) throw new RegistrarUnavailable('Namecheap returned no DomainContactsResult.')
    const contact = (node: Node | undefined): Contact => {
      if (!node) throw new RegistrarUnavailable('Namecheap response is missing a WHOIS contact.')
      return {
        first_name: text(node, 'FirstName'), last_name: text(node, 'LastName'), organization: text(node, 'OrganizationName'), email: text(node, 'EmailAddress'),
        phone: text(node, 'Phone'), address1: text(node, 'Address1'), address2: text(node, 'Address2'), city: text(node, 'City'), state: text(node, 'StateProvince'),
        postal_code: text(node, 'PostalCode'), country: text(node, 'Country'), street_number: '', street_suffix: '', phone_country_code: '', phone_area_code: '', phone_subscriber_number: '',
      }
    }
    return { registrant: contact(result.Registrant as Node), admin: contact(result.Admin as Node), technical: contact(result.Tech as Node), billing: contact(result.AuxBilling as Node) }
  }

  async setContacts(domain: string, contacts: ContactDetails) {
    const result = (await this.request('namecheap.domains.setContacts', { DomainName: domain, ...NamecheapRegistrar.contactsPayload(contacts) })).DomainSetContactResult as Node | undefined
    if (!isTrue(attr(result, 'IsSuccess'))) throw new RegistrarUnavailable('Namecheap did not confirm the contact update.')
    return { success: true, domain_name: domain, registrar: 'namecheap' }
  }

  async getNameservers(domain: string) {
    const result = (await this.request('namecheap.domains.dns.getList', await this.split(domain))).DomainDNSGetListResult as Node | undefined
    return asArray(result?.Nameserver as unknown).map((node) => (typeof node === 'string' ? node : String((node as Node)['#text'] ?? '')).trim()).filter(Boolean)
  }

  async setNameservers(domain: string, nameservers: string[]) {
    const cleaned = nameservers.map((name) => name.trim().replace(/\.$/, '')).filter(Boolean)
    if (cleaned.length < 2) throw new ContactValidationError('At least two nameservers are required.')
    const result = (await this.request('namecheap.domains.dns.setCustom', { ...(await this.split(domain)), NameServers: cleaned.join(',') })).DomainDNSSetCustomResult as Node | undefined
    if (!isTrue(attr(result, 'Updated'))) throw new RegistrarUnavailable('Namecheap did not confirm the nameserver update.')
    return { success: true, domain_name: domain, registrar: 'namecheap' }
  }

  async getDnsHosts(domain: string): Promise<DnsHost[]> {
    const parts = await this.split(domain)
    const hosts: DnsHost[] = []
    for (const nameserver of await this.getNameservers(domain)) {
      const node = (await this.request('namecheap.domains.ns.getInfo', { ...parts, Nameserver: nameserver })).DomainNSInfoResult as Node | undefined
      if (node) hosts.push({ hostname: nameserver, ipv4: attr(node, 'IP') || null, ipv6: null })
    }
    return hosts
  }

  async setDnsHosts(domain: string, hosts: DnsHost[]) {
    const parts = await this.split(domain)
    const current = new Map((await this.getDnsHosts(domain)).map((host) => [host.hostname.replace(/\.$/, ''), host]))
    const desired = new Map(hosts.map((host) => [host.hostname.replace(/\.$/, ''), host]))
    const confirm = (node: Node | undefined, fallback = 'false') => (attr(node, 'IsSuccess') ?? fallback).toLowerCase() === 'true'
    for (const [hostname, host] of desired) {
      if (!host.ipv4) throw new ContactValidationError('Namecheap child nameservers currently require an IPv4 address.')
      const previous = current.get(hostname)
      if (!previous) {
        if (!confirm((await this.request('namecheap.domains.ns.create', { ...parts, Nameserver: hostname, IP: host.ipv4 })).DomainNSCreateResult as Node))
          throw new RegistrarUnavailable(`Namecheap did not create child nameserver '${hostname}'.`)
      } else if (previous.ipv4 !== host.ipv4) {
        if (!confirm((await this.request('namecheap.domains.ns.update', { ...parts, Nameserver: hostname, OldIP: previous.ipv4 ?? '', IP: host.ipv4 })).DomainNSUpdateResult as Node))
          throw new RegistrarUnavailable(`Namecheap did not update child nameserver '${hostname}'.`)
      }
    }
    for (const hostname of current.keys()) {
      if (desired.has(hostname)) continue
      const result = (await this.request('namecheap.domains.ns.delete', { ...parts, Nameserver: hostname })).DomainNSDeleteResult as Node | undefined
      if (result && !confirm(result, 'true')) throw new RegistrarUnavailable(`Namecheap did not delete child nameserver '${hostname}'.`)
    }
    return { success: true, domain_name: domain, registrar: 'namecheap' }
  }

  async getDnsRecords(domain: string): Promise<DnsRecord[]> {
    const result = (await this.request('namecheap.domains.dns.getHosts', await this.split(domain))).DomainDNSGetHostsResult as Node | undefined
    return asArray(result?.host as Node | Node[] ?? result?.Host as Node | Node[]).map((node) => {
      const type = attr(node, 'Type') ?? ''
      if (!['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'].includes(type)) throw new RegistrarUnavailable(`Unsupported Namecheap DNS record type '${type}'.`)
      const integer = (name: string) => (attr(node, name) ? Number.parseInt(attr(node, name)!, 10) : null)
      return { ...emptyRecordExtras, id: attr(node, 'HostId') ?? null, type: type as DnsRecord['type'], host: attr(node, 'Name') ?? '@', value: attr(node, 'Address') ?? '', ttl: Number.parseInt(attr(node, 'TTL') ?? '1800', 10), priority: integer('MXPref'), flag: integer('Flag'), tag: attr(node, 'Tag') ?? null }
    })
  }

  private async setZone(domain: string, records: DnsRecord[]) {
    const payload: Record<string, string | number> = { ...(await this.split(domain)) }
    records.forEach((record, offset) => {
      const index = offset + 1
      if (record.type === 'SRV') throw new ContactValidationError('Namecheap setHosts does not expose SRV records in this integration.')
      Object.assign(payload, { [`HostName${index}`]: record.host, [`RecordType${index}`]: record.type, [`Address${index}`]: record.value, [`TTL${index}`]: String(record.ttl) })
      if (record.type === 'MX' && record.priority !== null) payload[`MXPref${index}`] = String(record.priority)
      if (record.type === 'CAA') {
        if (record.flag !== null) payload[`Flag${index}`] = String(record.flag)
        if (record.tag) payload[`Tag${index}`] = record.tag
      }
    })
    const result = (await this.request('namecheap.domains.dns.setHosts', payload, records.length > 10 ? 'POST' : 'GET')).DomainDNSSetHostsResult as Node | undefined
    if (!isTrue(attr(result, 'IsSuccess'))) throw new RegistrarUnavailable('Namecheap did not confirm the DNS update.')
    return { success: true, domain_name: domain, registrar: 'namecheap' }
  }

  async createDnsRecord(domain: string, record: DnsRecord) {
    if (record.type === 'SRV') throw new ContactValidationError('Namecheap DNS record API does not support SRV in this integration.')
    return this.setZone(domain, [...(await this.getDnsRecords(domain)), { ...record, id: null }])
  }

  async updateDnsRecord(domain: string, record: DnsRecord) {
    if (!record.id) throw new ContactValidationError('DNS record id is required for updates.')
    const zone = await this.getDnsRecords(domain)
    if (!zone.some((item) => item.id === record.id)) throw new ContactValidationError(`DNS record '${record.id}' was not found.`)
    return this.setZone(domain, zone.map((item) => (item.id === record.id ? record : item)))
  }

  async deleteDnsRecord(domain: string, recordId: string) {
    const zone = await this.getDnsRecords(domain)
    const remaining = zone.filter((item) => item.id !== recordId)
    if (remaining.length === zone.length) throw new ContactValidationError(`DNS record '${recordId}' was not found.`)
    return this.setZone(domain, remaining)
  }
}
