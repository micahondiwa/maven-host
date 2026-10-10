import 'server-only'
import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { query, queryOne, transaction, type Queryable } from '../db'
import { DetailError, notFound, ValidationError } from '../http/errors'
import { audit } from '../audit/audit'
import { balanceOf, INVOICE_SELECT, synchronizeInvoice, type InvoiceRow } from './service'

/**
 * Refunds and credit notes (apps/billing RefundService, CreditNoteService and their workflows).
 *
 * v1 kept these as admin-only records: a refund marked completed never reduced the invoice's paid amount. Here
 * completing a refund and applying a credit note settle the invoice in the same transaction, and every step is
 * audited. A refund records a payout made outside the platform (bank transfer or M-Pesa reversal); no gateway refund
 * API is called.
 */

const D = (value: Decimal.Value) => new Decimal(value)
const money = (value: Decimal.Value) => D(value).toFixed(2)

const REFUND_TRANSITIONS: Record<string, string[]> = {
  pending: ['processing', 'completed', 'failed', 'cancelled'],
  processing: ['completed', 'failed', 'cancelled'],
  failed: ['processing', 'cancelled'],
  completed: [],
  cancelled: [],
}
const CREDIT_NOTE_TRANSITIONS: Record<string, string[]> = { draft: ['issued', 'cancelled'], issued: ['applied', 'cancelled'], applied: [], cancelled: [] }

type RefundRow = { id: string; status: string; amount: string; reason: string; provider_reference: string; processed_at: Date | null; created_at: Date; updated_at: Date; payment_id: string }
type CreditNoteRow = { id: string; status: string; amount: string; reason: string; issued_at: Date | null; applied_at: Date | null; created_at: Date; updated_at: Date; invoice_id: string }

const refundData = (row: RefundRow) => ({
  refund_id: row.id, payment_id: row.payment_id, amount: row.amount, status: row.status, reason: row.reason, provider_reference: row.provider_reference, processed_at: row.processed_at, created_at: row.created_at,
})
const creditNoteData = (row: CreditNoteRow) => ({
  credit_note_id: row.id, invoice_id: row.invoice_id, amount: row.amount, status: row.status, reason: row.reason, issued_at: row.issued_at, applied_at: row.applied_at, created_at: row.created_at,
})

const record = (db: Queryable, event: string, actorId: string, model: string, id: string, message: string, metadata: Record<string, unknown>) =>
  audit({ event, category: 'billing', performedBy: actorId, target: { appLabel: 'billing', model, id }, message, metadata }, db)

/** Refunds and credit notes on one customer's invoice (staff view). */
export async function invoiceAdjustments(customerId: string, invoiceId: string) {
  if (!(await queryOne('SELECT 1 FROM billing_invoice WHERE id = $1 AND customer_id = $2', [invoiceId, customerId]))) throw notFound('No Invoice matches the given query.')
  const refunds = await query<RefundRow>('SELECT r.* FROM billing_refund r JOIN billing_payment p ON p.id = r.payment_id WHERE p.invoice_id = $1 ORDER BY r.created_at DESC', [invoiceId])
  const creditNotes = await query<CreditNoteRow>('SELECT * FROM billing_credit_note WHERE invoice_id = $1 ORDER BY created_at DESC', [invoiceId])
  return { refunds: refunds.map(refundData), credit_notes: creditNotes.map(creditNoteData) }
}

export async function createRefund(input: { actorId: string; customerId: string; paymentId: string; amount: string; reason: string }) {
  return transaction(async (client) => {
    const payment = await queryOne<{ id: string; amount: string; status: string; invoice_id: string }>(
      'SELECT p.id, p.amount, p.status, p.invoice_id FROM billing_payment p JOIN billing_invoice i ON i.id = p.invoice_id WHERE p.id = $1 AND i.customer_id = $2 FOR UPDATE OF p',
      [input.paymentId, input.customerId],
      client,
    )
    if (!payment) throw notFound('No Payment matches the given query.')
    if (payment.status !== 'completed') throw new DetailError('Only completed payments can be refunded.')
    // Pending and in-flight refunds count against the payment, so concurrent requests cannot exceed it.
    const committed = (await queryOne<{ total: string }>(
      `SELECT COALESCE(sum(amount), 0)::text AS total FROM billing_refund WHERE payment_id = $1 AND status IN ('pending', 'processing', 'completed')`,
      [payment.id],
      client,
    ))!.total
    if (D(input.amount).gt(D(payment.amount).sub(committed))) throw new DetailError('Refund amount exceeds the remaining refundable amount.')
    const refund = (await queryOne<RefundRow>(
      `INSERT INTO billing_refund (id, status, amount, reason, provider_reference, provider_response, processed_at, created_at, updated_at, payment_id)
       VALUES ($1, 'pending', $2, $3, '', '{}', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4) RETURNING *`,
      [randomUUID(), money(input.amount), input.reason, payment.id],
      client,
    ))!
    await record(client, 'refund_requested', input.actorId, 'refund', refund.id, `Refund of ${refund.amount} requested.`, { payment_id: payment.id, invoice_id: payment.invoice_id, reason: input.reason })
    return refundData(refund)
  })
}

/** Moves a refund through its workflow; `completed` reduces the invoice's paid amount. */
export async function transitionRefund(input: { actorId: string; customerId: string; refundId: string; target: 'processing' | 'completed' | 'failed' | 'cancelled'; providerReference?: string }) {
  return transaction(async (client) => {
    const refund = await queryOne<RefundRow & { invoice_id: string }>(
      `SELECT r.*, p.invoice_id FROM billing_refund r JOIN billing_payment p ON p.id = r.payment_id JOIN billing_invoice i ON i.id = p.invoice_id
        WHERE r.id = $1 AND i.customer_id = $2 FOR UPDATE OF r`,
      [input.refundId, input.customerId],
      client,
    )
    if (!refund) throw notFound('No Refund matches the given query.')
    if (refund.status === input.target) return refundData(refund)
    if (!(REFUND_TRANSITIONS[refund.status] ?? []).includes(input.target)) throw new DetailError(`Invalid refund transition: ${refund.status} -> ${input.target}`)
    if (input.target === 'completed') {
      if (!input.providerReference) throw new ValidationError({ provider_reference: ['Record the payout reference (bank or M-Pesa transaction) to complete a refund.'] })
      const invoice = (await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [refund.invoice_id], client))!
      if (D(refund.amount).gt(invoice.paid_amount)) throw new DetailError('Refund cannot exceed the amount currently paid on the invoice.')
      invoice.paid_amount = money(D(invoice.paid_amount).sub(refund.amount))
      await synchronizeInvoice(client, invoice, true)
    }
    const updated = (await queryOne<RefundRow>(
      `UPDATE billing_refund SET status = $2::text, provider_reference = COALESCE($3::text, provider_reference),
         processed_at = CASE WHEN $2::text = 'completed' THEN COALESCE(processed_at, CURRENT_TIMESTAMP) ELSE processed_at END, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [refund.id, input.target, input.providerReference ?? null],
      client,
    ))!
    await record(client, input.target === 'completed' ? 'payment_refunded' : `refund_${input.target}`, input.actorId, 'refund', refund.id, `Refund ${input.target}.`, {
      previous_status: refund.status, invoice_id: refund.invoice_id, provider_reference: updated.provider_reference,
    })
    return refundData(updated)
  })
}

export async function createCreditNote(input: { actorId: string; customerId: string; invoiceId: string; amount: string; reason: string }) {
  return transaction(async (client) => {
    const invoice = await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 AND i.customer_id = $2 FOR UPDATE OF i`, [input.invoiceId, input.customerId], client)
    if (!invoice) throw notFound('No Invoice matches the given query.')
    // Outstanding draft and issued notes count against the balance, so applying them all can never overshoot it.
    const outstanding = (await queryOne<{ total: string }>(`SELECT COALESCE(sum(amount), 0)::text AS total FROM billing_credit_note WHERE invoice_id = $1 AND status IN ('draft', 'issued')`, [invoice.id], client))!.total
    if (D(input.amount).gt(balanceOf(invoice).sub(outstanding))) throw new DetailError('Credit note amount exceeds the invoice balance.')
    const note = (await queryOne<CreditNoteRow>(
      `INSERT INTO billing_credit_note (id, status, amount, reason, issued_at, applied_at, created_at, updated_at, invoice_id)
       VALUES ($1, 'draft', $2, $3, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4) RETURNING *`,
      [randomUUID(), money(input.amount), input.reason, invoice.id],
      client,
    ))!
    await record(client, 'credit_note_created', input.actorId, 'creditnote', note.id, `Credit note of ${note.amount} drafted.`, { invoice_id: invoice.id, reason: input.reason })
    return creditNoteData(note)
  })
}

/** issue / apply / cancel; applying credits the invoice and re-settles it. */
export async function transitionCreditNote(input: { actorId: string; customerId: string; creditNoteId: string; target: 'issued' | 'applied' | 'cancelled' }) {
  return transaction(async (client) => {
    const note = await queryOne<CreditNoteRow>(
      'SELECT n.* FROM billing_credit_note n JOIN billing_invoice i ON i.id = n.invoice_id WHERE n.id = $1 AND i.customer_id = $2 FOR UPDATE OF n',
      [input.creditNoteId, input.customerId],
      client,
    )
    if (!note) throw notFound('No CreditNote matches the given query.')
    if (note.status === input.target) return creditNoteData(note)
    if (!(CREDIT_NOTE_TRANSITIONS[note.status] ?? []).includes(input.target)) throw new DetailError(`Invalid credit note transition: ${note.status} -> ${input.target}`)
    if (input.target === 'applied') {
      const invoice = (await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [note.invoice_id], client))!
      if (D(note.amount).gt(balanceOf(invoice))) throw new DetailError('Credit note exceeds the remaining invoice balance.')
      invoice.credited_amount = money(D(invoice.credited_amount).add(note.amount))
      await synchronizeInvoice(client, invoice)
    }
    const updated = (await queryOne<CreditNoteRow>(
      `UPDATE billing_credit_note SET status = $2::text,
         issued_at = CASE WHEN $2::text = 'issued' THEN COALESCE(issued_at, CURRENT_TIMESTAMP) ELSE issued_at END,
         applied_at = CASE WHEN $2::text = 'applied' THEN COALESCE(applied_at, CURRENT_TIMESTAMP) ELSE applied_at END, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [note.id, input.target],
      client,
    ))!
    await record(client, `credit_note_${input.target}`, input.actorId, 'creditnote', note.id, `Credit note ${input.target}.`, { previous_status: note.status, invoice_id: note.invoice_id })
    return creditNoteData(updated)
  })
}
