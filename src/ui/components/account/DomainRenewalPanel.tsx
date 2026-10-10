import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, LoaderCircle, RefreshCw } from 'lucide-react'
import { Link, useNavigate } from '@/lib/navigation'
import { ApiError, apiRequest } from '../../lib/api'
import { useCart } from '../../lib/cart'
import { useCurrency, usePriceLabel } from '../../lib/currency'

/** Renewal for an owned domain: price, renew-to-cart, unpaid renewal invoice and the Maven Host auto-renew switch. */

type RenewalQuote = {
  domain_id: string; domain_name: string; expires_at: string | null; auto_renew: boolean; renewable: boolean; years: number
  price: { product_id: string; usd: string; kes: string | null } | null; pending_order_id: string | null
}

const base = (id: string) => `/domains/customer/domains/${id}`
const message = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback)

function daysUntil(date: string | null) {
  if (!date) return null
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export function DomainRenewalPanel({ domainId }: { domainId: string }) {
  const navigate = useNavigate()
  const { refresh } = useCart()
  const { code } = useCurrency()
  const priceLabel = usePriceLabel()
  const [quote, setQuote] = useState<RenewalQuote | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(() => {
    apiRequest<RenewalQuote>(`${base(domainId)}/renewal/`).then(setQuote).catch((err) => setError(message(err, 'Renewal details are unavailable right now.')))
  }, [domainId])
  useEffect(load, [load])

  async function renew() {
    if (!quote?.price) return
    setWorking(true); setError('')
    try {
      const currency = code === 'KES' && quote.price.kes ? 'KES' : 'USD'
      await apiRequest('/orders/cart/', { method: 'POST', body: { product_type: 'domain', resource_id: quote.price.product_id, billing_cycle: 'annually', quantity: 1, currency, configuration: { operation: 'renew', domain_id: domainId } } })
      await refresh()
      navigate('/cart')
    } catch (err) { setError(message(err, 'The renewal could not be added to your cart.')) }
    finally { setWorking(false) }
  }

  async function toggleAutoRenew(enabled: boolean) {
    setWorking(true); setError(''); setNotice('')
    try {
      setQuote(await apiRequest<RenewalQuote>(`${base(domainId)}/auto-renew/`, { method: 'PUT', body: { enabled } }))
      setNotice(enabled ? 'Auto-renew is on. We will email a renewal invoice 14 days before the expiry date.' : 'Auto-renew is off. We will remind you before the domain expires.')
    } catch (err) { setError(message(err, 'Auto-renew could not be changed.')) }
    finally { setWorking(false) }
  }

  const left = daysUntil(quote?.expires_at ?? null)
  const label = quote?.price ? priceLabel(quote.price.usd, quote.price.kes) : null

  return <section className="mt-6 panel p-5" aria-labelledby="domain-renewal-title">
    <div className="flex items-center gap-2"><CalendarClock className="size-5 text-maven-signal" /><h3 id="domain-renewal-title" className="font-semibold text-maven-ink">Renewal</h3></div>
    {!quote && !error && <p className="mt-3 flex items-center gap-2 text-sm text-maven-muted"><LoaderCircle className="size-4 animate-spin" /> Loading renewal details…</p>}
    {quote && <>
      <p className="mt-3 text-sm text-maven-muted">
        {quote.expires_at ? <>Expires on <strong className="text-maven-ink">{quote.expires_at}</strong>{left !== null && (left < 0 ? ` (expired ${-left} day${left === -1 ? '' : 's'} ago)` : ` (in ${left} day${left === 1 ? '' : 's'})`)}.</> : 'The expiry date has not been recorded yet.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        {quote.pending_order_id
          ? <Link to={`/orders/${quote.pending_order_id}/pay`} className="btn btn-primary">Pay renewal invoice</Link>
          : quote.renewable && label
            ? <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={renew} disabled={working} className="btn btn-primary">{working ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Renew for 1 year</button><span className="text-sm text-maven-muted">{label.main}{label.note ? ` · ${label.note}` : ''}</span></div>
            : <p className="text-sm text-maven-muted">Online renewal is not available for this domain. Contact Maven Host support to renew it.</p>}
        <label className="flex items-center gap-2 text-sm font-medium text-maven-ink">
          <input type="checkbox" checked={quote.auto_renew} disabled={working || !quote.renewable} onChange={(event) => toggleAutoRenew(event.target.checked)} className="size-4 accent-maven-signal" />
          Auto-renew
        </label>
      </div>
      <p className="mt-3 text-xs text-maven-muted">With auto-renew on, we email a renewal invoice 14 days before expiry; the domain renews once it is paid. Reminders are sent 30, 7 and 1 days before expiry.</p>
    </>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p>}
  </section>
}
