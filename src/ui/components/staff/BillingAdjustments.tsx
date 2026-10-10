import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { ApiError, createCreditNote, createRefund, getInvoiceAdjustments, transitionCreditNote, transitionRefund, type StaffCreditNote, type StaffRefund } from '../../lib/api'
import { useAuth } from '../../lib/auth'

/** Staff refunds and credit notes (replaces the Django admin actions). Every action is recorded in the audit log. */

const money = (value: string, currency: string) => {
  const amount = Number(value)
  return Number.isFinite(amount) ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount) : `${currency} ${value}`
}
const errorText = (error: unknown, fallback: string) => {
  if (!(error instanceof ApiError)) return fallback
  return Object.values(error.fieldErrors ?? {}).flat()[0] || error.message || fallback
}

function AmountReasonForm({ label, submitLabel, onSubmit }: { label: string; submitLabel: string; onSubmit: (input: { amount: string; reason: string }) => Promise<void> }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setWorking(true); setError('')
    try { await onSubmit({ amount, reason }); setAmount(''); setReason('') }
    catch (err) { setError(errorText(err, 'The request could not be completed.')) }
    finally { setWorking(false) }
  }
  return <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
    <label className="text-sm font-semibold text-slate-700">{label}<input required inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" value={amount} onChange={(e) => setAmount(e.target.value)} className="field mt-1.5" placeholder="0.00" /></label>
    <label className="text-sm font-semibold text-slate-700">Reason<input required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} className="field mt-1.5" /></label>
    <button type="submit" disabled={working} className="btn btn-primary">{working ? <Loader2 className="size-4 animate-spin" /> : null}{submitLabel}</button>
    {error && <p role="alert" className="text-sm font-semibold text-red-700 sm:col-span-3">{error}</p>}
  </form>
}

/** Credit notes and refunds on an invoice, with their workflow actions. */
export function InvoiceAdjustmentsPanel({ customerId, invoiceId, currency, onChanged }: { customerId: string; invoiceId: string; currency: string; onChanged: () => void }) {
  const { hasPermission } = useAuth()
  const canCredit = hasPermission('create_invoice')
  const canRefund = hasPermission('issue_refund') && hasPermission('view_payment')
  const [data, setData] = useState<{ refunds: StaffRefund[]; credit_notes: StaffCreditNote[] } | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(() => { getInvoiceAdjustments(customerId, invoiceId).then(setData).catch((err) => setError(errorText(err, 'Unable to load adjustments.'))) }, [customerId, invoiceId])
  useEffect(load, [load])

  async function act(key: string, run: () => Promise<unknown>) {
    setWorking(key); setError('')
    try { await run(); load(); onChanged() }
    catch (err) { setError(errorText(err, 'The action could not be completed.')) }
    finally { setWorking(null) }
  }
  const completeRefund = (refund: StaffRefund) => {
    const reference = window.prompt('Payout reference (bank or M-Pesa transaction) for this refund:')
    if (reference?.trim()) void act(refund.refund_id, () => transitionRefund(customerId, refund.refund_id, 'complete', reference.trim()))
  }
  const button = 'rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-maven-blue hover:bg-slate-50 disabled:opacity-50'

  return <article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
    <h2 className="font-black text-maven-navy">Credit notes and refunds</h2>
    <p className="mt-1 text-sm text-slate-500">Applying a credit note reduces the balance; completing a refund records a payout made outside the platform and reduces the amount paid.</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
    {!data ? <Loader2 className="mt-5 size-5 animate-spin text-maven-blue" /> : <div className="mt-5 space-y-6">
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Credit notes</h3>
        {data.credit_notes.length === 0 ? <p className="mt-2 text-sm text-slate-500">No credit notes.</p> : <ul className="mt-2 divide-y divide-slate-100">{data.credit_notes.map((note) => <li key={note.credit_note_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><p className="font-bold text-maven-navy">{money(note.amount, currency)} · <span className="capitalize">{note.status}</span></p><p className="text-xs text-slate-500">{note.reason}</p></div>
          {canCredit && <div className="flex gap-2">
            {note.status === 'draft' && <button type="button" className={button} disabled={working !== null} onClick={() => act(note.credit_note_id, () => transitionCreditNote(customerId, note.credit_note_id, 'issue'))}>Issue</button>}
            {note.status === 'issued' && <button type="button" className={button} disabled={working !== null} onClick={() => act(note.credit_note_id, () => transitionCreditNote(customerId, note.credit_note_id, 'apply'))}>Apply to invoice</button>}
            {(note.status === 'draft' || note.status === 'issued') && <button type="button" className={button} disabled={working !== null} onClick={() => act(note.credit_note_id, () => transitionCreditNote(customerId, note.credit_note_id, 'cancel'))}>Cancel</button>}
          </div>}
        </li>)}</ul>}
        {canCredit && <AmountReasonForm label={`Credit amount (${currency})`} submitLabel="Draft credit note" onSubmit={async (input) => { await createCreditNote(customerId, invoiceId, input); load() }} />}
      </section>
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Refunds</h3>
        {data.refunds.length === 0 ? <p className="mt-2 text-sm text-slate-500">No refunds. Start a refund from the payment.</p> : <ul className="mt-2 divide-y divide-slate-100">{data.refunds.map((refund) => <li key={refund.refund_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><p className="font-bold text-maven-navy">{money(refund.amount, currency)} · <span className="capitalize">{refund.status}</span></p><p className="text-xs text-slate-500">{refund.reason}{refund.provider_reference ? ` · ${refund.provider_reference}` : ''}</p></div>
          {canRefund && ['pending', 'processing', 'failed'].includes(refund.status) && <div className="flex gap-2">
            {refund.status !== 'failed' && <button type="button" className={button} disabled={working !== null} onClick={() => completeRefund(refund)}>Record payout</button>}
            {refund.status !== 'failed' && <button type="button" className={button} disabled={working !== null} onClick={() => act(refund.refund_id, () => transitionRefund(customerId, refund.refund_id, 'fail'))}>Mark failed</button>}
            {refund.status === 'failed' && <button type="button" className={button} disabled={working !== null} onClick={() => act(refund.refund_id, () => transitionRefund(customerId, refund.refund_id, 'process'))}>Retry</button>}
            <button type="button" className={button} disabled={working !== null} onClick={() => act(refund.refund_id, () => transitionRefund(customerId, refund.refund_id, 'cancel'))}>Cancel</button>
          </div>}
        </li>)}</ul>}
      </section>
    </div>}
  </article>
}

/** Starts a refund against a completed payment (payout recorded later from the invoice). */
export function PaymentRefundForm({ customerId, paymentId, currency, status }: { customerId: string; paymentId: string; currency: string; status: string }) {
  const { hasPermission } = useAuth()
  const [notice, setNotice] = useState('')
  if (!hasPermission('issue_refund') || status !== 'completed') return null
  return <article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
    <h2 className="font-black text-maven-navy">Refund this payment</h2>
    <p className="mt-1 text-sm text-slate-500">Creates a pending refund. Pay it out by bank transfer or M-Pesa, then record the payout reference on the invoice.</p>
    <AmountReasonForm label={`Refund amount (${currency})`} submitLabel="Create refund" onSubmit={async (input) => { const refund = await createRefund(customerId, paymentId, input); setNotice(`Refund of ${money(refund.amount, currency)} created and pending payout.`) }} />
    {notice && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{notice}</p>}
  </article>
}
