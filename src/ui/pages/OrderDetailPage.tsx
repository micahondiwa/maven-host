import { SEO } from '../components/SEO'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@/lib/navigation'
import { ArrowLeft, CreditCard, LoaderCircle, XCircle } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { ApiError, cancelOrder, getOrder, listInvoices, type InvoiceSummary, type OrderDetail } from '../lib/api'

export function OrderDetailPage() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    Promise.all([getOrder(orderId), listInvoices()])
      .then(([order, invoices]) => {
        setDetail(order)
        setInvoice(invoices.find((inv) => inv.order_id === orderId) ?? null)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load this order.'))
      .finally(() => setLoading(false))
  }, [orderId])

  async function handleCancel() {
    setCancelling(true)
    setError('')
    try {
      const updated = await cancelOrder(orderId)
      setDetail(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not cancel this order.')
    } finally {
      setCancelling(false)
    }
  }

  const canPay = invoice && Number(invoice.balance) > 0 && detail?.order.status !== 'cancelled'
  const canCancel = detail && !['completed', 'cancelled'].includes(detail.order.status)

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader /><SEO title="Order details | MavenHost" description="Review your order status, billed items and next steps." path="/account/orders" indexable={false} />
      <main id="main-content" className="container-shell max-w-3xl py-14">
        <Link to="/account/orders" className="inline-flex items-center gap-2 text-sm font-semibold text-maven-signal"><ArrowLeft className="size-4" /> Back to orders</Link>

        {loading && <div className="mt-8 flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading order…</div>}
        {error && <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}

        {detail && (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="mono text-[1.5rem] font-semibold text-maven-ink">{detail.order.number}</h1>
                <p className="mt-1 flex items-center gap-2 text-sm text-maven-muted">
                  <span className={`status-dot ${detail.order.status === 'completed' ? 'is-live' : detail.order.status === 'cancelled' ? 'is-off' : 'is-pending'}`} />
                  {detail.order.status.replace('_', ' ')}
                </p>
              </div>
              <div className="flex gap-2">
                {canPay && (
                  <button onClick={() => navigate(`/orders/${orderId}/pay`)} className="btn btn-primary">
                    <CreditCard className="size-4" /> Pay now
                  </button>
                )}
                {canCancel && (
                  <button onClick={handleCancel} disabled={cancelling} className="btn btn-secondary">
                    {cancelling ? <LoaderCircle className="size-4 animate-spin" /> : <XCircle className="size-4" />} Cancel order
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 panel divide-y divide-maven-line">
              {detail.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-5">
                  <div>
                    <p className="mono text-[11px] font-medium text-maven-muted">{item.product_type}</p>
                    <p className="mt-1 font-semibold text-maven-ink">{item.name}</p>
                    <p className="mt-0.5 text-sm text-maven-muted">{item.description}</p>
                  </div>
                  <p className="mono font-semibold text-maven-ink">{item.total}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 ml-auto max-w-xs space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-maven-muted">Subtotal</span><span className="mono text-maven-ink">{detail.order.subtotal}</span></div>
              <div className="flex justify-between"><span className="text-maven-muted">Discount</span><span className="mono text-maven-ink">-{detail.order.discount}</span></div>
              <div className="flex justify-between"><span className="text-maven-muted">Tax</span><span className="mono text-maven-ink">{detail.order.tax}</span></div>
              <div className="flex justify-between border-t border-maven-line pt-2 text-base"><span className="font-semibold text-maven-ink">Total</span><span className="mono font-semibold text-maven-ink">{detail.order.currency} {detail.order.total}</span></div>
              {invoice && <div className="flex justify-between text-sm text-maven-muted"><span>Balance due</span><span className="mono font-semibold text-maven-ink">{invoice.currency} {invoice.balance}</span></div>}
            </div>
          </>
        )}
      </main>
    <SiteFooter />
      </div>
  )
}
