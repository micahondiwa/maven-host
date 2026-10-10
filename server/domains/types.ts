import 'server-only'
import { DetailError } from '../http/errors'

/** Provider-neutral domain DTOs (apps/domains/dto) and the error types v1's API exception handler mapped. */

export type Contact = {
  first_name: string; last_name: string; organization: string; email: string; phone: string
  address1: string; address2: string; city: string; state: string; postal_code: string; country: string
  street_number: string; street_suffix: string; phone_country_code: string; phone_area_code: string; phone_subscriber_number: string
}
export type ContactDetails = { registrant: Contact; admin: Contact; technical: Contact; billing: Contact }
export type MutationResult = { success: boolean; domain_name: string; registrar: string }
export type Availability = { domain: string; available: boolean; premium: boolean; registrar: string }
export type RegistrationRequest = ContactDetails & { domain: string; years: number; nameservers: string[]; supplierSlug?: string }
export type RegistrationResult = { success: boolean; registrar: string; domain: string; order_id: string | null; transaction_id: string | null; expiration_date: string | null; message: string; pending: boolean }
export type RegistrationLookup = { domain: string; is_owner: boolean; status: string; provider_domain_id: string | null; expiration_date: string | null }
export type RenewalResult = { domain_name: string; renewed: boolean; registrar: string; previous_expiration_date: string | null; new_expiration_date: string | null; years: number; order_id: string | null; transaction_id: string | null }
export type DnsHost = { hostname: string; ipv4: string | null; ipv6: string | null }
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV' | 'CAA'
export type DnsRecord = { id: string | null; type: DnsRecordType; host: string; value: string; ttl: number; priority: number | null; weight: number | null; port: number | null; protocol: string | null; flag: number | null; tag: string | null }
export type SupplierPrice = { tld: string; years: number; price_type: 'register' | 'renew' | 'transfer'; currency: string; price: string }

export const emptyRecordExtras = { priority: null, weight: null, port: null, protocol: null, flag: null, tag: null }

/** RegistrarClient contract (apps/domains/registrars/base.py). */
export interface Registrar {
  readonly slug: string
  checkDomains(domains: string[]): Promise<Availability[]>
  registerDomain(request: RegistrationRequest): Promise<RegistrationResult>
  getRegistrationInfo(domain: string): Promise<RegistrationLookup>
  renewDomain(domain: string, years: number): Promise<RenewalResult>
  getContacts(domain: string): Promise<ContactDetails>
  setContacts(domain: string, contacts: ContactDetails): Promise<MutationResult>
  getNameservers(domain: string): Promise<string[]>
  setNameservers(domain: string, nameservers: string[]): Promise<MutationResult>
  getDnsHosts(domain: string): Promise<DnsHost[]>
  setDnsHosts(domain: string, hosts: DnsHost[]): Promise<MutationResult>
  getDnsRecords(domain: string): Promise<DnsRecord[]>
  createDnsRecord(domain: string, record: DnsRecord): Promise<MutationResult>
  updateDnsRecord(domain: string, record: DnsRecord): Promise<MutationResult>
  deleteDnsRecord(domain: string, recordId: string): Promise<MutationResult>
  /** Optional capabilities: present only when verified against the supplier's documented API. */
  getDomainState?(domain: string): Promise<DomainState>
  setLock?(domain: string, locked: boolean): Promise<MutationResult>
  setPrivacy?(domain: string, enabled: boolean): Promise<MutationResult>
  getAuthCode?(domain: string): Promise<string>
  listTlds?(): Promise<SupplierTld[]>
}

/** Live registry state of a domain (registrar lock, WHOIS privacy, expiry). */
export type DomainState = {
  status: string
  expires_on: string | null
  locked: boolean
  lockable: boolean
  privacy_enabled: boolean
  privacy_allowed: boolean
  auth_code_required_for_transfer: boolean
  can_renew: boolean
}

type SupplierAmount = { currency: string; price: string } | null

/** One extension from the supplier catalog with its wholesale one-year prices (null when not offered). */
export type SupplierTld = {
  extension: string
  active: boolean
  min_period: number | null
  max_period: number | null
  renew_available: boolean
  transfer_available: boolean
  transfer_auth_code_required: boolean
  privacy_allowed: boolean
  dnssec_allowed: boolean
  restrictions: unknown[]
  setup_fee: boolean
  prices: { register: SupplierAmount; renew: SupplierAmount; transfer: SupplierAmount }
}

export class ContactValidationError extends DetailError {
  constructor(message: string) {
    super(message, 400)
  }
}
export class PricingNotAvailableError extends DetailError {
  constructor(message: string) {
    super(message, 400)
  }
}
export class DomainRegistrationPending extends DetailError {
  constructor(message: string) {
    super(message, 202, 'registry_pending')
  }
}
export class SupplierFeatureUnavailable extends DetailError {
  constructor(message: string) {
    super(message, 422, 'supplier_feature_unavailable')
  }
}
/** Sanitized supplier boundary failure (OpenproviderUnavailable). */
export class RegistrarUnavailable extends DetailError {
  constructor(message: string) {
    super(message, 502, 'registrar_unavailable')
  }
}
export class OpenproviderNotReady extends RegistrarUnavailable {}
export class DomainUnavailableError extends DetailError {
  constructor(message: string) {
    super(message, 409)
  }
}
export class DomainNotRenewableError extends DetailError {
  constructor(message: string) {
    super(message, 409)
  }
}
