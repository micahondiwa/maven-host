import 'server-only'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import Decimal from 'decimal.js'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { DetailError, HttpError, notFound } from '../http/errors'
import { dispatchOnCommit } from '../events/bus'
import { decryptProviderSecret } from '../lib/fernet'
import { paymentProvider, PaymentProviderError, type Gateway, type ProviderResult, type TransactionStatus } from './providers'

/** Port of apps/billing services: invoices, settlement, payment transactions, webhooks and reconciliation. */

const D = (value: Decimal.Value) => new Decimal(value)
const money = (value: Decimal.Value) => D(value).toFixed(2)
/** DRF `ValidationError('message')` raised outside a serializer renders as a list body. */
export class BillingValidationError extends HttpError {
  constructor(message: string) {
    super(400, [message] as never)
  }
}

type InvoiceRow = {
  id: string; number: string; order_id: string; customer_id: string; status: string; currency_id: number; currency: string
  subtotal: string; discount: string; tax: string; total: string; paid_amount: string; credited_amount: string; payment_terms: number
  notes: string; issued_at: Date | null; due_date: string | null; paid_at: Date | null; cancelled_at: Date | null; created_at: Date
}

const INVOICE_SELECT = 'SELECT i.*, c.code AS currency FROM billing_invoice i JOIN currencies_currency c ON c.id = i.currency_id'

const balanceOf = (invoice: Pick<InvoiceRow, 'total' | 'paid_amount' | 'credited_amount'>) => Decimal.max(D(invoice.total).sub(invoice.paid_amount).sub(invoice.credited_amount), 0)

export function invoiceSummary(invoice: InvoiceRow) {
  return {
    invoice_id: invoice.id, number: invoice.number, customer_id: invoice.customer_id, order_id: invoice.order_id, status: invoice.status, currency: invoice.currency,
    subtotal: invoice.subtotal, discount: invoice.discount, tax: invoice.tax, total: invoice.total, paid_amount: invoice.paid_amount,
    credited_amount: invoice.credited_amount, balance: money(balanceOf(invoice)), due_date: invoice.due_date,
  }
}

export async function listInvoices(customerId: string) {
  return (await query<InvoiceRow>(`${INVOICE_SELECT} WHERE i.customer_id = $1 ORDER BY i.created_at DESC`, [customerId])).map(invoiceSummary)
}

export async function invoiceDetail(invoiceId: string, customerId: string) {
  const invoice = await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 AND i.customer_id = $2`, [invoiceId, customerId])
  if (!invoice) throw notFound()
  const items = await query(
    `SELECT id AS invoice_item_id, product_type, name, description, resource_id, billing_cycle, quantity, unit_price, discount, tax, total, pricing_snapshot, configuration_snapshot
       FROM billing_invoice_item WHERE invoice_id = $1 ORDER BY created_at`,
    [invoice.id],
  )
  return { invoice: invoiceSummary(invoice), items, issued_at: invoice.issued_at, paid_at: invoice.paid_at, cancelled_at: invoice.cancelled_at, payment_terms: invoice.payment_terms, notes: invoice.notes }
}

// --- Invoice creation (InvoiceService.create_from_order) ---

export async function createInvoiceFromOrder(db: Queryable, orderId: string, issue = true) {
  const existing = await queryOne<{ id: string; number: string; status: string }>('SELECT id, number, status FROM billing_invoice WHERE order_id = $1', [orderId], db)
  if (existing) return { invoice_id: existing.id, invoice_number: existing.number, status: existing.status }
  const order = (await queryOne<{ id: string; customer_id: string; currency: string; notes: string; subtotal: string; discount: string; tax: string; total: string }>(
    'SELECT id, customer_id, currency, notes, subtotal, discount, tax, total FROM orders_order WHERE id = $1',
    [orderId],
    db,
  ))!
  const currency = await queryOne<{ id: number }>('SELECT id FROM currencies_currency WHERE code = $1 AND is_active', [order.currency], db)
  if (!currency) throw new Error('Currency matching query does not exist.')
  const items = await query<{ product_type: string; resource_id: string; name: string; description: string; billing_cycle: string; quantity: number; unit_price: string; discount: string; tax: string; pricing_snapshot: unknown; configuration: unknown }>(
    'SELECT * FROM orders_order_item WHERE order_id = $1 ORDER BY created_at',
    [orderId],
    db,
  )
  if (!items.length) throw new DetailError('An invoice must contain at least one line item.')
  let subtotal = D(0)
  let discount = D(0)
  let tax = D(0)
  const lines = items.map((item) => {
    if (item.quantity <= 0) throw new DetailError('Invoice item quantity must be greater than zero.')
    const lineSubtotal = D(item.unit_price).mul(item.quantity)
    const lineTotal = lineSubtotal.sub(item.discount).add(item.tax)
    if (lineTotal.isNegative()) throw new DetailError('Invoice item total cannot be negative.')
    subtotal = subtotal.add(lineSubtotal)
    discount = discount.add(item.discount)
    tax = tax.add(item.tax)
    return { item, total: lineTotal }
  })
  const total = subtotal.sub(discount).add(tax)
  if (!subtotal.eq(order.subtotal) || !discount.eq(order.discount) || !tax.eq(order.tax) || !total.eq(order.total)) throw new Error('Invoice totals do not match the order totals.')
  const invoiceId = randomUUID()
  const number = await nextInvoiceNumber(db)
  await db.query(
    `INSERT INTO billing_invoice (id, number, status, subtotal, discount, tax, total, paid_amount, credited_amount, payment_terms, notes, issued_at, due_date, paid_at, cancelled_at,
       created_at, updated_at, currency_id, customer_id, issued_by_id, order_id)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, 0, 0, 0, $7, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $8, $9, NULL, $10)`,
    [invoiceId, number, money(subtotal), money(discount), money(tax), money(total), order.notes, currency.id, order.customer_id, order.id],
  )
  for (const { item, total: lineTotal } of lines)
    await db.query(
      `INSERT INTO billing_invoice_item (id, product_type, resource_id, name, description, billing_cycle, quantity, unit_price, discount, tax, total, pricing_snapshot, configuration_snapshot, created_at, invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, clock_timestamp(), $14)`,
      [randomUUID(), item.product_type, item.resource_id, item.name, item.description, item.billing_cycle, item.quantity, item.unit_price, item.discount, item.tax, money(lineTotal), JSON.stringify(item.pricing_snapshot ?? {}), JSON.stringify(item.configuration ?? {}), invoiceId],
    )
  if (issue) await transitionInvoice(db, invoiceId, 'issued')
  const status = issue ? 'issued' : 'draft'
  return { invoice_id: invoiceId, invoice_number: number, status }
}

async function nextInvoiceNumber(db: Queryable) {
  for (;;) {
    const number = `INV-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    if (!(await queryOne('SELECT 1 FROM billing_invoice WHERE number = $1', [number], db))) return number
  }
}

const INVOICE_TRANSITIONS: Record<string, string[]> = {
  draft: ['issued', 'cancelled'], issued: ['partially_paid', 'paid', 'overdue', 'cancelled'], partially_paid: ['paid', 'overdue', 'cancelled'],
  overdue: ['partially_paid', 'paid', 'cancelled'], paid: ['refunded'], cancelled: [], refunded: [],
}

export async function transitionInvoice(db: Queryable, invoiceId: string, target: string) {
  const invoice = (await queryOne<{ status: string }>('SELECT status FROM billing_invoice WHERE id = $1 FOR UPDATE', [invoiceId], db))!
  if (invoice.status === target) return
  if (!(INVOICE_TRANSITIONS[invoice.status] ?? []).includes(target)) throw new Error(`Invalid invoice transition: ${invoice.status} -> ${target}`)
  await db.query(
    `UPDATE billing_invoice SET status = $2::text, issued_at = CASE WHEN $2::text = 'issued' THEN COALESCE(issued_at, CURRENT_TIMESTAMP) ELSE issued_at END,
       paid_at = CASE WHEN $2::text = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END, cancelled_at = CASE WHEN $2::text = 'cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
       updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [invoiceId, target],
  )
}

// --- Settlement (InvoiceSettlementService) ---

async function synchronizeInvoice(db: Queryable, invoice: InvoiceRow, allowRefunded = false) {
  const balance = D(invoice.total).sub(invoice.paid_amount).sub(invoice.credited_amount)
  if (balance.isNegative()) throw new DetailError('Invoice balance cannot be negative.')
  let target: string
  if (D(invoice.total).isZero() || D(invoice.paid_amount).gte(invoice.total) || balance.lte(0)) target = 'paid'
  else if (D(invoice.paid_amount).gt(0)) target = 'partially_paid'
  else if (invoice.status === 'draft') target = 'draft'
  else target = 'issued'
  if (allowRefunded && D(invoice.paid_amount).isZero() && D(invoice.credited_amount).isZero()) target = 'refunded'
  await db.query(
    `UPDATE billing_invoice SET paid_amount = $2, credited_amount = $3, status = $4::text, paid_at = CASE WHEN $4::text = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE NULL END,
       updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [invoice.id, money(invoice.paid_amount), money(invoice.credited_amount), target],
  )
  if (target === 'paid' && invoice.status !== 'paid')
    dispatchOnCommit(db, 'billing.invoice.paid', { invoice_id: invoice.id, order_id: invoice.order_id, customer_id: invoice.customer_id, amount: invoice.total, currency: invoice.currency })
  return target
}

async function applyPayment(db: Queryable, payment: { invoice_id: string; amount: string; currency_id: number; status: string }) {
  if (payment.status !== 'completed') throw new DetailError('Only completed payments can be applied to an invoice.')
  const invoice = (await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [payment.invoice_id], db))!
  if (payment.currency_id !== invoice.currency_id) throw new DetailError('Payment currency does not match the invoice currency.')
  const paid = D(invoice.paid_amount).add(payment.amount)
  if (paid.gt(invoice.total)) throw new DetailError('Payment would exceed the invoice total.')
  invoice.paid_amount = money(paid)
  return { invoice, status: await synchronizeInvoice(db, invoice) }
}

// --- Order hand-off; registered by the orders module to avoid a circular import ---

let markOrderPaid: ((db: Queryable, orderId: string) => Promise<void>) | null = null
export function onInvoiceSettled(handler: (db: Queryable, orderId: string) => Promise<void>) {
  markOrderPaid = handler
}

/** PaymentRecordingService.record_transaction */
async function recordTransaction(db: Queryable, transactionId: string) {
  const record = (await queryOne<{ id: string; status: string; payment_id: string | null; invoice_id: string; processor_id: string; amount: string; currency_id: number; provider_reference: string; provider_receipt: string; payload: unknown; provider: string }>(
    `SELECT t.*, g.provider FROM billing_payment_transactions t JOIN billing_payment_gateway g ON g.id = t.processor_id WHERE t.id = $1 FOR UPDATE OF t`,
    [transactionId],
    db,
  ))!
  if (record.status !== 'completed') throw new Error('Only completed payment transactions can be recorded as payments.')
  if (record.payment_id) return record.payment_id
  const method = ({ mpesa: 'mpesa', card: 'card', paystack: 'card', manual: 'manual' } as Record<string, string>)[record.provider.toLowerCase()] ?? 'manual'
  const paymentId = randomUUID()
  await db.query(
    `INSERT INTO billing_payment (id, status, method, amount, provider_reference, customer_reference, provider_response, processed_at, created_at, updated_at, currency_id, invoice_id, gateway_id)
     VALUES ($1, 'completed', $2, $3, $4, '', $5, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6, $7, $8)`,
    [paymentId, method, record.amount, record.provider_receipt || record.provider_reference, JSON.stringify(record.payload ?? {}), record.currency_id, record.invoice_id, record.processor_id],
  )
  await db.query('UPDATE billing_payment_transactions SET payment_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [record.id, paymentId])
  const { invoice, status } = await applyPayment(db, { invoice_id: record.invoice_id, amount: record.amount, currency_id: record.currency_id, status: 'completed' })
  const order = (await queryOne<{ status: string }>('SELECT status FROM orders_order WHERE id = $1', [invoice.order_id], db))!
  if (status === 'paid' && order.status === 'pending_payment' && markOrderPaid) await markOrderPaid(db, invoice.order_id)
  dispatchOnCommit(db, 'billing.payment.completed', {
    payment_id: paymentId, transaction_id: record.id, invoice_id: invoice.id, order_id: invoice.order_id, amount: record.amount, currency: invoice.currency, customer_id: invoice.customer_id,
  })
  return paymentId
}

// --- Payment transactions ---

const TRANSACTION_TRANSITIONS: Record<string, TransactionStatus[]> = {
  pending: ['authorized', 'completed', 'failed', 'cancelled', 'expired'], authorized: ['completed', 'failed', 'cancelled', 'expired'],
  completed: [], failed: [], cancelled: [], expired: [],
}
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired'])

type TransactionRow = { id: string; invoice_id: string; processor_id: string; amount: string; currency_id: number; currency: string; status: string; provider_reference: string; provider_receipt: string; payload: Record<string, unknown>; payment_id: string | null; idempotency_key: string }

const TRANSACTION_SELECT = `SELECT t.*, c.code AS currency FROM billing_payment_transactions t JOIN currencies_currency c ON c.id = t.currency_id`

async function updateTransaction(db: Queryable, record: TransactionRow, status: TransactionStatus, payload?: Record<string, unknown>, reference?: string | null, receipt?: string | null) {
  if (record.status !== status && !(TRANSACTION_TRANSITIONS[record.status] ?? []).includes(status)) throw new Error(`Invalid payment transaction transition: ${record.status} -> ${status}`)
  await db.query(
    `UPDATE billing_payment_transactions SET status = $2, provider_reference = COALESCE(NULLIF($3, ''), provider_reference), provider_receipt = COALESCE(NULLIF($4, ''), provider_receipt),
       payload = COALESCE($5, payload), updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [record.id, status, reference ?? '', receipt ?? '', payload === undefined ? null : JSON.stringify(payload)],
  )
  Object.assign(record, { status, ...(reference ? { provider_reference: reference } : {}), ...(payload ? { payload } : {}) })
}

async function recordEvent(db: Queryable, transactionId: string, event: string, providerEventId: string, payload: unknown) {
  await db.query(
    `INSERT INTO billing_payment_transaction_events (id, event, provider_event_id, payload, created_at, transaction_id) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
     ON CONFLICT (transaction_id, event, provider_event_id) WHERE ((provider_event_id)::text > ''::text) DO NOTHING`,
    [randomUUID(), event, providerEventId, JSON.stringify(payload ?? {}), transactionId],
  )
}

function checkAmounts(result: ProviderResult, record: TransactionRow) {
  if (result.amount !== undefined && result.amount !== null && !D(result.amount).eq(record.amount)) throw new BillingValidationError('Provider amount does not match the payment transaction amount.')
  if (result.currency && result.currency.toUpperCase() !== record.currency.toUpperCase()) throw new BillingValidationError('Provider currency does not match the payment transaction currency.')
}

async function gatewayBy(column: 'id' | 'slug', value: string, db: Queryable = database()) {
  return queryOne<Gateway>(`SELECT * FROM billing_payment_gateway WHERE ${column} = $1 AND is_active`, [value], db)
}

const authorizationUrl = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as Record<string, unknown>).data
  if (data && typeof data === 'object') return ((data as Record<string, unknown>).authorization_url as string) ?? null
  return ((payload as Record<string, unknown>).authorization_url as string) ?? null
}

/** PaymentInitiationService.initiate + PaymentProcessingService.process */
export async function initiatePayment(invoiceId: string, customerId: string, input: { gateway_slug: string; phone_number?: string; idempotency_key?: string }) {
  return transaction(async (client) => {
    const invoice = await queryOne<InvoiceRow & { email: string }>(
      `SELECT i.*, c.code AS currency, u.email FROM billing_invoice i JOIN currencies_currency c ON c.id = i.currency_id JOIN accounts_user u ON u.id = i.customer_id
        WHERE i.id = $1 AND i.customer_id = $2 FOR UPDATE OF i`,
      [invoiceId, customerId],
      client,
    )
    if (!invoice) throw notFound()
    const respond = (record: TransactionRow, status = record.status) => ({
      transaction_id: record.id, invoice_id: invoice.id, amount: record.amount, status, provider_reference: record.provider_reference, authorization_url: authorizationUrl(record.payload),
    })
    if (input.idempotency_key) {
      const existing = await queryOne<TransactionRow>(`${TRANSACTION_SELECT} WHERE t.invoice_id = $1 AND t.idempotency_key = $2`, [invoice.id, input.idempotency_key], client)
      if (existing) return respond(existing)
    }
    if (!['issued', 'partially_paid'].includes(invoice.status)) throw new BillingValidationError('Invoice is not payable.')
    const amount = balanceOf(invoice)
    if (amount.lte(0)) throw new BillingValidationError('Invoice has no outstanding balance.')
    const gateway = await gatewayBy('slug', input.gateway_slug, client)
    if (!gateway) throw notFound()
    if (gateway.provider.toLowerCase() === 'mpesa' && invoice.currency.toUpperCase() !== 'KES')
      throw new BillingValidationError('M-Pesa can only be used for KES invoices. Select a card payment method for this USD invoice.')
    let phone = input.phone_number
    if (gateway.provider.toLowerCase() === 'mpesa' && !phone) {
      phone = (await queryOne<{ phone_number: string }>('SELECT phone_number FROM accounts_profile WHERE user_id = $1', [customerId], client))?.phone_number || undefined
      if (!phone) throw new BillingValidationError('A customer phone number is required for M-Pesa payments.')
    }
    const record = (await queryOne<TransactionRow>(
      `INSERT INTO billing_payment_transactions (id, provider_reference, idempotency_key, provider_receipt, amount, status, payload, created_at, updated_at, currency_id, invoice_id, payment_id, processor_id)
       VALUES ($1, $2, $3, '', $4, 'pending', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5, $6, NULL, $7) RETURNING *, (SELECT code FROM currencies_currency WHERE id = $5) AS currency`,
      [randomUUID(), `MV${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`, input.idempotency_key ?? '', money(amount), invoice.currency_id, invoice.id, gateway.id],
      client,
    ))!
    const provider = paymentProvider(gateway)
    let result: ProviderResult
    try {
      result = await provider.authorize({
        transaction_id: record.id, provider_reference: record.provider_reference, amount: record.amount, currency: invoice.currency, gateway_slug: gateway.slug,
        ...(phone ? { phone_number: phone } : {}), email: invoice.email,
      })
    } catch (error) {
      if (!(error instanceof PaymentProviderError)) throw error
      const payload = { provider_outcome: error.ambiguous ? 'unknown' : 'rejected', error_type: error.constructor.name, error: error.message }
      await recordEvent(client, record.id, 'error', `authorization-error:${record.id}`, payload)
      const status: TransactionStatus = error.ambiguous ? 'pending' : 'failed'
      await updateTransaction(client, record, status, payload)
      return respond(record, status)
    }
    checkAmounts(result, record)
    await recordEvent(client, record.id, 'authorization', result.providerEventId || result.providerReference || record.provider_reference, result.rawResponse)
    await updateTransaction(client, record, result.status, result.rawResponse, result.providerReference || null, result.providerReceipt)
    if (result.successful && result.status === 'completed') await recordTransaction(client, record.id)
    return { ...respond(record, result.status), authorization_url: authorizationUrl(result.rawResponse) }
  })
}

/** PaymentVerificationService.verify (customer-owned transactions only). */
export async function verifyPayment(transactionId: string, customerId: string) {
  return transaction(async (client) => {
    const record = await queryOne<TransactionRow & { customer_id: string }>(
      `${TRANSACTION_SELECT} JOIN billing_invoice i ON i.id = t.invoice_id WHERE t.id = $1 FOR UPDATE OF t`.replace('SELECT t.*,', 'SELECT t.*, i.customer_id,'),
      [transactionId],
      client,
    )
    if (!record || record.customer_id !== customerId) throw notFound()
    const reply = (successful: boolean, status = record.status) => ({ successful, status, provider_reference: record.provider_reference })
    if (record.status === 'completed') {
      await recordEvent(client, record.id, 'verification', `verification:${record.provider_reference}`, record.payload)
      return reply(true)
    }
    if (TERMINAL.has(record.status)) return reply(false)
    const gateway = (await queryOne<Gateway>('SELECT * FROM billing_payment_gateway WHERE id = $1', [record.processor_id], client))!
    let result: ProviderResult
    try {
      result = await paymentProvider(gateway).verify(record.provider_reference)
    } catch (error) {
      if (!(error instanceof PaymentProviderError)) throw error
      await recordEvent(client, record.id, 'error', `verification-error:${record.id}`, { provider_outcome: 'unknown', operation: 'verification', error_type: error.constructor.name, error: error.message })
      return reply(false)
    }
    checkAmounts(result, record)
    await recordEvent(client, record.id, 'verification', result.providerEventId || result.providerReference, result.rawResponse)
    await updateTransaction(client, record, result.status, result.rawResponse, result.providerReference || null, result.providerReceipt)
    if (result.successful && result.status === 'completed') await recordTransaction(client, record.id)
    return { successful: result.successful, status: result.status, provider_reference: result.providerReference }
  })
}

/** PaymentWebhookService.process */
export async function processWebhook(gatewaySlug: string, payload: unknown, headers: Record<string, string>, rawBody: Buffer) {
  const gateway = await gatewayBy('slug', gatewaySlug)
  if (!gateway) throw notFound()
  const provider = paymentProvider(gateway)
  const result = await provider.webhook({ payload, headers, rawBody })
  if (!result.providerReference) throw new BillingValidationError('Payment provider callback does not contain a transaction reference.')
  const found = await queryOne<TransactionRow>(`${TRANSACTION_SELECT} WHERE t.processor_id = $1 AND t.provider_reference = $2`, [gateway.id, result.providerReference])
  if (!found) throw new BillingValidationError(`No payment transaction exists for provider reference '${result.providerReference}'.`)
  const isMpesa = gateway.provider.toLowerCase() === 'mpesa'
  if (result.successful && isMpesa && !TERMINAL.has(found.status)) {
    // M-Pesa callbacks are unsigned, so success is confirmed with an STK query before it is applied.
    const verified = await provider.verify(result.providerReference)
    if (!verified.successful || verified.status !== 'completed' || verified.providerReference !== result.providerReference)
      throw new BillingValidationError('M-Pesa callback could not be independently verified.')
  }
  return transaction(async (client) => {
    const record = (await queryOne<TransactionRow>(`${TRANSACTION_SELECT} WHERE t.id = $1 FOR UPDATE OF t`, [found.id], client))!
    checkAmounts(result, record)
    if (result.successful && (result.amount === undefined || result.amount === null)) throw new BillingValidationError('A successful provider callback must include the settled amount.')
    if (result.successful && !result.providerReceipt && isMpesa) throw new BillingValidationError('A successful M-Pesa callback must include the M-Pesa receipt number.')
    await recordEvent(client, record.id, 'webhook', result.providerEventId || result.providerReference, result.rawResponse)
    const reply = { successful: result.successful, status: result.status, provider_reference: result.providerReference, transaction_id: record.id }
    if (TERMINAL.has(record.status)) return reply
    await updateTransaction(client, record, result.status, result.rawResponse, result.providerReference || null, result.providerReceipt)
    if (result.successful && result.status === 'completed') await recordTransaction(client, record.id)
    return reply
  })
}

// --- M-Pesa C2B reconciliation (PaymentReconciliationService.reconcile_mpesa_c2b) ---

async function gatewayCredential(db: Queryable, gatewayId: string, key: string) {
  const row = await queryOne<{ value: string }>('SELECT value FROM billing_payment_gateway_credential WHERE gateway_id = $1 AND key = $2', [gatewayId, key], db)
  return row?.value ? decryptProviderSecret(row.value) : ''
}

/**
 * Safaricom C2B confirmations are unsigned. v1 applied any POSTed payload as a completed payment, so anyone could mark
 * an invoice paid. Confirmations must now carry the gateway's `reconciliation_token` credential, registered with
 * Safaricom as part of the ConfirmationURL (`?token=...`); without a configured token the endpoint refuses everything.
 */
export async function authorizeReconciliation(gatewaySlug: string, token: string | null) {
  const gateway = await gatewayBy('slug', gatewaySlug)
  if (!gateway) throw notFound()
  const expected = await gatewayCredential(database(), gateway.id, 'reconciliation_token')
  const provided = Buffer.from(token ?? '')
  if (!expected || provided.length !== Buffer.byteLength(expected) || !timingSafeEqual(provided, Buffer.from(expected))) throw new HttpError(403, { detail: 'You do not have permission to perform this action.' })
  return gateway
}

export async function reconcileMpesaC2B(gateway: Gateway, payload: Record<string, unknown>) {
  if (gateway.provider.toLowerCase() !== 'mpesa') throw new BillingValidationError('The reconciliation gateway is not configured for M-Pesa.')
  const externalReference = String(payload.TransID ?? '').trim()
  const accountReference = String(payload.BillRefNumber ?? '').trim()
  let amount: Decimal
  try {
    amount = D(String(payload.TransAmount || '0'))
  } catch {
    throw new BillingValidationError('M-Pesa reconciliation amount is invalid.')
  }
  const phone = String(payload.MSISDN ?? '').trim()
  if (!externalReference) throw new BillingValidationError('M-Pesa reconciliation payload has no TransID.')
  if (!accountReference) throw new BillingValidationError('M-Pesa reconciliation payload has no BillRefNumber.')
  if (amount.lte(0)) throw new BillingValidationError('M-Pesa reconciliation amount must be positive.')
  return transaction(async (client) => {
    const shortcode = await gatewayCredential(client, gateway.id, 'shortcode')
    const reported = String(payload.BusinessShortCode ?? '').trim()
    if (shortcode && reported && shortcode !== reported) throw new BillingValidationError('M-Pesa business short code does not match the configured gateway.')
    type Rec = { id: string; status: string; external_reference: string }
    let reconciliation = await queryOne<Rec>('SELECT id, status, external_reference FROM billing_payment_reconciliation WHERE gateway_id = $1 AND external_reference = $2 FOR UPDATE', [gateway.id, externalReference], client)
    if (reconciliation) return reconciliation
    const kes = (await queryOne<{ id: number }>(`SELECT id FROM currencies_currency WHERE code = 'KES' AND is_active`, [], client))!
    const invoice = await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.number = $1 FOR UPDATE OF i`, [accountReference], client)
    const insert = (status: string, reason: string, invoiceId: string | null, currencyId: number) =>
      queryOne<Rec>(
        `INSERT INTO billing_payment_reconciliation (id, external_reference, account_reference, phone_number, amount, status, payload, rejection_reason, received_at, reconciled_at,
           created_at, updated_at, currency_id, gateway_id, invoice_id, transaction_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $9, $10, $11, NULL) RETURNING id, status, external_reference`,
        [randomUUID(), externalReference, accountReference, phone, money(amount), status, JSON.stringify(payload), reason, currencyId, gateway.id, invoiceId],
        client,
      ).then((row) => row!)
    if (!invoice) return insert('rejected', 'No invoice matches the supplied BillRefNumber.', null, kes.id)
    if (invoice.currency !== 'KES') throw new BillingValidationError('M-Pesa reconciliation is only supported for KES invoices.')
    if (amount.gt(balanceOf(invoice))) return insert('rejected', 'Payment exceeds the outstanding invoice balance.', invoice.id, invoice.currency_id)
    reconciliation = await insert('pending', '', invoice.id, invoice.currency_id)
    const existing = await queryOne<TransactionRow>(`${TRANSACTION_SELECT} WHERE t.processor_id = $1 AND t.provider_reference = $2 FOR UPDATE OF t`, [gateway.id, externalReference], client)
    let transactionId: string
    if (existing) {
      if (existing.invoice_id !== invoice.id || !D(existing.amount).eq(amount) || existing.currency_id !== invoice.currency_id) {
        await client.query(`UPDATE billing_payment_reconciliation SET status = 'rejected', rejection_reason = 'Provider reference already exists with conflicting payment details.', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [reconciliation.id])
        return { ...reconciliation, status: 'rejected' }
      }
      if (existing.status !== 'completed') throw new BillingValidationError('Provider reference already exists with a non-completed payment transaction.')
      transactionId = existing.id
    } else {
      transactionId = randomUUID()
      await client.query(
        `INSERT INTO billing_payment_transactions (id, provider_reference, idempotency_key, provider_receipt, amount, status, payload, created_at, updated_at, currency_id, invoice_id, payment_id, processor_id)
         VALUES ($1, $2, '', '', $3, 'completed', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5, $6, NULL, $7)`,
        [transactionId, externalReference, money(amount), JSON.stringify(payload), invoice.currency_id, invoice.id, gateway.id],
      )
    }
    await client.query(`UPDATE billing_payment_reconciliation SET transaction_id = $2, status = 'matched', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [reconciliation.id, transactionId])
    await recordEvent(client, transactionId, 'reconciliation', externalReference, payload)
    await recordTransaction(client, transactionId)
    await client.query(`UPDATE billing_payment_reconciliation SET status = 'applied', reconciled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [reconciliation.id])
    return { ...reconciliation, status: 'applied' }
  })
}

// --- Staff-confirmed payments (PaymentCreateService; replaces the Django admin action) ---

export async function recordManualPayment(input: { invoiceId: string; amount: string; method: string; gatewayId?: string | null; providerReference?: string; customerReference?: string }) {
  return transaction(async (client) => {
    const invoice = await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [input.invoiceId], client)
    if (!invoice) throw notFound()
    if (!['issued', 'partially_paid'].includes(invoice.status)) throw new BillingValidationError('Invoice is not payable.')
    if (!['mpesa', 'card', 'bank_transfer', 'manual'].includes(input.method)) throw new BillingValidationError('Unsupported payment method.')
    if (input.gatewayId && !(await queryOne('SELECT 1 FROM billing_payment_gateway WHERE id = $1 AND is_active', [input.gatewayId], client))) throw notFound()
    const amount = D(input.amount)
    if (amount.lte(0)) throw new BillingValidationError('Payment amount must be greater than zero.')
    if (amount.gt(D(invoice.total).sub(invoice.paid_amount))) throw new BillingValidationError('Payment amount cannot exceed the remaining invoice balance.')
    const paymentId = randomUUID()
    await client.query(
      `INSERT INTO billing_payment (id, status, method, amount, provider_reference, customer_reference, provider_response, processed_at, created_at, updated_at, currency_id, invoice_id, gateway_id)
       VALUES ($1, 'completed', $2, $3, $4, $5, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6, $7, $8)`,
      [paymentId, input.method, money(amount), input.providerReference ?? '', input.customerReference ?? '', invoice.currency_id, invoice.id, input.gatewayId ?? null],
    )
    const { status } = await applyPayment(client, { invoice_id: invoice.id, amount: money(amount), currency_id: invoice.currency_id, status: 'completed' })
    const order = (await queryOne<{ status: string }>('SELECT status FROM orders_order WHERE id = $1', [invoice.order_id], client))!
    if (status === 'paid' && order.status === 'pending_payment' && markOrderPaid) await markOrderPaid(client, invoice.order_id)
    return { payment_id: paymentId, invoice_id: invoice.id, amount: money(amount), status: 'completed' }
  })
}

// --- Payments and gateways (queries) ---

export async function listPayments(customerId: string) {
  return query(
    `SELECT p.id AS payment_id, p.invoice_id, p.amount, c.code AS currency, p.status, p.method, p.provider_reference, p.created_at
       FROM billing_payment p JOIN billing_invoice i ON i.id = p.invoice_id JOIN currencies_currency c ON c.id = p.currency_id
      WHERE i.customer_id = $1 ORDER BY p.created_at DESC`,
    [customerId],
  )
}

export async function paymentDetail(paymentId: string, customerId: string) {
  const payment = await queryOne<{ payment_id: string; invoice_id: string; amount: string; currency: string; status: string; method: string; provider_reference: string; created_at: Date; gateway_id: string | null; customer_reference: string; processed_at: Date | null }>(
    `SELECT p.id AS payment_id, p.invoice_id, p.amount, c.code AS currency, p.status, p.method, p.provider_reference, p.created_at, p.gateway_id, p.customer_reference, p.processed_at
       FROM billing_payment p JOIN billing_invoice i ON i.id = p.invoice_id JOIN currencies_currency c ON c.id = p.currency_id WHERE p.id = $1 AND i.customer_id = $2`,
    [paymentId, customerId],
  )
  if (!payment) throw notFound()
  const { gateway_id, customer_reference, processed_at, ...summary } = payment
  return { payment: summary, gateway_id, customer_reference, processed_at }
}

export async function listGateways() {
  return query('SELECT slug, name, provider, sandbox, is_default, paybill_number, manual_payment_instructions FROM billing_payment_gateway WHERE is_active ORDER BY name')
}
