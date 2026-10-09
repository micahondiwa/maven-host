/**
 * Supplier-neutral hosting contract (replaces v1 providers/base.py, which was shaped around cPanel/WHM).
 * An adapter declares the capabilities it has verified against the supplier's documented API; the hosting service
 * refuses any operation outside that set instead of guessing an endpoint.
 */

export const CAPABILITIES = ['provision', 'lookup', 'suspend', 'unsuspend', 'terminate', 'change_package', 'password', 'backups', 'mailboxes', 'control_panel_users', 'single_sign_on'] as const
export type Capability = (typeof CAPABILITIES)[number]

export type SupplierAccount = {
  /** Supplier's own identifier for the hosting account (a 20i package id). Never shown to customers. */
  reference: string
  primaryDomain: string
  domains: string[]
  suspended: boolean
  productName: string
  productReference: string
  createdAt: Date | null
}

export type ProvisionInput = {
  primaryDomain: string
  /** Supplier product/package type (`hosting_hostingpackage.package_name`). */
  productReference: string
  /** Internal label recorded on the supplier account so it can be matched to Maven Host records. */
  label: string
}

export interface HostingSupplier {
  readonly code: string
  readonly capabilities: ReadonlySet<Capability>
  /** True when the supplier places accounts on servers Maven Host tracks in `hosting_server`. */
  readonly usesServers: boolean
  verifyConnection(): Promise<{ accounts: number }>
  /** Looks an account up by domain so a retried provisioning request can never create a duplicate. */
  findAccountByDomain(domain: string): Promise<SupplierAccount | null>
  getAccount(reference: string): Promise<SupplierAccount | null>
  provision(input: ProvisionInput): Promise<SupplierAccount>
  suspend(reference: string, reason: string): Promise<void>
  unsuspend(reference: string): Promise<void>
  terminate(reference: string): Promise<void>
}

/** Base for every supplier failure; `message` is for staff logs, never for customers. */
export class HostingSupplierError extends Error {
  constructor(message: string, readonly code: 'not_configured' | 'disabled' | 'unsupported' | 'auth_failed' | 'rate_limited' | 'rejected' | 'unavailable' | 'invalid_response' = 'rejected') {
    super(message)
  }

  /** Transport failures and timeouts leave the supplier state unknown; the operation must be reconciled, not repeated blindly. */
  get ambiguous() {
    return this.code === 'unavailable'
  }
}

export class UnsupportedCapability extends HostingSupplierError {
  constructor(supplier: string, capability: Capability) {
    super(`${supplier} does not support '${capability}' through a verified API endpoint yet.`, 'unsupported')
  }
}
