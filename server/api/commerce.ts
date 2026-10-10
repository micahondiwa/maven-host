import 'server-only'
import { database, queryOne } from '../db'
import { AllowAny, json, Router, type Context } from '../http/router'
import { HttpError, ValidationError, notFound } from '../http/errors'
import { f, validate } from '../http/validation'
import { staffPermission } from '../auth/permissions'
import * as orders from '../orders/service'
import * as billing from '../billing/service'
import * as adjustments from '../billing/adjustments'
import { PaymentProviderWebhookError } from '../billing/providers'
import { CHANNELS, NOTIFICATION_TYPES, notificationsApi } from '../notifications/service'

/** apps/orders/api/urls.py, apps/billing/api/urls.py, apps/notifications/api/urls.py and the staff customer views. */

const BILLING_CYCLES = ['monthly', 'quarterly', 'semi_annually', 'annually', 'biennially', 'triennially'] as const

function cartIdentity(ctx: Context) {
  const token = ctx.header('x-guest-cart-token') || null
  if (!ctx.user && !token) throw new ValidationError({ guest_cart: ['A guest cart token is required.'] })
  return { customerId: ctx.user?.id ?? null, token }
}

const allowAny = { permissions: [AllowAny] }

export const orderRoutes = new Router()
  .get('', (ctx) => orders.listOrders(ctx.authenticatedUser.id))
  .get('cart/', async (ctx) => {
    const { customerId, token } = cartIdentity(ctx)
    return orders.cartSummary(database(), await orders.resolveCart(database(), customerId, token))
  }, allowAny)
  .post('cart/', async (ctx) => {
    const data = validate(
      {
        product_type: f.choice(['domain', 'hosting', 'ssl', 'email', 'dns', 'addon'] as const),
        resource_id: f.string({ maxLength: 64 }),
        billing_cycle: f.choice(BILLING_CYCLES),
        quantity: f.integer({ min: 1, max: 100 }),
        configuration: f.json({ default: () => ({}) }),
        currency: f.choice(['KES', 'USD'] as const).nullable().optional(),
      },
      await ctx.body(),
    )
    const { customerId, token } = cartIdentity(ctx)
    const configuration = data.configuration && typeof data.configuration === 'object' && !Array.isArray(data.configuration) ? (data.configuration as Record<string, unknown>) : {}
    return json(await orders.addCartItem(customerId, token, { ...data, configuration, currency: data.currency ?? null }), 201)
  }, allowAny)
  .patch('cart/items/<uuid:item_id>/', async (ctx) => {
    const data = validate({ quantity: f.integer({ min: 1, max: 100 }) }, await ctx.body())
    const { customerId, token } = cartIdentity(ctx)
    return orders.updateCartQuantity(customerId, token, ctx.params.item_id, data.quantity)
  }, allowAny)
  .delete('cart/items/<uuid:item_id>/', async (ctx) => {
    const { customerId, token } = cartIdentity(ctx)
    await orders.removeCartItem(customerId, token, ctx.params.item_id)
    return undefined
  }, allowAny)
  .delete('cart/clear/', async (ctx) => {
    const { customerId, token } = cartIdentity(ctx)
    await orders.clearCart(customerId, token)
    return undefined
  }, allowAny)
  .post('checkout/', async (ctx) => {
    const contactField = f.object({
      first_name: f.string({ maxLength: 100 }), last_name: f.string({ maxLength: 100 }), organization: f.string({ maxLength: 255, allowBlank: true, default: '' }), email: f.email(),
      phone: f.string({ maxLength: 50 }), address1: f.string({ maxLength: 255 }), address2: f.string({ maxLength: 255, allowBlank: true, default: '' }), city: f.string({ maxLength: 100 }),
      state: f.string({ maxLength: 100 }), postal_code: f.string({ maxLength: 30 }), country: f.string({ maxLength: 2 }),
      street_number: f.string({ maxLength: 30, allowBlank: true, default: '' }), street_suffix: f.string({ maxLength: 30, allowBlank: true, default: '' }),
      phone_country_code: f.string({ maxLength: 5, allowBlank: true, default: '' }), phone_area_code: f.string({ maxLength: 10, allowBlank: true, default: '' }),
      phone_subscriber_number: f.string({ maxLength: 20, allowBlank: true, default: '' }),
    })
    const data = validate(
      {
        domain_contact: contactField.optional(),
        customer_id: f.uuid().optional(),
        notes: f.string({ allowBlank: true, default: '' }),
        hosting_passwords: f.dict({ default: () => ({}) }),
        hosting_domains: f.dict({ default: () => ({}) }),
      },
      await ctx.body(),
    )
    if (data.customer_id && data.customer_id !== ctx.authenticatedUser.id) throw new HttpError(403, { detail: "You cannot checkout another customer's cart." })
    const strings = (name: string, value: Record<string, unknown>, min: number, max: number, trim: boolean) => {
      const errors: Record<string, string[]> = {}
      const result: Record<string, string> = {}
      for (const [key, raw] of Object.entries(value)) {
        const text = typeof raw === 'string' ? (trim ? raw.trim() : raw) : null
        if (text === null) errors[key] = ['Not a valid string.']
        else if (text.length < min) errors[key] = [text ? `Ensure this field has at least ${min} characters.` : 'This field may not be blank.']
        else if (text.length > max) errors[key] = [`Ensure this field has no more than ${max} characters.`]
        else result[key] = text
      }
      if (Object.keys(errors).length) throw new ValidationError({ [name]: errors })
      return result
    }
    return json(
      await orders.checkout(ctx.authenticatedUser.id, {
        notes: data.notes,
        hosting_passwords: strings('hosting_passwords', data.hosting_passwords, 8, 128, false),
        hosting_domains: strings('hosting_domains', data.hosting_domains, 1, 253, true),
        domain_contact: data.domain_contact as Record<string, string> | undefined,
      }),
      201,
    )
  })
  .get('<uuid:order_id>/', (ctx) => orders.orderDetail(ctx.params.order_id, ctx.authenticatedUser.id))
  .post('<uuid:order_id>/cancel/', async (ctx) => {
    await orders.cancelOrder(ctx.params.order_id, ctx.authenticatedUser.id)
    return undefined
  })
  .post('<uuid:order_id>/complete/', async (ctx) => {
    await orders.transitionOrder(database(), ctx.params.order_id, 'completed')
    return undefined
  }, { permissions: [staffPermission('fulfill_order')] })

function headerMap(ctx: Context) {
  const headers: Record<string, string> = {}
  ctx.request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

export const billingRoutes = new Router()
  .get('gateways/', () => billing.listGateways())
  .get('invoices/', (ctx) => billing.listInvoices(ctx.authenticatedUser.id))
  .get('invoices/<uuid:invoice_id>/', (ctx) => billing.invoiceDetail(ctx.params.invoice_id, ctx.authenticatedUser.id))
  .post('invoices/<uuid:invoice_id>/payments/', async (ctx) => {
    const data = validate({ gateway_slug: f.string({ maxLength: 100 }), idempotency_key: f.string({ maxLength: 255 }).optional(), phone_number: f.string({ maxLength: 30 }).optional() }, await ctx.body())
    return json(await billing.initiatePayment(ctx.params.invoice_id, ctx.authenticatedUser.id, data), 201)
  }, { throttle: 'payment_initiation' })
  .get('payments/', (ctx) => billing.listPayments(ctx.authenticatedUser.id))
  .get('payments/<uuid:payment_id>/', (ctx) => billing.paymentDetail(ctx.params.payment_id, ctx.authenticatedUser.id))
  .post('transactions/<uuid:transaction_id>/verify/', (ctx) => billing.verifyPayment(ctx.params.transaction_id, ctx.authenticatedUser.id), { throttle: 'payment_verification' })
  .post('webhooks/<slug:gateway_slug>/', async (ctx) => {
    try {
      return await billing.processWebhook(ctx.params.gateway_slug, await ctx.body(), headerMap(ctx), await ctx.rawBody())
    } catch (error) {
      if (error instanceof PaymentProviderWebhookError) return json({ detail: error.message }, 400)
      throw error
    }
  }, { authenticate: false, permissions: [AllowAny] })
  .post('webhooks/<slug:gateway_slug>/reconciliation/', async (ctx) => {
    const gateway = await billing.authorizeReconciliation(ctx.params.gateway_slug, ctx.query.get('token'))
    const reconciliation = await billing.reconcileMpesaC2B(gateway, await ctx.body())
    return { status: reconciliation.status, external_reference: reconciliation.external_reference, reconciliation_id: reconciliation.id }
  }, { authenticate: false, permissions: [AllowAny] })

export const notificationRoutes = new Router()
  .get('', (ctx) => notificationsApi.list(ctx.authenticatedUser.id))
  .get('unread-count/', (ctx) => notificationsApi.unreadCount(ctx.authenticatedUser.id))
  .post('read-all/', (ctx) => notificationsApi.markAllRead(ctx.authenticatedUser.id))
  .post('<uuid:notification_id>/read/', (ctx) => notificationsApi.markRead(ctx.authenticatedUser.id, ctx.params.notification_id))
  .get('preferences/', (ctx) => notificationsApi.preferences(ctx.authenticatedUser.id))
  .put('preferences/', async (ctx) => {
    const data = validate({ notification_type: f.choice(NOTIFICATION_TYPES), channel: f.choice(CHANNELS), enabled: f.boolean({ default: true }) }, await ctx.body())
    return notificationsApi.setPreference(ctx.authenticatedUser.id, data.notification_type, data.channel, data.enabled)
  })

function omit<T extends Record<string, unknown>>(value: T, keys: string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
}

async function staffCustomer(ctx: Context) {
  if (!(await queryOne('SELECT 1 FROM accounts_user WHERE id = $1 AND NOT is_staff AND NOT is_superuser', [ctx.params.customer_id]))) throw notFound('No User matches the given query.')
  return ctx.params.customer_id
}

const viewing = (code: string) => ({ permissions: [staffPermission('view_customer'), staffPermission(code)] })
const refunding = { permissions: [staffPermission('view_customer'), staffPermission('view_payment'), staffPermission('issue_refund')] }
const crediting = { permissions: [staffPermission('view_customer'), staffPermission('view_invoice'), staffPermission('create_invoice')] }

/** Staff customer orders, invoices and payments, plus staff-recorded payments (replaces the Django admin action). */
export const staffCommerceRoutes = new Router()
  .get('<uuid:customer_id>/orders/', async (ctx) => orders.listOrders(await staffCustomer(ctx)), viewing('view_order'))
  .get('<uuid:customer_id>/orders/<uuid:order_id>/', async (ctx) => orders.orderDetail(ctx.params.order_id, await staffCustomer(ctx), 'order_item_id'), viewing('view_order'))
  .get('<uuid:customer_id>/invoices/', async (ctx) => (await billing.listInvoices(await staffCustomer(ctx))).map((invoice) => omit(invoice, ['customer_id'])), viewing('view_invoice'))
  .get('<uuid:customer_id>/invoices/<uuid:invoice_id>/', async (ctx) => {
    const detail = await billing.invoiceDetail(ctx.params.invoice_id, await staffCustomer(ctx))
    return { ...detail, invoice: omit(detail.invoice, ['customer_id']), items: detail.items.map((item) => omit(item, ['pricing_snapshot', 'configuration_snapshot'])) }
  }, viewing('view_invoice'))
  .get('<uuid:customer_id>/payments/', async (ctx) => billing.listPayments(await staffCustomer(ctx)), viewing('view_payment'))
  .get('<uuid:customer_id>/payments/<uuid:payment_id>/', async (ctx) => {
    const { payment, customer_reference, processed_at } = await billing.paymentDetail(ctx.params.payment_id, await staffCustomer(ctx))
    return { payment, customer_reference, processed_at }
  }, viewing('view_payment'))
  .post('<uuid:customer_id>/invoices/<uuid:invoice_id>/payments/', async (ctx) => {
    await billing.invoiceDetail(ctx.params.invoice_id, await staffCustomer(ctx))
    const data = validate(
      {
        amount: f.decimal({ maxDigits: 12, decimalPlaces: 2, min: '0.01' }),
        method: f.choice(['mpesa', 'card', 'bank_transfer', 'manual'] as const),
        gateway_id: f.uuid().nullable().optional(),
        provider_reference: f.string({ maxLength: 255, allowBlank: true, default: '' }),
        customer_reference: f.string({ maxLength: 255, allowBlank: true, default: '' }),
      },
      await ctx.body(),
    )
    return json(await billing.recordManualPayment({ invoiceId: ctx.params.invoice_id, amount: data.amount, method: data.method, gatewayId: data.gateway_id, providerReference: data.provider_reference, customerReference: data.customer_reference }), 201)
  }, { permissions: [staffPermission('view_customer'), staffPermission('process_payment')] })
  // Refunds and credit notes (replaces the Django admin; v1 had no API for them).
  .get('<uuid:customer_id>/invoices/<uuid:invoice_id>/adjustments/', async (ctx) => adjustments.invoiceAdjustments(await staffCustomer(ctx), ctx.params.invoice_id), viewing('view_invoice'))
  .post('<uuid:customer_id>/payments/<uuid:payment_id>/refunds/', async (ctx) => {
    const data = validate({ amount: f.decimal({ maxDigits: 12, decimalPlaces: 2, min: '0.01' }), reason: f.string({ maxLength: 2000 }) }, await ctx.body())
    return json(await adjustments.createRefund({ actorId: ctx.authenticatedUser.id, customerId: await staffCustomer(ctx), paymentId: ctx.params.payment_id, amount: data.amount, reason: data.reason }), 201)
  }, refunding)
  .post('<uuid:customer_id>/refunds/<uuid:refund_id>/<str:action>/', async (ctx) => {
    const target = ({ process: 'processing', complete: 'completed', fail: 'failed', cancel: 'cancelled' } as const)[ctx.params.action as 'process']
    if (!target) throw notFound()
    const data = validate({ provider_reference: f.string({ maxLength: 255 }).optional() }, await ctx.body())
    return adjustments.transitionRefund({ actorId: ctx.authenticatedUser.id, customerId: await staffCustomer(ctx), refundId: ctx.params.refund_id, target, providerReference: data.provider_reference })
  }, refunding)
  .post('<uuid:customer_id>/invoices/<uuid:invoice_id>/credit-notes/', async (ctx) => {
    const data = validate({ amount: f.decimal({ maxDigits: 12, decimalPlaces: 2, min: '0.01' }), reason: f.string({ maxLength: 2000 }) }, await ctx.body())
    return json(await adjustments.createCreditNote({ actorId: ctx.authenticatedUser.id, customerId: await staffCustomer(ctx), invoiceId: ctx.params.invoice_id, amount: data.amount, reason: data.reason }), 201)
  }, crediting)
  .post('<uuid:customer_id>/credit-notes/<uuid:credit_note_id>/<str:action>/', async (ctx) => {
    const target = ({ issue: 'issued', apply: 'applied', cancel: 'cancelled' } as const)[ctx.params.action as 'issue']
    if (!target) throw notFound()
    return adjustments.transitionCreditNote({ actorId: ctx.authenticatedUser.id, customerId: await staffCustomer(ctx), creditNoteId: ctx.params.credit_note_id, target })
  }, crediting)
