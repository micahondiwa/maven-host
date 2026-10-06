import { useEffect, useState } from 'react'
import { Link } from '@/lib/navigation'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { ApiError, listOrders, type OrderSummary } from '../../lib/api'

const STATUS_TONE: Record<string, string> = {
  completed: 'is-live',
  cancelled: 'is-off',
  pending: 'is-pending',
  pending_payment: 'is-pending',
  processing: 'is-pending',
}

export function OrdersListPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listOrders()
      .then(setOrders)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your orders.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading your orders…</div>
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>

  if (orders.length === 0) {
    return (
      <div className="panel border-dashed p-12 text-center">
        <p className="mono text-sm text-maven-muted">orders / empty</p>
        <p className="mt-3 font-semibold text-maven-ink">You have no orders yet</p>
        <Link to="/#domains" className="btn btn-primary mt-4">Start shopping</Link>
      </div>
    )
  }

  return (
    <div className="panel divide-y divide-maven-line">
      {orders.map((order) => (
        <Link key={order.order_id} to={`/orders/${order.order_id}`} className="flex items-center justify-between p-5 transition hover:bg-black/5">
          <div>
            <p className="mono font-semibold text-maven-ink">{order.number}</p>
            <p className="mono mt-0.5 text-sm text-maven-muted">{order.currency} {order.total}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-maven-muted"><span className={`status-dot ${STATUS_TONE[order.status] ?? 'is-pending'}`} /> {order.status.replace('_', ' ')}</span>
            <ArrowRight className="size-4 text-maven-muted" />
          </div>
        </Link>
      ))}
    </div>
  )
}
