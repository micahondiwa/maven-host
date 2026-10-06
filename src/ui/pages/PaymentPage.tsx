import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from '@/lib/navigation'
import { CheckCircle2, LoaderCircle, Smartphone } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import {
  ApiError,
  initiateInvoicePayment,
  listInvoices,
  listPaymentGateways,
  verifyPaymentTransaction,
  type InvoiceSummary,
  type PaymentGateway,
} from '../lib/api'
import { useCart } from '../lib/cart'
import { SEO } from '../components/SEO'

type Phase = 'loading' | 'ready' | 'pending' | 'success' | 'failed'

export function PaymentPage() {
  const { orderId = '' } = useParams()
  const { refresh: refreshCart } = useCart()
  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null)
  const [gateways, setGateways] = useState<PaymentGateway[]>([])
  const [gatewaySlug, setGatewaySlug] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    Promise.all([listInvoices(), listPaymentGateways()])
      .then(([invoices, gws]) => {
        const found = invoices.find((inv) => inv.order_id === orderId) ?? null
        setInvoice(found)
        setGateways(gws)
        const preferred = gws.find((g) => g.is_default) ?? gws[0]
        if (preferred) setGatewaySlug(preferred.slug)
        setPhase('ready')
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'We could not load this invoice.')
        setPhase('failed')
      })
  }, [orderId])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  function startPolling(txId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const result = await verifyPaymentTransaction(txId)
        if (result.status === 'successful' || result.successful) {
          setPhase('success')
          if (pollRef.current) clearInterval(pollRef.current)
          refreshCart()
        } else if (result.status === 'failed') {
          setPhase('failed')
          setError('The payment was not completed. You can try again below.')
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // transient verification error; keep polling until timeout below
      }
    }, 4000)

    setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current)
      setPhase((current) => (current === 'pending' ? 'failed' : current))
    }, 120000)
  }

  async function pay() {
    if (!invoice || !gatewaySlug) return
    setError('')
    const gateway = gateways.find((g) => g.slug === gatewaySlug)
    if (gateway?.provider === 'mpesa' && !phoneNumber.trim()) {
      setError('Enter the M-Pesa phone number to receive the payment prompt.')
      return
    }
    setPhase('pending')
    try {
      const result = await initiateInvoicePayment(invoice.invoice_id, {
        gateway_slug: gatewaySlug,
        phone_number: gateway?.provider === 'mpesa' ? phoneNumber.trim() : undefined,
      })
      setTransactionId(result.transaction_id)

      if (result.authorization_url) {
        sessionStorage.setItem('mwh_pending_transaction', result.transaction_id)
        window.location.href = result.authorization_url
        return
      }

      if (result.status === 'successful') {
        setPhase('success')
        refreshCart()
        return
      }

      startPolling(result.transaction_id)
    } catch (err) {
      setPhase('failed')
      setError(err instanceof ApiError ? err.message : 'We could not start this payment. Please try again.')
    }
  }

  const selectedGateway = gateways.find((g) => g.slug === gatewaySlug)

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <SEO title="Payment | MavenHost" description="Complete payment for your MavenHost order." path="/payment" indexable={false} />
      <CustomerHeader />
      <main id="main-content" className="container-shell max-w-xl py-14">
        <h1 className="text-[1.9rem] font-semibold tracking-tight text-maven-ink">Complete payment</h1>

        {phase === 'loading' && (
          <div className="mt-10 flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading invoice…</div>
        )}

        {invoice && (phase === 'ready' || phase === 'pending' || phase === 'failed') && (
          <div className="mt-8 panel p-6">
            <div className="flex items-center justify-between border-b border-maven-line pb-5">
              <div>
                <p className="mono text-xs text-maven-muted">{invoice.number}</p>
                <p className="mono mt-1 text-[1.6rem] font-semibold text-maven-ink">{invoice.currency} {invoice.balance}</p>
              </div>
              <span className="status-dot is-pending" />
            </div>

            <div className="mt-5">
              <p className="label">Payment method</p>
              <div className="mt-2 grid gap-2">
                {gateways.map((g) => (
                  <label key={g.slug} className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 text-sm font-semibold ${gatewaySlug === g.slug ? 'border-maven-ink bg-black/5 text-maven-ink' : 'border-maven-line text-maven-muted'}`}>
                    <span>{g.name}{g.sandbox && <span className="mono ml-2 text-[11px] font-normal text-maven-gold">sandbox</span>}</span>
                    <input type="radio" name="gateway" value={g.slug} checked={gatewaySlug === g.slug} onChange={() => setGatewaySlug(g.slug)} />
                  </label>
                ))}
              </div>
            </div>

            {selectedGateway?.provider === 'mpesa' && (
              <div className="mt-4">
                <label htmlFor="phone" className="label">M-Pesa phone number</label>
                <input id="phone" type="tel" autoComplete="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="2547XXXXXXXX" className="field mono mt-1.5" />
              </div>
            )}

            {selectedGateway?.provider === 'manual' && selectedGateway.manual_payment_instructions && (
              <div className="mt-4 rounded-lg bg-black/5 p-4 text-sm text-maven-muted">
                <p className="font-semibold text-maven-ink">Payment instructions</p>
                <p className="mt-1 whitespace-pre-line">{selectedGateway.manual_payment_instructions}</p>
                {selectedGateway.paybill_number && <p className="mono mt-1">Paybill: {selectedGateway.paybill_number}</p>}
              </div>
            )}

            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}

            {phase === 'pending' ? (
              <div className="mt-5 flex items-center gap-3 rounded-lg bg-black/5 px-4 py-3 text-sm font-semibold text-maven-ink">
                <Smartphone className="size-4 shrink-0" />
                {selectedGateway?.provider === 'mpesa' ? 'Check your phone and enter your M-Pesa PIN…' : 'Waiting for payment confirmation…'}
                <LoaderCircle className="ml-auto size-4 animate-spin" />
              </div>
            ) : (
              <button onClick={pay} disabled={!gatewaySlug} className="btn btn-primary mt-5 w-full">
                Pay {invoice.currency} {invoice.balance}
              </button>
            )}

            {transactionId && phase === 'failed' && (
              <p className="mono mt-3 text-center text-xs text-maven-muted">ref: {transactionId}</p>
            )}
          </div>
        )}

        {phase === 'success' && (
          <div className="mt-10 panel border-emerald-200 bg-emerald-50/60 p-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
            <p className="mt-4 text-[17px] font-semibold text-maven-ink">Payment received</p>
            <p className="mt-1 text-sm text-maven-muted">Payment is recorded. Check the order for setup progress and any next steps; payment confirmation alone does not confirm activation.</p>
            <Link to={`/orders/${orderId}`} className="btn btn-primary mt-6">View order status</Link>
          </div>
        )}

        {!invoice && phase !== 'loading' && phase !== 'success' && (
          <p className="mt-8 text-sm text-maven-muted">
            We could not find an invoice for this order. <Link to={`/orders/${orderId}`} className="font-semibold text-maven-signal">View the order</Link> for details.
          </p>
        )}
      </main>
    <SiteFooter />
      </div>
  )
}
