import 'server-only'
import { TwentyISupplier, twentyiSettings } from './twentyi'
import { HostingSupplierError, type Capability, type HostingSupplier } from './types'

/** Hosting supplier registry (v1 providers/registry.py). 20i is the approved hosting supplier; KnownHost is retired. */

export const ACTIVE_HOSTING_SUPPLIER = 'twentyi'

/** Supplier codes whose packages may be sold and provisioned right now. */
export function transactableSuppliers(): string[] {
  return twentyiSettings.transactionsEnabled ? [ACTIVE_HOSTING_SUPPLIER] : []
}

class RetiredSupplier implements HostingSupplier {
  readonly capabilities = new Set<Capability>()
  readonly usesServers = true
  constructor(readonly code: string) {}
  private fail(): never {
    throw new HostingSupplierError(`The ${this.code} hosting integration has been retired; 20i is the hosting supplier.`, 'disabled')
  }
  verifyConnection = async () => this.fail()
  findAccountByDomain = async () => this.fail()
  getAccount = async () => this.fail()
  provision = async () => this.fail()
  suspend = async () => this.fail()
  unsuspend = async () => this.fail()
  terminate = async () => this.fail()
}

let override: ((code: string) => HostingSupplier | undefined) | null = null

/** Test hook: replace suppliers with in-memory fakes. */
export function setHostingSupplierOverride(factory: typeof override) {
  override = factory
}

export function hostingSupplier(provider: { supplier_code: string; provider_type: string }): HostingSupplier {
  const code = provider.supplier_code || provider.provider_type
  const replaced = override?.(code)
  if (replaced) return replaced
  if (code === 'twentyi') return new TwentyISupplier()
  return new RetiredSupplier(code)
}
