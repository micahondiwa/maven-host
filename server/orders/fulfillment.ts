import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { database, query, queryOne, transaction } from '../db'
import { pythonDumps } from '../lib/python-json'
import { registerDomain } from '../domains/service'
import { routingConfig } from '../domains/routing'
import type { Contact } from '../domains/types'
import { PRIMARY_DOMAIN, transitionOrder } from './service'

/** Port of apps/orders/services/fulfillment.py: durable per-item provider operations after payment. */

type Item = { id: string; product_type: string; resource_id: string; quantity: number; billing_cycle: string; configuration: Record<string, unknown>; provisioning_snapshot: Record<string, unknown> }
type Attempt = { id: string; status: string; request_fingerprint: string; started_at: Date | null; updated_at: Date; next_retry_at: Date | null; attempts: number }

const LEASE_MS = 15 * 60_000

export function validateOrderItems(items: Item[]) {
  if (!items.length) throw new Error('Cannot fulfill an order without items.')
  for (const item of items) {
    if (item.quantity !== 1) throw new Error(`Order item ${item.id} has quantity ${item.quantity}; fulfillment requires quantity 1 for one-resource products.`)
    const config = item.configuration ?? {}
    if (item.product_type === 'domain') {
      const domain = String(config.domain ?? '').trim().toLowerCase()
      if (!domain || !domain.includes('.')) throw new Error(`Order item ${item.id} is missing a valid domain name.`)
    } else if (item.product_type === 'hosting') {
      const domainName = String(config.domain ?? '').trim().toLowerCase().replace(/\.$/, '')
      if (!(config.domain_id || domainName)) throw new Error(`Hosting order item ${item.id} requires a primary domain name.`)
      if (domainName && !PRIMARY_DOMAIN.test(domainName)) throw new Error(`Hosting order item ${item.id} has an invalid primary domain name.`)
      if (!config.password_encrypted) throw new Error(`Hosting order item ${item.id} is missing protected account credentials.`)
    } else throw new Error(`No fulfillment handler is registered for product type '${item.product_type}'.`)
  }
}

const operationFor = (item: Item) => (item.product_type === 'domain' ? 'domain_registration' : 'hosting_provisioning')

function fingerprint(item: Item) {
  const config = { ...(item.configuration ?? {}) }
  delete config.password_encrypted
  return createHash('sha256').update(pythonDumps(config, { sortKeys: true, compact: true })).digest('hex')
}

/** Atomically claims the durable operation lease; returns null when another live worker owns it. */
async function beginAttempt(item: Item, operation: string) {
  const print = fingerprint(item)
  return transaction(async (client) => {
    await client.query(
      `INSERT INTO orders_fulfillmentattempt (id, operation, status, idempotency_key, request_fingerprint, attempts, provider_reference, provider_resource_id, last_error,
         next_retry_at, started_at, completed_at, created_at, updated_at, order_item_id)
       VALUES ($1, $2, 'pending', $3, $4, 0, '', '', '', CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5) ON CONFLICT (idempotency_key) DO NOTHING`,
      [randomUUID(), operation, `order-item:${item.id}:${operation}`, print, item.id],
    )
    const attempt = (await queryOne<Attempt>('SELECT * FROM orders_fulfillmentattempt WHERE order_item_id = $1 AND operation = $2 FOR UPDATE', [item.id, operation], client))!
    const now = Date.now()
    if (attempt.request_fingerprint && attempt.request_fingerprint !== print) {
      await client.query(`UPDATE orders_fulfillmentattempt SET status = 'ambiguous', last_error = 'Fulfillment request changed after the order was paid.', next_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [attempt.id])
      return { conflict: true as const }
    }
    if (attempt.status === 'succeeded') return null
    let note = ''
    if (attempt.status === 'in_progress') {
      const started = (attempt.started_at ?? attempt.updated_at).getTime()
      if (started > now - LEASE_MS) return null
      note = 'Previous fulfillment worker lease expired; provider state must be reconciled.'
      attempt.status = 'ambiguous'
      attempt.next_retry_at = new Date(now)
    }
    if ((attempt.status === 'ambiguous' || attempt.status === 'failed') && attempt.next_retry_at && attempt.next_retry_at.getTime() > now) return null
    await client.query(
      `UPDATE orders_fulfillmentattempt SET status = 'in_progress', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP, next_retry_at = CURRENT_TIMESTAMP, last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [attempt.id, note],
    )
    return attempt
  })
}

async function contactFor(customerId: string, payload: Record<string, string> | undefined): Promise<Contact> {
  const profile = (await queryOne<{ first_name: string; last_name: string; email: string; company: string | null; phone_number: string | null; address: string | null; city: string | null; postal_code: string | null; country: string | null }>(
    `SELECT u.first_name, u.last_name, u.email, p.company, p.phone_number, p.address, p.city, p.postal_code, p.country FROM accounts_user u LEFT JOIN accounts_profile p ON p.user_id = u.id WHERE u.id = $1`,
    [customerId],
  ))!
  const defaults = {
    first_name: profile.first_name || 'Customer', last_name: profile.last_name || 'Customer', organization: profile.company || '', email: profile.email,
    phone: profile.phone_number || '+254700000000', address1: profile.address || 'Unknown', address2: '', city: profile.city || 'Nairobi', state: profile.city || 'Nairobi',
    postal_code: profile.postal_code || '00100', country: profile.country || 'KE', street_number: '', street_suffix: '', phone_country_code: '', phone_area_code: '', phone_subscriber_number: '',
  }
  return { ...defaults, ...(payload ?? {}) } as Contact
}

async function fulfillDomain(customerId: string, item: Item) {
  const config = item.configuration ?? {}
  const domainName = String(config.domain ?? '').trim().toLowerCase()
  const existing = await queryOne<{ id: string; status: string }>('SELECT id, status FROM domains_domain WHERE owner_id = $1 AND domain_name = $2', [customerId, domainName])
  let recovered = Boolean(existing && existing.status === 'active')
  if (!recovered) {
    const price = /^\d+$/.test(item.resource_id) ? await queryOne<{ slug: string }>('SELECT r.slug FROM domains_domainprice p JOIN domains_registrar r ON r.id = p.registrar_id WHERE p.id = $1', [Number(item.resource_id)]) : undefined
    if (!price && routingConfig.enabled) throw new Error('The paid domain supplier reference is missing; reconcile this order before fulfillment.')
    const result = await registerDomain(customerId, {
      domain: domainName, years: Number(config.years ?? 1),
      registrant: await contactFor(customerId, config.registrant as never), admin: await contactFor(customerId, config.admin as never),
      technical: await contactFor(customerId, config.technical as never), billing: await contactFor(customerId, config.billing as never),
      nameservers: Array.isArray(config.nameservers) ? (config.nameservers as string[]) : [], supplierSlug: price?.slug ?? '',
    })
    recovered = Boolean(result.message && result.message.toLowerCase().includes('reconciled'))
  }
  const domain = (await queryOne<{ id: string; domain_name: string; registrar_order_id: string; registrar_transaction_id: string; expires_at: string | null; slug: string }>(
    'SELECT d.*, r.slug FROM domains_domain d JOIN domains_registrar r ON r.id = d.registrar_id WHERE d.owner_id = $1 AND d.domain_name = $2',
    [customerId, domainName],
  ))!
  await database().query('UPDATE hosting_hostingaccount SET domain_id = $3 WHERE owner_id = $1 AND primary_domain = $2 AND domain_id IS NULL', [customerId, domainName, domain.id])
  return {
    completed: true, operation: 'domain_registration', domain_id: domain.id, domain_name: domain.domain_name, registrar: domain.slug, registrar_order_id: domain.registrar_order_id,
    registrar_transaction_id: domain.registrar_transaction_id, expires_at: domain.expires_at, recovered,
  }
}

type HostingFulfiller = (input: { orderId: string; customerId: string; item: Item }) => Promise<Record<string, unknown>>
let hostingFulfiller: HostingFulfiller | null = null

/** Registered by the hosting module, which owns supplier provisioning. */
export function registerHostingFulfiller(fulfiller: HostingFulfiller) {
  hostingFulfiller = fulfiller
}

async function fulfillHosting(orderId: string, customerId: string, item: Item) {
  if (!hostingFulfiller) throw new Error('Hosting provisioning is disabled until supplier activation.')
  return hostingFulfiller({ orderId, customerId, item })
}

/** OrderFulfillmentService.fulfill */
export async function fulfillOrder(orderId: string) {
  const start = await transaction(async (client) => {
    const order = await queryOne<{ status: string; customer_id: string }>('SELECT status, customer_id FROM orders_order WHERE id = $1 FOR UPDATE', [orderId], client)
    if (!order || order.status === 'completed') return null
    if (order.status === 'paid') {
      validateOrderItems(await query<Item>('SELECT * FROM orders_order_item WHERE order_id = $1', [orderId], client))
      await transitionOrder(client, orderId, 'provisioning')
    } else if (order.status !== 'provisioning') return null
    return order
  })
  if (!start) return
  const items = await query<Item>('SELECT * FROM orders_order_item WHERE order_id = $1 ORDER BY created_at', [orderId])
  validateOrderItems(items)
  for (const item of [...items].sort((a, b) => Number(a.product_type !== 'domain') - Number(b.product_type !== 'domain'))) {
    const operation = operationFor(item)
    const attempt = await beginAttempt(item, operation)
    if (attempt && 'conflict' in attempt) throw new Error('Fulfillment request changed after the order was paid.')
    if (!attempt) continue
    try {
      const snapshot: Record<string, unknown> = operation === 'domain_registration' ? await fulfillDomain(start.customer_id, item) : await fulfillHosting(orderId, start.customer_id, item)
      await database().query('UPDATE orders_order_item SET provisioning_snapshot = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [item.id, JSON.stringify(snapshot)])
      await database().query(
        `UPDATE orders_fulfillmentattempt SET status = 'succeeded', provider_reference = $2, provider_resource_id = $3, completed_at = CURRENT_TIMESTAMP, last_error = '',
           next_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [attempt.id, String(snapshot.registrar_transaction_id || snapshot.registrar_order_id || snapshot.provider_reference || snapshot.username || ''), String(snapshot.domain_id || snapshot.account_id || '')],
      )
    } catch (error) {
      await database().query(`UPDATE orders_fulfillmentattempt SET status = 'ambiguous', last_error = $2, next_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [attempt.id, (error as Error).message])
      throw error
    }
  }
  await transaction(async (client) => {
    const current = (await queryOne<{ status: string }>('SELECT status FROM orders_order WHERE id = $1 FOR UPDATE', [orderId], client))!
    const rows = await query<{ completed: boolean; succeeded: boolean }>(
      `SELECT COALESCE((i.provisioning_snapshot ->> 'completed')::boolean, false) AS completed,
              EXISTS (SELECT 1 FROM orders_fulfillmentattempt a WHERE a.order_item_id = i.id AND a.status = 'succeeded'
                       AND a.operation = CASE WHEN i.product_type = 'domain' THEN 'domain_registration' ELSE 'hosting_provisioning' END) AS succeeded
         FROM orders_order_item i WHERE i.order_id = $1`,
      [orderId],
      client,
    )
    if (current.status === 'provisioning' && rows.length && rows.every((row) => row.completed && row.succeeded)) await transitionOrder(client, orderId, 'completed')
  })
}

/** orders/listeners.py: skip orders whose shape cannot be fulfilled instead of failing the event. */
export async function handleFulfillmentRequested(payload: Record<string, unknown>) {
  const orderId = payload.order_id as string | undefined
  if (!orderId) return
  const items = await query<Item>('SELECT * FROM orders_order_item WHERE order_id = $1', [orderId])
  try {
    validateOrderItems(items)
  } catch {
    return
  }
  await fulfillOrder(orderId)
}
