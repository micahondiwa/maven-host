import { useEffect, useState } from 'react'
import { Link } from '@/lib/navigation'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import {
  ApiError,
  listMyDomains,
  listMyHostingAccounts,
  listOrders,
  type MyDomain,
  type MyHostingAccountSummary,
  type OrderSummary,
} from '../../lib/api'

export function AccountOverviewPage() {
  const [domains, setDomains] = useState<MyDomain[]>([])
  const [hosting, setHosting] = useState<MyHostingAccountSummary[]>([])
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([listMyDomains(), listMyHostingAccounts(), listOrders()])
      .then(([d, h, o]) => {
        setDomains(d)
        setHosting(h)
        setOrders(o)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your account overview.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading your account…</div>
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>

  const pendingOrders = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')
  const expiringDomains = domains.filter((domain) => domain.expires_at && new Date(`${domain.expires_at}T23:59:59`).getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000)

  return (
    <div className="space-y-8">
      <div className="grid divide-x divide-maven-line border border-maven-line sm:grid-cols-3">
        <SummaryStat label="Domains" value={domains.length} to="/account/domains" />
        <SummaryStat label="Hosting accounts" value={hosting.length} to="/account/hosting" />
        <SummaryStat label="Orders" value={orders.length} to="/account/orders" />
      </div>

      <Link to="/account/expiring" className={`panel flex flex-wrap items-center justify-between gap-3 p-5 transition hover:border-maven-signal/40 ${expiringDomains.length ? 'border-amber-300 bg-amber-50/60' : ''}`}>
        <div><h2 className="font-semibold text-maven-ink">{expiringDomains.length ? `${expiringDomains.length} domain${expiringDomains.length === 1 ? '' : 's'} expiring soon` : 'Domain expiry overview'}</h2><p className="mt-1 text-sm text-maven-muted">See domains due in the next 30 days and review renewal settings.</p></div>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-maven-signal">Review expiry dates <ArrowRight className="size-4" /></span>
      </Link>

      <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-semibold text-maven-ink">Websites and AI drafts</h2>
          <p className="mt-1 text-sm text-maven-muted">Review saved website drafts and run their technical SEO checks.</p>
        </div>
        <Link to="/account/websites" className="inline-flex items-center gap-2 text-sm font-semibold text-maven-signal">View websites <ArrowRight className="size-4" /></Link>
      </div>

      {pendingOrders.length > 0 && (
        <div className="panel border-amber-200 bg-amber-50/50 p-6">
          <p className="font-semibold text-maven-ink">{pendingOrders.length} order{pendingOrders.length > 1 ? 's' : ''} in progress</p>
          <div className="mt-3 divide-y divide-maven-line">
            {pendingOrders.map((order) => (
              <Link key={order.order_id} to={`/orders/${order.order_id}`} className="flex items-center justify-between gap-3 py-3 text-sm font-medium text-maven-ink">
                <span className="mono">{order.number} · {order.status.replace('_', ' ')}</span>
                <ArrowRight className="size-4 text-maven-muted" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-maven-ink">Your domains</h2>
            <Link to="/account/domains" className="text-sm font-semibold text-maven-signal">View all</Link>
          </div>
          {domains.length === 0 ? (
            <p className="mt-3 text-sm text-maven-muted">No domains yet. <Link to="/#domains" className="font-semibold text-maven-signal">Search for one</Link>.</p>
          ) : (
            <ul className="mt-3 divide-y divide-maven-line">
              {domains.slice(0, 4).map((d) => (
                <li key={d.id} className="flex items-center justify-between py-3 text-sm">
                  <span className="mono font-medium text-maven-ink">{d.domain_name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-maven-muted"><span className="status-dot is-live" /> {d.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-maven-ink">Your hosting</h2>
            <Link to="/account/hosting" className="text-sm font-semibold text-maven-signal">View all</Link>
          </div>
          {hosting.length === 0 ? (
            <p className="mt-3 text-sm text-maven-muted">No hosting accounts yet. <Link to="/hosting" className="font-semibold text-maven-signal">Browse plans</Link>.</p>
          ) : (
            <ul className="mt-3 divide-y divide-maven-line">
              {hosting.slice(0, 4).map((h) => (
                <li key={h.account_id} className="flex items-center justify-between py-3 text-sm">
                  <span className="mono font-medium text-maven-ink">{h.primary_domain || h.username}</span>
                  <span className="flex items-center gap-1.5 text-xs text-maven-muted"><span className="status-dot is-live" /> {h.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryStat({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link to={to} className="p-6 transition hover:bg-black/5">
      <p className="mono text-[2rem] font-semibold text-maven-ink">{value}</p>
      <p className="mt-1 text-sm font-medium text-maven-muted">{label}</p>
    </Link>
  )
}
