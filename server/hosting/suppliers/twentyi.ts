import 'server-only'
import { HostingSupplierError, UnsupportedCapability, type Capability, type HostingSupplier, type ProvisionInput, type SupplierAccount } from './types'

/**
 * 20i Reseller API adapter. Only endpoints confirmed in 20i's published documentation are called:
 *
 * - `GET  /package`                  list hosting packages (docs.20i.com/api/retrieve-packages-api)
 * - `POST /reseller/{id}/addWeb`     create a hosting package (docs.20i.com/api/provision-hosting-package-api)
 *
 * Authentication is `Authorization: Bearer base64(general API key)` against https://api.20i.com
 * (docs.20i.com/api/20i-api-documentation). 20i has no sandbox, so every call is live: provisioning additionally
 * requires TWENTYI_TRANSACTIONS_ENABLED. Suspension, termination, StackCP users and single sign-on are not called
 * until their endpoints are confirmed in the authenticated 20i API console.
 */

const flag = (name: string) => (process.env[name] ?? '').trim().toLowerCase() === 'true'

export const twentyiSettings = {
  get enabled() {
    return flag('TWENTYI_ENABLED')
  },
  get transactionsEnabled() {
    return flag('TWENTYI_ENABLED') && flag('TWENTYI_TRANSACTIONS_ENABLED')
  },
  get apiUrl() {
    return (process.env.TWENTYI_API_URL?.trim() || 'https://api.20i.com').replace(/\/+$/, '')
  },
  get apiKey() {
    return process.env.TWENTYI_GENERAL_API_KEY?.trim() ?? ''
  },
  get timeoutMs() {
    return Number.parseInt(process.env.TWENTYI_TIMEOUT_MS ?? '', 10) || 30_000
  },
}

type PackageRecord = { id: number | string; created?: string; enabled?: boolean; name?: string; names?: string[]; packageTypeName?: string; typeRef?: string | number }

const normalize = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, '')

export class TwentyISupplier implements HostingSupplier {
  readonly code = 'twentyi'
  readonly usesServers = false
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>(['provision', 'lookup'])

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!twentyiSettings.enabled) throw new HostingSupplierError('20i integration is disabled (TWENTYI_ENABLED).', 'disabled')
    const key = twentyiSettings.apiKey
    if (!key) throw new HostingSupplierError('20i general API key is not configured (TWENTYI_GENERAL_API_KEY).', 'not_configured')
    let response: Response
    try {
      response = await this.fetcher(`${twentyiSettings.apiUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${Buffer.from(key, 'utf8').toString('base64')}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(twentyiSettings.timeoutMs),
        cache: 'no-store',
      })
    } catch (error) {
      throw new HostingSupplierError(`20i request ${method} ${path} did not complete: ${(error as Error).name}.`, 'unavailable')
    }
    const text = await response.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      if (response.ok) throw new HostingSupplierError(`20i returned a non-JSON response for ${method} ${path}.`, 'invalid_response')
    }
    if (response.ok) return data as T
    const detail = data && typeof data === 'object' && 'error' in data ? JSON.stringify((data as { error: unknown }).error).slice(0, 300) : `HTTP ${response.status}`
    if (response.status === 401 || response.status === 403) throw new HostingSupplierError(`20i rejected the API credentials (${detail}).`, 'auth_failed')
    if (response.status === 429) throw new HostingSupplierError('20i rate limit reached.', 'rate_limited')
    if (response.status >= 500) throw new HostingSupplierError(`20i is unavailable (${detail}).`, 'unavailable')
    throw new HostingSupplierError(`20i rejected ${method} ${path} (${detail}).`, 'rejected')
  }

  private static toAccount(record: PackageRecord): SupplierAccount {
    const names = (Array.isArray(record.names) ? record.names : []).map(normalize)
    const primary = normalize(record.name ?? names[0] ?? '')
    return {
      reference: String(record.id),
      primaryDomain: primary,
      domains: [...new Set([primary, ...names].filter(Boolean))],
      suspended: record.enabled === false,
      productName: record.packageTypeName ?? '',
      productReference: record.typeRef === undefined ? '' : String(record.typeRef),
      createdAt: record.created ? new Date(record.created) : null,
    }
  }

  private async packages() {
    const data = await this.request<unknown>('GET', '/package')
    if (!Array.isArray(data)) throw new HostingSupplierError('20i returned an unexpected package list.', 'invalid_response')
    return (data as PackageRecord[]).map(TwentyISupplier.toAccount)
  }

  async verifyConnection() {
    return { accounts: (await this.packages()).length }
  }

  async findAccountByDomain(domain: string) {
    const target = normalize(domain)
    return (await this.packages()).find((account) => account.domains.includes(target)) ?? null
  }

  async getAccount(reference: string) {
    return (await this.packages()).find((account) => account.reference === reference) ?? null
  }

  async provision(input: ProvisionInput) {
    if (!twentyiSettings.transactionsEnabled) throw new HostingSupplierError('20i provisioning is disabled (TWENTYI_TRANSACTIONS_ENABLED).', 'disabled')
    if (!/^\d+$/.test(input.productReference)) throw new HostingSupplierError(`'${input.productReference}' is not a 20i package type id.`, 'rejected')
    const data = await this.request<{ result?: unknown }>('POST', '/reseller/*/addWeb', { type: input.productReference, domain_name: normalize(input.primaryDomain), label: input.label })
    const id = data?.result
    if (!(typeof id === 'number' || (typeof id === 'string' && id.trim()))) throw new HostingSupplierError('20i did not return the new package id.', 'invalid_response')
    // Confirm through the package list rather than trusting the create response alone.
    return (
      (await this.getAccount(String(id))) ?? {
        reference: String(id), primaryDomain: normalize(input.primaryDomain), domains: [normalize(input.primaryDomain)], suspended: false, productName: '', productReference: input.productReference, createdAt: null,
      }
    )
  }

  async suspend(): Promise<void> {
    throw new UnsupportedCapability('20i', 'suspend')
  }

  async unsuspend(): Promise<void> {
    throw new UnsupportedCapability('20i', 'unsuspend')
  }

  async terminate(): Promise<void> {
    throw new UnsupportedCapability('20i', 'terminate')
  }
}
