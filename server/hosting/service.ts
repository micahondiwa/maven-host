import 'server-only'
import { randomUUID } from 'node:crypto'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { DetailError, notFound, ValidationError } from '../http/errors'
import { enqueueOutbox } from '../jobs/outbox'
import { audit } from '../audit/audit'
import { verifiedPackages } from './catalog'
import { hostingSupplier, transactableSuppliers } from './suppliers'
import { HostingSupplierError, type Capability, type HostingSupplier, type SupplierAccount } from './suppliers/types'

/**
 * Supplier-neutral hosting lifecycle: ports apps/hosting/services (provision.py, operations.py, account.py,
 * subscription.py) onto the supplier contract in ./suppliers. Customer-facing messages never name the supplier.
 */

export const PRIMARY_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', active: 'Active', suspending: 'Suspending', suspended: 'Suspended', unsuspending: 'Unsuspending', terminated: 'Terminated',
  terminating: 'Terminating', migrating: 'Migrating', provisioning: 'Provisioning', failed: 'Failed',
}
/** Customers see Maven Host's platform, never the upstream supplier. */
const PLATFORM_NAME = 'Maven Host Cloud'
const NOT_AVAILABLE = 'This hosting action is not available online yet. Please contact MavenHost support and we will complete it for you.'
const TEMPORARILY_UNAVAILABLE = 'Hosting details are temporarily unavailable. Please try again shortly.'

type ProviderRow = { id: number; name: string; supplier_code: string; provider_type: string; is_active: boolean }
type PackageRow = { id: number; package_name: string; hosting_plan_id: number; plan_name: string; requires_verified_mapping: boolean; verified_entitlements: Record<string, unknown> } & { provider: ProviderRow }
export type AccountRow = {
  id: number; username: string; status: string; disk_usage_mb: number; bandwidth_usage_mb: number; is_suspended: boolean; provisioned_at: Date | null; suspended_at: Date | null
  terminated_at: Date | null; created_at: Date; updated_at: Date; domain_id: string | null; owner_id: string; package_id: number; server_id: number | null; primary_domain: string; provider_reference: string
}

async function outbox(client: Queryable, name: string, payload: Record<string, unknown>, dedupeKey: string) {
  await enqueueOutbox(client as never, { eventId: randomUUID(), name, payload, occurredAt: new Date() }, dedupeKey)
}

async function packageWithProvider(packageId: number, db: Queryable): Promise<PackageRow | null> {
  const row = await queryOne<Omit<PackageRow, 'provider'> & { p_id: number; p_name: string; supplier_code: string; provider_type: string; p_active: boolean }>(
    `SELECT pkg.id, pkg.package_name, pkg.hosting_plan_id, plan.name AS plan_name, plan.requires_verified_mapping, pkg.verified_entitlements,
            prov.id AS p_id, prov.name AS p_name, prov.supplier_code, prov.provider_type, prov.is_active AS p_active
       FROM hosting_hostingpackage pkg JOIN hosting_hostingplan plan ON plan.id = pkg.hosting_plan_id JOIN hosting_hostingprovider prov ON prov.id = pkg.provider_id
      WHERE pkg.id = $1`,
    [packageId],
    db,
  )
  if (!row) return null
  const { p_id, p_name, supplier_code, provider_type, p_active, ...pkg } = row
  return { ...pkg, provider: { id: p_id, name: p_name, supplier_code, provider_type, is_active: p_active } }
}

async function accountSupplier(account: Pick<AccountRow, 'package_id'>, db: Queryable = database()) {
  const pkg = await packageWithProvider(account.package_id, db)
  if (!pkg) throw new DetailError(TEMPORARILY_UNAVAILABLE, 503)
  return hostingSupplier(pkg.provider)
}

// ---- Provisioning ----

export type ProvisionRequest = { customerId: string | null; domainId?: string | null; domainName?: string | null; packageId: number; username: string; actorId?: string | null }

function provisionResult(account: AccountRow) {
  return {
    account_id: account.id,
    domain_id: account.domain_id,
    package_id: account.package_id,
    server_id: account.server_id,
    username: account.username,
    primary_domain: account.primary_domain,
    server_hostname: PLATFORM_NAME,
    account_identifier: account.username,
    created_at: account.provisioned_at ?? account.created_at,
  }
}

async function activate(accountId: number, packageId: number, supplierAccount: SupplierAccount, recovered: boolean) {
  return transaction(async (client) => {
    const account = (await queryOne<AccountRow>('SELECT * FROM hosting_hostingaccount WHERE id = $1 FOR UPDATE', [accountId], client))!
    if (account.status === 'active') return account
    const updated = (await queryOne<AccountRow>(
      `UPDATE hosting_hostingaccount SET status = 'active', provisioned_at = COALESCE($2, CURRENT_TIMESTAMP), package_id = $3, provider_reference = $4, server_id = NULL,
         is_suspended = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [accountId, supplierAccount.createdAt, packageId, supplierAccount.reference, supplierAccount.suspended],
      client,
    ))!
    await outbox(
      client,
      'hosting.account.provisioned',
      { account_id: String(updated.id), domain_id: updated.domain_id, primary_domain: updated.primary_domain, package_id: String(packageId), server_id: null, username: updated.username, server_hostname: PLATFORM_NAME, ...(recovered ? { recovered: true } : {}) },
      `hosting-provisioned:${updated.id}`,
    )
    return updated
  })
}

/**
 * HostingProvisionService.provision. A pending account row is written before any supplier call; the supplier is then
 * searched by domain so a retry after a timeout adopts the account created earlier instead of creating a second one.
 */
export async function provisionHosting(request: ProvisionRequest) {
  const domain = request.domainId
    ? await queryOne<{ id: string; domain_name: string; owner_id: string }>('SELECT id, domain_name, owner_id FROM domains_domain WHERE id = $1 AND ($2::uuid IS NULL OR owner_id = $2::uuid)', [request.domainId, request.customerId])
    : null
  if (request.domainId && !domain) throw notFound('Domain matching query does not exist.')
  const primaryDomain = (domain?.domain_name ?? request.domainName ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!PRIMARY_DOMAIN.test(primaryDomain)) throw new ValidationError({ non_field_errors: ['A valid primary domain name is required to provision hosting.'] })
  const ownerId = domain?.owner_id ?? request.customerId
  if (!ownerId) throw new ValidationError({ non_field_errors: ['A customer is required to provision hosting with an external domain.'] })

  const pkg = await packageWithProvider(request.packageId, database())
  if (!pkg) throw notFound('HostingPackage matching query does not exist.')
  const verified = (await verifiedPackages([pkg.hosting_plan_id])).some((row) => row.id === pkg.id)
  if (!verified || !transactableSuppliers().includes(pkg.provider.supplier_code))
    throw new ValidationError({ non_field_errors: ['This hosting package is not verified for provisioning.'] })
  const supplier = hostingSupplier(pkg.provider)

  const account = await transaction(async (client) => {
    const existing = await queryOne<AccountRow>('SELECT * FROM hosting_hostingaccount WHERE primary_domain = $1 FOR UPDATE', [primaryDomain], client)
    if (existing) {
      if (existing.owner_id !== ownerId) throw new ValidationError({ non_field_errors: [`'${primaryDomain}' is already hosted on another MavenHost account.`] })
      if (existing.status !== 'active' && existing.username !== request.username) throw new ValidationError({ non_field_errors: [`A pending hosting account already exists for '${primaryDomain}'.`] })
      return existing
    }
    return (await queryOne<AccountRow>(
      `INSERT INTO hosting_hostingaccount (username, status, disk_usage_mb, bandwidth_usage_mb, is_suspended, provisioned_at, suspended_at, terminated_at, created_at, updated_at,
         domain_id, owner_id, package_id, server_id, primary_domain, provider_reference)
       VALUES ($1, 'pending', 0, 0, false, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, $3, $4, NULL, $5, '') RETURNING *`,
      [request.username, domain?.id ?? null, ownerId, pkg.id, primaryDomain],
      client,
    ))!
  })
  if (account.status === 'active') return provisionResult(account)
  if (request.actorId)
    await audit({ event: 'hosting_provision_requested', category: 'hosting', status: 'pending', performedBy: request.actorId, target: { appLabel: 'hosting', model: 'hostingaccount', id: account.id }, message: `Provisioning requested for ${primaryDomain}.`, metadata: { package_id: pkg.id } })

  const found = await supplier.findAccountByDomain(primaryDomain)
  if (found) return provisionResult(await activate(account.id, pkg.id, found, true))
  const created = await supplier.provision({ primaryDomain, productReference: pkg.package_name, label: account.username })
  return provisionResult(await activate(account.id, pkg.id, created, false))
}

/** services/subscription.py record_subscription. */
async function recordSubscription(item: FulfillmentItem, orderId: string, customerId: string, account: AccountRow, db: Queryable) {
  const order = (await queryOne<{ status: string; customer_id: string; currency: string }>('SELECT status, customer_id, currency FROM orders_order WHERE id = $1', [orderId], db))!
  if (!['paid', 'provisioning', 'completed'].includes(order.status)) throw new Error('A paid order is required for a hosting subscription.')
  if (account.owner_id !== customerId || account.status !== 'active') throw new Error('An active account owned by this customer is required.')
  if (!account.provisioned_at) throw new Error('A provisioned account is required for a subscription.')
  const months = ({ monthly: 1, quarterly: 3, semi_annually: 6, annually: 12 } as Record<string, number>)[item.billing_cycle]
  let renewsAt: Date | null = null
  if (months) {
    // Add calendar months in Africa/Nairobi local time, clamping to the month's last day (Python monthrange).
    const local = new Date(account.provisioned_at.getTime() + 3 * 3600_000)
    const index = local.getUTCFullYear() * 12 + local.getUTCMonth() + months
    const year = Math.floor(index / 12)
    const month = index % 12
    const day = Math.min(local.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
    renewsAt = new Date(Date.UTC(year, month, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) - 3 * 3600_000)
  }
  const unitPrice = (await queryOne<{ unit_price: string }>('SELECT unit_price FROM orders_order_item WHERE id = $1', [item.id], db))!.unit_price
  await db.query(
    `INSERT INTO hosting_hostingsubscription (retail_price, currency, billing_cycle, starts_at, renews_at, status, auto_renew, created_at, account_id, order_item_id, owner_id, plan_price_id)
     VALUES ($1, $2, $3, $4, $5, 'active', true, CURRENT_TIMESTAMP, $6, $7, $8, $9) ON CONFLICT (account_id) DO NOTHING`,
    [unitPrice, order.currency, item.billing_cycle, account.provisioned_at, renewsAt, account.id, item.id, customerId, Number(item.resource_id)],
  )
  const subscription = (await queryOne<{ owner_id: string; order_item_id: string }>('SELECT owner_id, order_item_id FROM hosting_hostingsubscription WHERE account_id = $1', [account.id], db))!
  if (subscription.owner_id !== customerId || subscription.order_item_id !== item.id) throw new Error('This hosting account already belongs to a different purchase.')
}

type FulfillmentItem = { id: string; resource_id: string; billing_cycle: string; configuration: Record<string, unknown> }

/** OrderFulfillmentService._fulfill_hosting, registered with the order fulfillment pipeline at bootstrap. */
export async function fulfillHostingItem({ orderId, customerId, item }: { orderId: string; customerId: string; item: FulfillmentItem }) {
  const price = await queryOne<{ hosting_plan_id: number; plan_name: string; is_active: boolean; requires_quote: boolean }>(
    'SELECT p.hosting_plan_id, pl.name AS plan_name, pl.is_active, pl.requires_quote FROM hosting_hostingplanprice p JOIN hosting_hostingplan pl ON pl.id = p.hosting_plan_id WHERE p.id = $1',
    [Number(item.resource_id)],
  )
  if (!price) throw new Error(`Hosting price ${item.resource_id} does not exist.`)
  const pkg = (await verifiedPackages([price.hosting_plan_id]))[0]
  if (!price.is_active || price.requires_quote || !pkg) throw new Error('Hosting provisioning is disabled until supplier activation.')
  const config = item.configuration ?? {}
  let domainId: string | null = null
  let domainName: string
  if (config.domain_id) {
    const domain = await queryOne<{ id: string; domain_name: string }>('SELECT id, domain_name FROM domains_domain WHERE id = $1 AND owner_id = $2', [config.domain_id, customerId])
    if (!domain) throw new Error(`Hosting order item ${item.id} references a domain that does not belong to the customer.`)
    domainId = domain.id
    domainName = domain.domain_name
  } else {
    domainName = String(config.domain ?? '').trim().toLowerCase().replace(/\.$/, '')
    if (!domainName) throw new Error(`Hosting order item ${item.id} requires a primary domain name.`)
    const domain = await queryOne<{ id: string; owner_id: string }>('SELECT id, owner_id FROM domains_domain WHERE domain_name = $1', [domainName])
    if (domain && domain.owner_id !== customerId) throw new Error(`The domain '${domainName}' is already associated with another MavenHost customer.`)
    domainId = domain?.id ?? null
  }
  if (!PRIMARY_DOMAIN.test(domainName)) throw new Error(`Hosting order item ${item.id} has an invalid primary domain name.`)
  // The checkout password stays encrypted on the order item; it is reserved for the control-panel login once the
  // supplier's user endpoint is verified, and is never sent anywhere today.
  const username = String(config.username || `mh${item.id.replace(/-/g, '').slice(0, 10)}`).toLowerCase().slice(0, 64)
  let account = await queryOne<AccountRow>('SELECT * FROM hosting_hostingaccount WHERE owner_id = $1 AND primary_domain = $2', [customerId, domainName])
  const recovered = account?.status === 'active'
  if (!recovered) {
    await provisionHosting({ customerId, domainId, domainName: domainId ? null : domainName, packageId: pkg.id, username })
    account = (await queryOne<AccountRow>('SELECT * FROM hosting_hostingaccount WHERE owner_id = $1 AND primary_domain = $2', [customerId, domainName]))!
  }
  await transaction((client) => recordSubscription(item, orderId, customerId, account!, client))
  return {
    completed: true, operation: 'hosting_provisioning', account_id: String(account!.id), domain_id: account!.domain_id, primary_domain: account!.primary_domain,
    package_id: String(account!.package_id), server_id: account!.server_id === null ? null : String(account!.server_id), username: account!.username,
    provider_reference: account!.provider_reference, recovered,
  }
}

// ---- Customer views ----

export async function listAccounts(customerId: string) {
  const rows = await query<AccountRow & { plan_name: string; server_name: string | null }>(
    `SELECT a.*, plan.name AS plan_name, s.name AS server_name FROM hosting_hostingaccount a
       JOIN hosting_hostingpackage pkg ON pkg.id = a.package_id JOIN hosting_hostingplan plan ON plan.id = pkg.hosting_plan_id
       LEFT JOIN hosting_server s ON s.id = a.server_id
      WHERE a.owner_id = $1 ORDER BY a.created_at DESC, a.id DESC`,
    [customerId],
  )
  return rows.map((row) => ({ account_id: String(row.id), username: row.username, primary_domain: row.primary_domain, package_name: row.plan_name, server_name: row.server_name ?? PLATFORM_NAME, status: row.status }))
}

export function parseAccountId(value: unknown, field = 'account_id') {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d{1,18}$/.test(text)) throw new ValidationError({ [field]: [text ? 'A valid integer is required.' : 'This field is required.'] })
  return Number(text)
}

async function ownedAccount(accountId: number, customerId: string | null, db: Queryable = database(), lock = false) {
  const account = await queryOne<AccountRow>(`SELECT * FROM hosting_hostingaccount WHERE id = $1 AND ($2::uuid IS NULL OR owner_id = $2::uuid)${lock ? ' FOR UPDATE' : ''}`, [accountId, customerId], db)
  if (!account) throw notFound('Hosting account not found.')
  return account
}

/** HostingAccountService.get: live supplier state merged with Maven Host's record. */
export async function accountDetail(customerId: string, accountId: number) {
  const account = await ownedAccount(accountId, customerId)
  const pkg = (await packageWithProvider(account.package_id, database()))!
  let live: SupplierAccount | null = null
  if (account.provider_reference) {
    try {
      live = await hostingSupplier(pkg.provider).getAccount(account.provider_reference)
    } catch (error) {
      if (!(error instanceof HostingSupplierError)) throw error
      console.error('Hosting supplier lookup failed', { accountId, code: error.code, message: error.message })
      throw new DetailError(TEMPORARILY_UNAVAILABLE, 503)
    }
  }
  const limit = (key: string) => (typeof pkg.verified_entitlements?.[key] === 'number' ? (pkg.verified_entitlements[key] as number) : 0)
  return {
    account: {
      account_id: String(account.id), username: account.username, primary_domain: account.primary_domain, package_name: pkg.plan_name, server_name: PLATFORM_NAME, status: account.status,
      disk_used_mb: account.disk_usage_mb, disk_limit_mb: limit('storage_mb'), bandwidth_used_mb: account.bandwidth_usage_mb, bandwidth_limit_mb: limit('bandwidth_mb'),
      dedicated_ip: null, created_at: account.provisioned_at ?? account.created_at, suspended: live ? live.suspended : account.is_suspended,
    },
  }
}

export async function listSubscriptions(customerId: string) {
  const rows = await query<{ id: number; plan: string; plan_slug: string | null; primary_domain: string; account_id: number; retail_price: string; currency: string; billing_cycle: string; status: string; starts_at: Date; renews_at: Date | null; auto_renew: boolean }>(
    `SELECT s.id, plan.name AS plan, plan.slug AS plan_slug, a.primary_domain, s.account_id, s.retail_price, s.currency, s.billing_cycle, s.status, s.starts_at, s.renews_at, s.auto_renew
       FROM hosting_hostingsubscription s JOIN hosting_hostingaccount a ON a.id = s.account_id JOIN hosting_hostingplanprice p ON p.id = s.plan_price_id
       JOIN hosting_hostingplan plan ON plan.id = p.hosting_plan_id WHERE s.owner_id = $1 ORDER BY s.created_at DESC`,
    [customerId],
  )
  return rows.map((row) => ({ ...row, account_id: String(row.account_id) }))
}

// ---- Staff views (apps/accounts/api/views/customer_hosting.py) ----

export async function staffCustomerAccounts(customerId: string, accountId?: number) {
  const rows = await query<AccountRow & { plan_name: string; server_name: string | null; disk_space_mb: number | null; bandwidth_mb: number | null }>(
    `SELECT a.*, plan.name AS plan_name, plan.disk_space_mb, plan.bandwidth_mb, s.name AS server_name FROM hosting_hostingaccount a
       JOIN hosting_hostingpackage pkg ON pkg.id = a.package_id JOIN hosting_hostingplan plan ON plan.id = pkg.hosting_plan_id LEFT JOIN hosting_server s ON s.id = a.server_id
      WHERE a.owner_id = $1 AND ($2::bigint IS NULL OR a.id = $2) ORDER BY a.created_at DESC`,
    [customerId, accountId ?? null],
  )
  const summary = (row: (typeof rows)[number]) => ({
    id: row.id, username: row.username, primary_domain: row.primary_domain, package_name: row.plan_name, server_name: row.server_name ?? PLATFORM_NAME,
    status: STATUS_LABELS[row.status] ?? row.status, is_suspended: row.is_suspended, created_at: row.created_at,
  })
  if (accountId === undefined) return rows.map(summary)
  const row = rows[0]
  if (!row) throw notFound('No HostingAccount matches the given query.')
  return {
    ...summary(row), disk_usage_mb: row.disk_usage_mb, bandwidth_usage_mb: row.bandwidth_usage_mb, disk_limit_mb: row.disk_space_mb, bandwidth_limit_mb: row.bandwidth_mb,
    provisioned_at: row.provisioned_at, suspended_at: row.suspended_at, terminated_at: row.terminated_at,
  }
}

// ---- Lifecycle operations (services/operations.py) ----

export type OperationType = 'suspend' | 'unsuspend' | 'terminate' | 'password' | 'package' | 'backup_create' | 'backup_restore'
type OperationRow = {
  id: string; operation_type: OperationType; status: string; reason: string; termination_policy: string; previous_account_status: string; attempts: number
  lease_until: Date | null; started_at: Date | null; completed_at: Date | null; created_at: Date; account_id: number; request_payload: Record<string, unknown>
}
const LIFECYCLE: Record<string, { from: string[]; during: string; target: string; event: string }> = {
  suspend: { from: ['active', 'suspending'], during: 'suspending', target: 'suspended', event: 'hosting.account.suspended' },
  unsuspend: { from: ['suspended', 'unsuspending'], during: 'unsuspending', target: 'active', event: 'hosting.account.unsuspended' },
  terminate: { from: ['active', 'suspended', 'terminating'], during: 'terminating', target: 'terminated', event: 'hosting.account.terminated' },
}
const LEASE_MS = 15 * 60_000

export function operationResult(operation: OperationRow) {
  const message =
    operation.status === 'ambiguous' ? 'We are verifying the hosting provider state.'
      : operation.status === 'failed' ? 'The hosting operation could not be completed.'
        : operation.status === 'succeeded' ? 'Hosting operation completed successfully.' : null
  return {
    operation_id: operation.id, account_id: String(operation.account_id), operation_type: operation.operation_type, status: operation.status,
    created_at: operation.created_at, started_at: operation.started_at, completed_at: operation.completed_at, message,
  }
}

/** Refuses actions the account's supplier has no verified API for, before anything is queued. */
export async function assertCapability(account: Pick<AccountRow, 'package_id'>, capability: Capability) {
  const supplier = await accountSupplier(account)
  if (!supplier.capabilities.has(capability)) throw new DetailError(NOT_AVAILABLE, 409, 'not_available')
  return supplier
}

export async function requestOperation(input: { accountId: number; customerId: string | null; type: 'suspend' | 'unsuspend' | 'terminate'; reason?: string; actorId: string }) {
  const probe = await ownedAccount(input.accountId, input.customerId)
  await assertCapability(probe, input.type)
  return transaction(async (client) => {
    const account = await ownedAccount(input.accountId, input.customerId, client, true)
    const existing = await queryOne<OperationRow>(
      `SELECT * FROM hosting_hostingoperation WHERE account_id = $1 AND operation_type = $2 AND status IN ('pending', 'processing', 'ambiguous') ORDER BY created_at DESC LIMIT 1`,
      [account.id, input.type],
      client,
    )
    if (existing) return operationResult(existing)
    if (input.type === 'suspend' && account.status === 'suspended') throw new ValidationError({ non_field_errors: ['Hosting account is already suspended.'] })
    if (input.type === 'unsuspend' && account.status === 'active') throw new ValidationError({ non_field_errors: ['Hosting account is already active.'] })
    if (input.type === 'terminate' && account.status === 'terminated') throw new ValidationError({ non_field_errors: ['Hosting account is already terminated.'] })
    const rule = LIFECYCLE[input.type]
    if (!rule.from.filter((status) => status !== rule.during).includes(account.status))
      throw new ValidationError({ non_field_errors: [`Cannot ${input.type} hosting account while it is '${account.status}'.`] })
    const operation = (await queryOne<OperationRow>(
      `INSERT INTO hosting_hostingoperation (id, operation_type, status, dedupe_key, reason, request_payload, result_payload, termination_policy, previous_account_status, attempts,
         locked_at, lease_until, last_error, started_at, completed_at, created_at, updated_at, account_id)
       VALUES ($1, $2, 'pending', $3, $4, '{}', '{}', 'y', $5, 0, NULL, NULL, '', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6) RETURNING *`,
      [randomUUID(), input.type, `hosting:${account.id}:${input.type}:${randomUUID()}`, (input.reason ?? '').slice(0, 500), account.status, account.id],
      client,
    ))!
    await client.query(`UPDATE hosting_hostingaccount SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [account.id, rule.during])
    await outbox(client, 'hosting.operation.requested', { operation_id: operation.id, account_id: String(account.id), operation_type: input.type }, `hosting-operation:${operation.id}`)
    await audit({ event: 'hosting_operation_requested', category: 'hosting', performedBy: input.actorId, target: { appLabel: 'hosting', model: 'hostingaccount', id: account.id }, message: `Requested ${input.type}.`, metadata: { operation_id: operation.id, reason: input.reason ?? '' } }, client)
    return operationResult(operation)
  })
}

export async function operationStatus(operationId: string, customerId: string | null) {
  const operation = await queryOne<OperationRow>(
    'SELECT o.* FROM hosting_hostingoperation o JOIN hosting_hostingaccount a ON a.id = o.account_id WHERE o.id = $1 AND ($2::uuid IS NULL OR a.owner_id = $2::uuid)',
    [operationId, customerId],
  )
  if (!operation) throw notFound('Hosting operation not found.')
  return operationResult(operation)
}

export class HostingOperationRetryable extends Error {}

async function finish(operationId: string, outcome: 'succeeded' | 'failed' | 'ambiguous', error = '') {
  return transaction(async (client) => {
    const operation = (await queryOne<OperationRow>('SELECT * FROM hosting_hostingoperation WHERE id = $1 FOR UPDATE', [operationId], client))!
    if (operation.status === 'succeeded') return operation
    const rule = LIFECYCLE[operation.operation_type]
    if (outcome === 'succeeded' && rule) {
      const sets = { suspend: 'is_suspended = true, suspended_at = CURRENT_TIMESTAMP', unsuspend: 'is_suspended = false, suspended_at = NULL', terminate: 'is_suspended = false, terminated_at = CURRENT_TIMESTAMP' }[operation.operation_type as 'suspend']
      await client.query(`UPDATE hosting_hostingaccount SET status = $2, ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [operation.account_id, rule.target])
      await outbox(client, rule.event, { account_id: String(operation.account_id) }, `hosting-lifecycle:${operation.id}`)
    }
    if (outcome === 'failed' && rule) await client.query('UPDATE hosting_hostingaccount SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [operation.account_id, operation.previous_account_status])
    return (await queryOne<OperationRow>(
      `UPDATE hosting_hostingoperation SET status = $2::text, completed_at = CASE WHEN $2::text = 'ambiguous' THEN completed_at ELSE CURRENT_TIMESTAMP END, locked_at = NULL, lease_until = NULL,
         last_error = $3::text, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [operationId, outcome, error.slice(0, 2000)],
      client,
    ))!
  })
}

/** Outbox handler for `hosting.operation.requested`; checks live supplier state first so a retry never repeats a completed action. */
export async function processOperation(operationId: string) {
  const claimed = await transaction(async (client) => {
    const operation = await queryOne<OperationRow>('SELECT * FROM hosting_hostingoperation WHERE id = $1 FOR UPDATE', [operationId], client)
    if (!operation || ['succeeded', 'failed'].includes(operation.status)) return null
    if (operation.status === 'processing' && operation.lease_until && operation.lease_until.getTime() > Date.now()) return null
    return queryOne<OperationRow>(
      `UPDATE hosting_hostingoperation SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP, lease_until = $2,
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP), last_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [operationId, new Date(Date.now() + LEASE_MS)],
      client,
    )
  })
  if (!claimed) return
  const account = (await queryOne<AccountRow>('SELECT * FROM hosting_hostingaccount WHERE id = $1', [claimed.account_id]))!
  let supplier: HostingSupplier
  try {
    supplier = await accountSupplier(account)
    if (!LIFECYCLE[claimed.operation_type]) throw new HostingSupplierError(`Unsupported hosting operation: ${claimed.operation_type}`, 'unsupported')
    const state = account.provider_reference ? await supplier.getAccount(account.provider_reference) : null
    const done = claimed.operation_type === 'terminate' ? state === null : state !== null && state.suspended === (claimed.operation_type === 'suspend')
    if (!done) {
      if (claimed.operation_type === 'suspend') await supplier.suspend(account.provider_reference, claimed.reason)
      else if (claimed.operation_type === 'unsuspend') await supplier.unsuspend(account.provider_reference)
      else await supplier.terminate(account.provider_reference)
    }
    await finish(operationId, 'succeeded')
  } catch (error) {
    if (error instanceof HostingSupplierError && error.ambiguous) {
      await finish(operationId, 'ambiguous', error.message)
      throw new HostingOperationRetryable(error.message)
    }
    console.error('Hosting operation failed', { operationId, error: (error as Error).message })
    await finish(operationId, 'failed', (error as Error).message)
  }
}

export { NOT_AVAILABLE as HOSTING_ACTION_NOT_AVAILABLE }
