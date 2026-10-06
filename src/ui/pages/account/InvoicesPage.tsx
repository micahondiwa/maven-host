import { useEffect, useState } from 'react'
import { Link } from '@/lib/navigation'
import { LoaderCircle } from 'lucide-react'
import { ApiError, listInvoices, type InvoiceSummary } from '../../lib/api'

const STATUS_TONE: Record<string, string> = {
  issued: 'is-pending',
  paid: 'is-live',
  cancelled: 'is-off',
  partially_paid: 'is-pending',
  draft: 'is-off',
}

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listInvoices()
      .then(setInvoices)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your invoices.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading your invoices…</div>
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>

  if (invoices.length === 0) {
    return (
      <div className="panel border-dashed p-12 text-center">
        <p className="mono text-sm text-maven-muted">invoices / empty</p>
        <p className="mt-3 font-semibold text-maven-ink">No invoices yet</p>
      </div>
    )
  }

  return (
    <div className="panel divide-y divide-maven-line">
      {invoices.map((invoice) => (
        <Link
          key={invoice.invoice_id}
          to={Number(invoice.balance) > 0 ? `/orders/${invoice.order_id}/pay` : `/orders/${invoice.order_id}`}
          className="flex items-center justify-between p-5 transition hover:bg-black/5"
        >
          <div>
            <p className="mono font-semibold text-maven-ink">{invoice.number}</p>
            <p className="mono mt-0.5 text-sm text-maven-muted">{invoice.currency} {invoice.total} total · {invoice.currency} {invoice.balance} due</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-maven-muted"><span className={`status-dot ${STATUS_TONE[invoice.status] ?? 'is-pending'}`} /> {invoice.status.replace('_', ' ')}</span>
        </Link>
      ))}
    </div>
  )
}
