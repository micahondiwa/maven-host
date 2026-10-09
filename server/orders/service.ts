import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { HttpError, notFound } from '../http/errors'
import { enqueueOutbox } from '../jobs/outbox'
import { dispatchOnCommit } from '../events/bus'
import { encryptSecret } from '../lib/fernet'
import { pythonDumps } from '../lib/python-json'
import { calculatePrice, currencyByCode, defaultPricingRule, PAYMENT_CURRENCIES, type Currency } from '../pricing/engine'
import { assertSupplierReady, permittedPrice } from '../domains/routing'
import { OpenproviderRegistrar } from '../domains/registrars/openprovider'
import { verifiedPackages } from '../hosting/catalog'
import { ACTIVE_HOSTING_SUPPLIER } from '../hosting/suppliers'
import { createInvoiceFromOrder, onInvoiceSettled } from '../billing/service'

/** Port of apps/orders (cart, catalog, checkout, workflow) and the billing hand-off. */

const D = (value: Decimal.Value) => new Decimal(value)
const money = (value: Decimal.Value) => D(value).toFixed(2)
export const PRIMARY_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

/** DRF `raise ValidationError(str(exc))` from a view: a list body. */
export class OrderValidationError extends HttpError {
  constructor(message: string) {
    super(400, [message] as never)
  }
}
const invalid = (message: string) => new OrderValidationError(message)

const CYCLE_LABELS: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', semi_annually: 'Semi-Annually', annually: 'Annually', biennially: 'Biennially', triennially: 'Triennially' }

type Product = { id: string; product_type: 'domain' | 'hosting'; name: string; description: string; billing_cycle: string; unit_price: string; currency: string }

// --- Catalog (apps/orders/catalog) ---

function cartSelectable(plan: { is_active: boolean; target_entitlements: Record<string, unknown> }) {
  const targets = plan.target_entitlements ?? {}
  return Boolean(plan.is_active && targets.supplier === ACTIVE_HOSTING_SUPPLIER && ['reseller', 'wholesale_shared', 'infrastructure'].includes(targets.agreement as string) && targets.public_offers)
}

export async function hostingPurchasable(planId: number, db?: Queryable) {
  const plan = (await queryOne<{ is_active: boolean; requires_quote: boolean }>('SELECT is_active, requires_quote FROM hosting_hostingplan WHERE id = $1', [planId], db))!
  return plan.is_active && !plan.requires_quote && (await verifiedPackages([planId], db)).length > 0
}

async function hostingProduct(resourceId: string, currencyCode: string | null, forCart: boolean, db?: Queryable): Promise<Product> {
  const price = /^\d+$/.test(resourceId)
    ? await queryOne<{ id: number; billing_cycle: string; sale_price: string | null; regular_price: string; currency: string; plan_id: number; plan_name: string; plan_active: boolean; target_entitlements: Record<string, unknown> }>(
        `SELECT p.id, p.billing_cycle, p.sale_price, p.regular_price, c.code AS currency, pl.id AS plan_id, pl.name AS plan_name, pl.is_active AS plan_active, pl.target_entitlements
           FROM hosting_hostingplanprice p JOIN hosting_hostingplan pl ON pl.id = p.hosting_plan_id JOIN currencies_currency c ON c.id = p.currency_id
          WHERE p.id = $1 AND p.is_active AND pl.is_active`,
        [Number(resourceId)],
        db,
      )
    : undefined
  if (!price) throw notFound('No HostingPlanPrice matches the given query.')
  if (currencyCode && price.currency !== currencyCode.toUpperCase()) throw invalid('The selected hosting price does not match the requested currency.')
  if (!(await hostingPurchasable(price.plan_id, db)) && !(forCart && cartSelectable({ is_active: price.plan_active, target_entitlements: price.target_entitlements })))
    throw invalid('This hosting plan requires availability confirmation before checkout. Please contact MavenHost.')
  return {
    id: String(price.id), product_type: 'hosting', name: price.plan_name, description: `${price.plan_name} (${CYCLE_LABELS[price.billing_cycle] ?? price.billing_cycle})`,
    billing_cycle: price.billing_cycle, unit_price: price.sale_price ?? price.regular_price, currency: price.currency,
  }
}

async function domainProduct(resourceId: string, currencyCode: string | null, db?: Queryable): Promise<Product & { configuration: Record<string, unknown> }> {
  const price = /^\d+$/.test(resourceId)
    ? await queryOne<{ id: number; price: string; price_type: string; years: number; registrar_id: number; registrar_slug: string; tld_id: number; extension: string; currency_id: number }>(
        `SELECT p.id, p.price, p.price_type, p.years, p.registrar_id, r.slug AS registrar_slug, p.tld_id, t.extension, p.currency_id
           FROM domains_domainprice p JOIN domains_registrar r ON r.id = p.registrar_id JOIN domains_tld t ON t.id = p.tld_id
          WHERE p.id = $1 AND r.is_active AND t.is_active AND t.provider_supported`,
        [Number(resourceId)],
        db,
      )
    : undefined
  if (!price) throw notFound('No DomainPrice matches the given query.')
  if (!permittedPrice(price.registrar_slug, price.extension)) throw invalid('This domain price belongs to an inactive registration route.')
  assertSupplierReady(price.registrar_slug)
  const rule = await defaultPricingRule(db)
  if (!rule) throw invalid('No active default pricing rule is configured.')
  if (currencyCode && !PAYMENT_CURRENCIES.includes(currencyCode.toUpperCase())) throw invalid(`Payments are accepted in ${PAYMENT_CURRENCIES.join(' or ')}.`)
  const target = await currencyByCode((currencyCode || 'USD').toUpperCase(), db)
  if (!target) throw notFound('No Currency matches the given query.')
  const supplierCurrency = (await queryOne<Currency>('SELECT * FROM currencies_currency WHERE id = $1', [price.currency_id], db))!
  const quote = await calculatePrice({ supplierPrice: price.price, supplierCurrency, targetCurrency: target, rule }, db)
  const verb = price.price_type === 'register' ? 'Register' : price.price_type === 'renew' ? 'Renew' : 'Transfer'
  return {
    id: String(price.id), product_type: 'domain', name: price.extension, description: `${verb} ${price.extension}`, billing_cycle: 'annually', unit_price: quote.sellingPrice, currency: quote.currency,
    configuration: { registrar: price.registrar_id, years: price.years, price_type: price.price_type, tld: price.tld_id, supplier_price: price.price, supplier_currency: supplierCurrency.code, pricing_rule: rule.name },
  }
}

export async function catalogProduct(productType: string, resourceId: string, currencyCode: string | null = null, forCart = false, db?: Queryable): Promise<Product> {
  if (productType === 'hosting') return hostingProduct(resourceId, currencyCode, forCart, db)
  if (productType === 'domain') return domainProduct(resourceId, currencyCode, db)
  throw invalid(`No catalog is registered for product type '${productType}'.`)
}

// --- Cart (CartService) ---

type CartItemRow = { id: string; cart_id: string; product_type: string; resource_id: string; name: string; description: string; billing_cycle: string; quantity: number; unit_price: string; discount: string; configuration: Record<string, unknown> }

const tokenHash = (token: string) => {
  if (token.length < 40 || token.length > 128) throw invalid('A valid guest cart token is required.')
  return createHash('sha256').update(token).digest('hex')
}

export async function resolveCart(db: Queryable, customerId: string | null, guestToken: string | null): Promise<string> {
  if (!customerId && !guestToken) throw invalid('A cart token is required for guest carts.')
  const hash = guestToken ? tokenHash(guestToken) : null
  if (customerId) {
    await db.query(`INSERT INTO orders_cart (id, is_active, created_at, updated_at, owner_id, guest_token_hash) VALUES ($1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, NULL) ON CONFLICT (owner_id) DO NOTHING`, [randomUUID(), customerId])
    const cart = (await queryOne<{ id: string }>('SELECT id FROM orders_cart WHERE owner_id = $1', [customerId], db))!
    if (hash) {
      const guest = await queryOne<{ id: string }>('SELECT id FROM orders_cart WHERE owner_id IS NULL AND guest_token_hash = $1', [hash], db)
      if (guest && guest.id !== cart.id)
        await transaction(async (client) => {
          await client.query('UPDATE orders_cart_item SET cart_id = $2 WHERE cart_id = $1', [guest.id, cart.id])
          await client.query('DELETE FROM orders_cart WHERE id = $1', [guest.id])
        }, db)
    }
    return cart.id
  }
  await db.query(`INSERT INTO orders_cart (id, is_active, created_at, updated_at, owner_id, guest_token_hash) VALUES ($1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, $2) ON CONFLICT (guest_token_hash) DO NOTHING`, [randomUUID(), hash])
  return (await queryOne<{ id: string }>('SELECT id FROM orders_cart WHERE guest_token_hash = $1', [hash], db))!.id
}

/** Currency of the items already in a cart: domains keep it on the item, hosting prices carry their own currency. */
async function cartCurrency(db: Queryable, items: Pick<CartItemRow, 'product_type' | 'resource_id' | 'configuration'>[]): Promise<string | null> {
  for (const item of items) {
    if (item.product_type === 'domain') return typeof item.configuration?.currency === 'string' ? item.configuration.currency : 'USD'
    if (item.product_type === 'hosting' && /^\d+$/.test(item.resource_id)) {
      const row = await queryOne<{ code: string }>('SELECT c.code FROM hosting_hostingplanprice p JOIN currencies_currency c ON c.id = p.currency_id WHERE p.id = $1', [Number(item.resource_id)], db)
      if (row) return row.code
    }
  }
  return null
}

const itemTotal = (item: Pick<CartItemRow, 'unit_price' | 'quantity' | 'discount'>) => D(item.unit_price).mul(item.quantity).sub(item.discount)

export async function cartSummary(db: Queryable, cartId: string) {
  const items = await query<CartItemRow>('SELECT * FROM orders_cart_item WHERE cart_id = $1 ORDER BY created_at', [cartId], db)
  const hostingIds = items.filter((item) => item.product_type === 'hosting' && /^\d+$/.test(item.resource_id)).map((item) => Number(item.resource_id))
  const prices = new Map((await query<{ id: number; is_active: boolean; plan_id: number }>('SELECT id, is_active, hosting_plan_id AS plan_id FROM hosting_hostingplanprice WHERE id = ANY($1)', [hostingIds], db)).map((row) => [String(row.id), row]))
  const summaries = []
  for (const item of items) {
    let blocked = false
    if (item.product_type === 'hosting') {
      const price = prices.get(item.resource_id)
      blocked = !price || !price.is_active || !(await hostingPurchasable(price.plan_id, db))
    }
    summaries.push({
      checkout_blocked: blocked, item_id: item.id, product_type: item.product_type, resource_id: item.resource_id, name: item.name, billing_cycle: item.billing_cycle,
      domain_name: item.product_type === 'hosting' ? String(item.configuration?.domain ?? '') : '', quantity: item.quantity, unit_price: item.unit_price, discount: item.discount, total: money(itemTotal(item)),
    })
  }
  const subtotal = items.reduce((sum, item) => sum.add(D(item.unit_price).mul(item.quantity)), D(0))
  const discount = items.reduce((sum, item) => sum.add(item.discount), D(0))
  return { cart_id: cartId, currency: (await cartCurrency(db, items)) ?? 'USD', items: summaries, subtotal: money(subtotal), discount: money(discount), tax: '0.00', total: money(subtotal.sub(discount)) }
}

export async function addCartItem(customerId: string | null, guestToken: string | null, input: { product_type: string; resource_id: string; billing_cycle: string; quantity: number; configuration: Record<string, unknown>; currency: string | null }) {
  return transaction(async (client) => {
    const cartId = await resolveCart(client, customerId, guestToken)
    const product = await catalogProduct(input.product_type, input.resource_id, input.currency, true, client)
    // One currency per cart: checkout already refuses mixed currencies, so refuse them when the item is added.
    const existingCurrency = await cartCurrency(client, await query<CartItemRow>('SELECT * FROM orders_cart_item WHERE cart_id = $1', [cartId], client))
    if (existingCurrency && existingCurrency !== product.currency)
      throw invalid(`Your cart is priced in ${existingCurrency}. Switch to ${existingCurrency} to add this item, or empty your cart first.`)
    if (input.billing_cycle !== product.billing_cycle) throw invalid('The requested billing cycle does not match the selected product.')
    let configuration: Record<string, unknown> = { ...(input.configuration ?? {}) }
    if (input.product_type === 'domain') {
      if (input.quantity !== 1) throw invalid('Domain purchases must have quantity 1.')
      const domain = String(configuration.domain ?? '').trim().toLowerCase()
      if (!domain || domain.includes('@') || !domain.includes('.')) throw invalid('A valid fully-qualified domain is required for domain cart items.')
      // v1 priced the cart in the requested currency but re-priced checkout in the default currency, so a KES cart
      // produced a USD invoice. The selected currency is kept on the item and reused at checkout.
      configuration = { ...configuration, domain, ...(input.currency ? { currency: product.currency } : {}) }
    }
    if (input.product_type === 'hosting') {
      if (input.quantity !== 1) throw invalid('Hosting purchases must have quantity 1.')
      const hostingDomain = String(configuration.domain ?? '').trim().toLowerCase().replace(/\.$/, '')
      if (hostingDomain && !PRIMARY_DOMAIN.test(hostingDomain)) throw invalid('Enter a primary domain name, not an email address. A domain purchase is separate from hosting.')
      if (hostingDomain) configuration.domain = hostingDomain
      else delete configuration.domain
      const password = configuration.password
      delete configuration.password
      if (password) configuration.password_encrypted = encryptSecret(String(password))
    }
    const existing = await query<CartItemRow>('SELECT * FROM orders_cart_item WHERE cart_id = $1 AND product_type = $2 AND resource_id = $3 AND billing_cycle = $4', [cartId, product.product_type, product.id, product.billing_cycle], client)
    const same = existing.find((item) => pythonDumps(item.configuration, { sortKeys: true }) === pythonDumps(configuration, { sortKeys: true }))
    let itemId: string
    if (same) {
      await client.query('UPDATE orders_cart_item SET quantity = quantity + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [same.id, input.quantity])
      itemId = same.id
    } else {
      itemId = randomUUID()
      await client.query(
        `INSERT INTO orders_cart_item (id, product_type, resource_id, name, description, billing_cycle, quantity, unit_price, discount, configuration, created_at, updated_at, cart_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, clock_timestamp(), clock_timestamp(), $10)`,
        [itemId, product.product_type, product.id, product.name, product.description, product.billing_cycle, input.quantity, product.unit_price, JSON.stringify(configuration), cartId],
      )
    }
    return { cart_id: cartId, item_id: itemId }
  })
}

export async function updateCartQuantity(customerId: string | null, guestToken: string | null, itemId: string, quantity: number) {
  const db = database()
  const cartId = await resolveCart(db, customerId, guestToken)
  const item = await queryOne<CartItemRow>('SELECT * FROM orders_cart_item WHERE id = $1 AND cart_id = $2', [itemId, cartId])
  if (!item) throw notFound('No CartItem matches the given query.')
  if (quantity < 1) throw invalid('Cart quantity must be at least 1.')
  if ((item.product_type === 'domain' || item.product_type === 'hosting') && quantity !== 1)
    throw invalid(`${item.product_type[0].toUpperCase()}${item.product_type.slice(1)} purchases must have quantity 1.`)
  await db.query('UPDATE orders_cart_item SET quantity = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [item.id, quantity])
  return cartSummary(db, cartId)
}

export async function removeCartItem(customerId: string | null, guestToken: string | null, itemId: string) {
  const db = database()
  const cartId = await resolveCart(db, customerId, guestToken)
  await db.query('DELETE FROM orders_cart_item WHERE cart_id = $1 AND id = $2', [cartId, itemId])
}

export async function clearCart(customerId: string | null, guestToken: string | null) {
  const db = database()
  await db.query('DELETE FROM orders_cart_item WHERE cart_id = $1', [await resolveCart(db, customerId, guestToken)])
}

// --- Order workflow (OrderWorkflowService) ---

const ORDER_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_payment', 'cancelled'], pending_payment: ['paid', 'expired', 'cancelled'], paid: ['provisioning', 'cancelled'],
  provisioning: ['completed'], completed: [], cancelled: [], expired: [], failed: [],
}

export class InvalidOrderTransition extends HttpError {
  constructor(message: string) {
    super(400, [message] as never)
  }
}

export async function transitionOrder(db: Queryable, orderId: string, target: string) {
  return transaction(async (client) => {
    const order = await queryOne<{ id: string; number: string; status: string; customer_id: string; total: string; currency: string }>('SELECT * FROM orders_order WHERE id = $1 FOR UPDATE', [orderId], client)
    if (!order) throw notFound('No Order matches the given query.')
    if (!(ORDER_TRANSITIONS[order.status] ?? []).includes(target)) throw new InvalidOrderTransition(`Cannot transition ${order.status} -> ${target}`)
    await client.query(
      `UPDATE orders_order SET status = $2::text, placed_at = CASE WHEN $2::text = 'paid' THEN CURRENT_TIMESTAMP ELSE placed_at END,
         completed_at = CASE WHEN $2::text = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [orderId, target],
    )
    if (target === 'paid') {
      const payload = { order_id: order.id, order_number: order.number, customer_id: order.customer_id }
      await enqueueOutbox(client, { eventId: randomUUID(), name: 'orders.fulfillment.requested', payload, occurredAt: new Date() }, `order-fulfillment:${order.id}`)
      dispatchOnCommit(client, 'orders.order.paid', { ...payload, amount: order.total, currency: order.currency })
    }
    return { ...order, status: target }
  }, db)
}

onInvoiceSettled(async (db, orderId) => {
  await transitionOrder(db, orderId, 'paid')
})

/** Order numbers stay sequential per year; v1 used count+1, which collided after any deletion. */
async function nextOrderNumber(db: Queryable) {
  await db.query('SELECT pg_advisory_xact_lock($1)', [84190930])
  const year = new Date(Date.now() + 3 * 3600_000).getUTCFullYear()
  const latest = await queryOne<{ n: number }>(`SELECT COALESCE(MAX(substring(number from '^ORD-${year}-(\\d+)$')::integer), 0) AS n FROM orders_order WHERE number LIKE $1`, [`ORD-${year}-%`], db)
  const count = Math.max(latest!.n, (await queryOne<{ n: number }>('SELECT count(*)::integer AS n FROM orders_order', [], db))!.n) + 1
  return `ORD-${year}-${String(count).padStart(6, '0')}`
}

// --- Checkout (CheckoutService) ---

type CheckoutInput = { notes: string; hosting_passwords: Record<string, string>; hosting_domains: Record<string, string>; domain_contact?: Record<string, string> }

export async function checkout(customerId: string, input: CheckoutInput) {
  return transaction(async (client) => {
    const cartId = await resolveCart(client, customerId, null)
    let items = await query<CartItemRow>('SELECT * FROM orders_cart_item WHERE cart_id = $1 ORDER BY created_at FOR UPDATE', [cartId], client)
    if (!items.length) throw invalid('Cannot checkout an empty cart.')
    const itemCurrency = (item: CartItemRow) => (item.product_type === 'domain' && typeof item.configuration?.currency === 'string' ? item.configuration.currency : null)
    for (const item of items) if (item.product_type === 'hosting') await catalogProduct(item.product_type, item.resource_id, null, false, client)
    const contact = input.domain_contact ?? {}
    for (const item of items) {
      if (item.product_type !== 'domain') continue
      const registrar = (await queryOne<{ slug: string }>('SELECT r.slug FROM domains_domainprice p JOIN domains_registrar r ON r.id = p.registrar_id WHERE p.id = $1', [Number(item.resource_id)], client))?.slug
      if (registrar === 'register_ke') throw invalid('Register.co.ke checkout is disabled pending reseller API integration.')
      if (registrar === 'registry_tz') throw invalid('registry.co.tz checkout is disabled pending reseller API integration.')
      if (registrar === 'openprovider') {
        if (!Object.keys(contact).length) throw invalid('Complete registration contact details are required before payment.')
        try {
          OpenproviderRegistrar.customerPayload(contact as never)
        } catch (error) {
          throw invalid((error as Error).message)
        }
      }
      if (Object.keys(contact).length) {
        const configuration = { ...item.configuration, registrant: { ...contact }, admin: { ...contact }, technical: { ...contact }, billing: { ...contact } }
        await client.query('UPDATE orders_cart_item SET configuration = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [item.id, JSON.stringify(configuration)])
        item.configuration = configuration
      }
    }
    const hostingItems = items.filter((item) => item.product_type === 'hosting')
    const hostingIds = new Set(hostingItems.map((item) => item.id))
    if (Object.keys(input.hosting_passwords).some((id) => !hostingIds.has(id))) throw invalid('A hosting password was provided for an item that is not in this cart.')
    if (Object.keys(input.hosting_domains).some((id) => !hostingIds.has(id))) throw invalid('A hosting domain was provided for an item that is not in this cart.')
    for (const item of hostingItems) {
      const configuration = { ...item.configuration }
      const supplied = (input.hosting_domains[item.id] ?? '').trim().toLowerCase().replace(/\.$/, '')
      const domainName = supplied || String(configuration.domain ?? '').trim().toLowerCase().replace(/\.$/, '')
      if (supplied) {
        configuration.domain = supplied
        delete configuration.domain_id
      }
      if (domainName && !PRIMARY_DOMAIN.test(domainName)) throw invalid(`Enter a valid primary domain name for ${item.name}, such as yourbusiness.com.`)
      if (!domainName && configuration.domain_id) {
        if (!(await queryOne('SELECT 1 FROM domains_domain WHERE id = $1 AND owner_id = $2', [configuration.domain_id, customerId], client))) throw invalid(`Select a domain that belongs to your account for ${item.name}.`)
      } else if (!domainName) throw invalid(`Choose a primary domain for ${item.name} before checkout. You can add hosting to your cart first and provide the domain here.`)
      const password = input.hosting_passwords[item.id]
      if (password) {
        configuration.password_encrypted = encryptSecret(password)
        delete configuration.password
        await client.query('UPDATE orders_cart_item SET configuration = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [item.id, JSON.stringify(configuration)])
        item.configuration = configuration
      } else if (!configuration.password_encrypted) throw invalid(`A control-panel password is required for ${item.name}.`)
    }
    for (const item of items)
      if ((item.product_type === 'domain' || item.product_type === 'hosting') && item.quantity !== 1) throw invalid(`${item.product_type[0].toUpperCase()}${item.product_type.slice(1)} purchases must have quantity 1.`)
    // Re-resolve every price at checkout so the order never uses a stale cart price.
    const currencies = new Set<string>()
    for (const item of items) {
      const product = await catalogProduct(item.product_type, item.resource_id, itemCurrency(item), false, client)
      currencies.add(product.currency)
      await client.query('UPDATE orders_cart_item SET unit_price = $2, name = $3, description = $4, billing_cycle = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [item.id, product.unit_price, product.name, product.description, product.billing_cycle])
    }
    if (currencies.size !== 1) throw invalid('All order items must use the same currency.')
    items = await query<CartItemRow>('SELECT * FROM orders_cart_item WHERE cart_id = $1 ORDER BY created_at FOR UPDATE', [cartId], client)
    const summary = await cartSummary(client, cartId)
    const orderId = randomUUID()
    const number = await nextOrderNumber(client)
    await client.query('UPDATE orders_order SET cart_id = NULL WHERE cart_id = $1', [cartId])
    await client.query(
      `INSERT INTO orders_order (id, number, status, subtotal, discount, tax, total, currency, notes, placed_at, completed_at, created_at, updated_at, cart_id, customer_id)
       VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $9, $10)`,
      [orderId, number, summary.subtotal, summary.discount, summary.tax, summary.total, [...currencies][0], input.notes, cartId, customerId],
    )
    for (const item of items)
      await client.query(
        `INSERT INTO orders_order_item (id, product_type, resource_id, name, description, billing_cycle, quantity, unit_price, discount, tax, total, pricing_snapshot, configuration,
           provisioning_snapshot, created_at, updated_at, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12, '{}', clock_timestamp(), clock_timestamp(), $13)`,
        [randomUUID(), item.product_type, item.resource_id, item.name, item.description, item.billing_cycle, item.quantity, item.unit_price, item.discount, money(itemTotal(item)),
          JSON.stringify({ unit_price: item.unit_price, discount: item.discount, billing_cycle: item.billing_cycle }), JSON.stringify(item.configuration ?? {}), orderId],
      )
    await transitionOrder(client, orderId, 'pending_payment')
    const invoice = await createInvoiceFromOrder(client, orderId, true)
    await client.query('DELETE FROM orders_cart_item WHERE cart_id = $1', [cartId])
    return { order_id: orderId, order_number: number, invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number }
  })
}

// --- Order queries (OrderService) ---

type OrderRow = { id: string; number: string; status: string; subtotal: string; discount: string; tax: string; total: string; currency: string; customer_id: string }

const orderSummary = (order: OrderRow) => ({ order_id: order.id, number: order.number, status: order.status, subtotal: order.subtotal, discount: order.discount, tax: order.tax, total: order.total, currency: order.currency })

export async function listOrders(customerId: string) {
  return (await query<OrderRow>('SELECT * FROM orders_order WHERE customer_id = $1 ORDER BY created_at DESC', [customerId])).map(orderSummary)
}

export async function orderDetail(orderId: string, customerId: string, itemKey: 'id' | 'order_item_id' = 'id') {
  const order = await queryOne<OrderRow>('SELECT * FROM orders_order WHERE id = $1 AND customer_id = $2', [orderId, customerId])
  if (!order) throw notFound('No Order matches the given query.')
  const items = await query<{ id: string; product_type: string; resource_id: string; name: string; description: string; billing_cycle: string; quantity: number; unit_price: string; discount: string; tax: string; total: string }>(
    'SELECT id, product_type, resource_id, name, description, billing_cycle, quantity, unit_price, discount, tax, total FROM orders_order_item WHERE order_id = $1 ORDER BY created_at',
    [orderId],
  )
  return { order: orderSummary(order), items: items.map(({ id, ...item }) => ({ [itemKey]: id, ...item })) }
}

export async function cancelOrder(orderId: string, customerId: string) {
  const order = await queryOne<OrderRow>('SELECT * FROM orders_order WHERE id = $1 AND customer_id = $2', [orderId, customerId])
  if (!order) throw notFound('No Order matches the given query.')
  if (!['draft', 'pending_payment'].includes(order.status)) throw new HttpError(409, { detail: 'Only unpaid orders can be cancelled.' })
  await transitionOrder(database(), orderId, 'cancelled')
}
