import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useParams } from '@/lib/navigation'
import {
  ArrowLeft,
  Building2,
  CreditCard,
  LifeBuoy,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Globe2,
  HardDrive,
  Loader2,
  Mail,
  MapPin,
  Package,
  Receipt,
  Phone,
  Server,
  ShieldCheck,
  ShoppingCart,
  UserRound,
} from 'lucide-react'
import {
  ApiError,
  getCustomer,
  getCustomerDomain,
  getCustomerHosting,
  getCustomerOrder,
  getCustomerInvoice,
  getCustomerPayment,
  listCustomerDomains,
  listCustomerHosting,
  listCustomerOrders,
  listCustomerInvoices,
  listCustomerPayments,
  type StaffCustomerDetail,
  type StaffCustomerDomain,
  type StaffCustomerDomainDetail,
  type StaffCustomerHosting,
  type StaffCustomerHostingDetail,
  type StaffCustomerOrder,
  type StaffCustomerOrderDetail,
  type StaffCustomerInvoice,
  type StaffCustomerInvoiceDetail,
  type StaffCustomerPayment,
  type StaffCustomerPaymentDetail,
  type StaffCustomerTicket,
  type StaffCustomerTicketDetail,
  getCustomerTicket,
  listCustomerTickets,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { InvoiceAdjustmentsPanel, PaymentRefundForm } from '../../components/staff/BillingAdjustments'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatMoney(value: string, currency: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return `${currency} ${value}`
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase()
  const tone = normalized.includes('active') || normalized.includes('paid') || normalized.includes('complete') || normalized.includes('success')
    ? 'bg-emerald-50 text-emerald-700'
    : normalized.includes('suspend') || normalized.includes('fail') || normalized.includes('cancel') || normalized.includes('terminat')
      ? 'bg-red-50 text-red-700'
      : 'bg-amber-50 text-amber-700'
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{value}</span>
}

function SectionState({ loading, error, empty, children }: { loading: boolean; error: string; empty: boolean; children: React.ReactNode }) {
  if (loading) return <div className="grid min-h-[260px] place-items-center rounded-2xl bg-white ring-1 ring-slate-200"><div className="text-center"><Loader2 className="mx-auto size-7 animate-spin text-maven-blue" /><p className="mt-3 text-sm font-semibold text-slate-500">Loading operational data…</p></div></div>
  if (error) return <div role="alert" className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700"><CircleAlert className="mt-0.5 size-5 shrink-0" />{error}</div>
  if (empty) return <div className="rounded-2xl bg-white p-12 text-center ring-1 ring-slate-200"><Package className="mx-auto size-9 text-slate-300" /><p className="mt-3 font-bold text-slate-700">Nothing to display</p><p className="mt-1 text-sm text-slate-500">No records are currently associated with this customer.</p></div>
  return <>{children}</>
}

function Overview({ customer }: { customer: StaffCustomerDetail }) {
  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unnamed customer'
  const address = [customer.address, customer.city, customer.postal_code, customer.country].filter(Boolean).join(', ')
  return <div className="grid gap-5 lg:grid-cols-2">
    <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"><h2 className="font-black text-maven-navy">Contact</h2><div className="mt-5 space-y-4 text-sm"><p className="flex gap-3"><Mail className="mt-0.5 size-4 text-maven-blue" /><span>{customer.email}</span></p><p className="flex gap-3"><Phone className="mt-0.5 size-4 text-maven-blue" /><span>{customer.phone_number || 'Not provided'}</span></p><p className="flex gap-3"><Building2 className="mt-0.5 size-4 text-maven-blue" /><span>{customer.company || 'No company'}</span></p><p className="flex gap-3"><MapPin className="mt-0.5 size-4 text-maven-blue" /><span>{address || 'No address provided'}</span></p></div></article>
    <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"><h2 className="font-black text-maven-navy">Account</h2><dl className="mt-5 grid grid-cols-2 gap-5 text-sm"><div><dt className="text-xs font-bold uppercase text-slate-400">Joined</dt><dd className="mt-1 font-semibold text-slate-700">{formatDate(customer.date_joined)}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Currency</dt><dd className="mt-1 font-semibold text-slate-700">{customer.preferred_currency}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Timezone</dt><dd className="mt-1 font-semibold text-slate-700">{customer.timezone}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Email</dt><dd className="mt-1 font-semibold text-slate-700">{customer.is_email_verified ? 'Verified' : 'Unverified'}</dd></div></dl><div className="mt-6"><p className="text-xs font-bold uppercase text-slate-400">Account identity</p><p className="mt-1 text-sm font-semibold text-slate-700">{fullName}</p></div></article>
  </div>
}

function DomainsSection({ customerId, detailId }: { customerId: string; detailId?: string }) {
  const [items, setItems] = useState<StaffCustomerDomain[]>([])
  const [detail, setDetail] = useState<StaffCustomerDomainDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; setLoading(true); setError(''); const promise = detailId ? getCustomerDomain(customerId, detailId).then((data) => { if (active) setDetail(data) }) : listCustomerDomains(customerId).then((data) => { if (active) setItems(data) }); promise.catch((err) => active && setError(err instanceof ApiError ? err.message : 'Unable to load domains.')).finally(() => active && setLoading(false)); return () => { active = false } }, [customerId, detailId])
  return <SectionState loading={loading} error={error} empty={!detailId && items.length === 0}>
    {detailId && detail ? <div className="space-y-5"><Link to={`/staff/customers/${customerId}/domains`} className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue hover:underline"><ArrowLeft className="size-4" /> Back to domains</Link><article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-maven-blue">Domain</p><h2 className="mt-1 text-2xl font-black text-maven-navy">{detail.domain_name}</h2><p className="mt-1 text-sm text-slate-500">Registrar: {detail.registrar}</p></div><StatusBadge value={detail.status} /></div><dl className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[['TLD', detail.tld || '—'], ['Registration', `${detail.registration_years} year${detail.registration_years === 1 ? '' : 's'}`], ['Expires', formatDate(detail.expires_at)], ['Auto-renew', detail.auto_renew ? 'Enabled' : 'Disabled'], ['Lock', detail.locked ? 'Locked' : 'Unlocked'], ['Privacy', detail.privacy_enabled ? 'Enabled' : 'Disabled']].map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</dt><dd className="mt-1 font-semibold text-slate-700">{value}</dd></div>)}</dl></article></div> : <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Domain</th><th className="px-5 py-4">Registrar</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Expires</th><th className="px-5 py-4">Auto-renew</th><th className="px-5 py-4" /></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id} className="hover:bg-slate-50/80"><td className="px-5 py-4 font-bold text-maven-navy"><Globe2 className="mr-2 inline size-4 text-maven-blue" />{item.domain_name}</td><td className="px-5 py-4 text-slate-600">{item.registrar}</td><td className="px-5 py-4"><StatusBadge value={item.status} /></td><td className="px-5 py-4 text-slate-600">{formatDate(item.expires_at)}</td><td className="px-5 py-4 text-slate-600">{item.auto_renew ? 'Enabled' : 'Disabled'}</td><td className="px-5 py-4 text-right"><Link to={`/staff/customers/${customerId}/domains/${item.id}`} className="font-bold text-maven-blue hover:underline">View</Link></td></tr>)}</tbody></table></div></div>}
  </SectionState>
}

function HostingSection({ customerId, detailId }: { customerId: string; detailId?: number }) {
  const [items, setItems] = useState<StaffCustomerHosting[]>([])
  const [detail, setDetail] = useState<StaffCustomerHostingDetail | null>(null)
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { let active = true; setLoading(true); setError(''); const promise = detailId !== undefined ? getCustomerHosting(customerId, detailId).then((data) => active && setDetail(data)) : listCustomerHosting(customerId).then((data) => active && setItems(data)); promise.catch((err) => active && setError(err instanceof ApiError ? err.message : 'Unable to load hosting accounts.')).finally(() => active && setLoading(false)); return () => { active = false } }, [customerId, detailId])
  return <SectionState loading={loading} error={error} empty={detailId === undefined && items.length === 0}>
    {detailId !== undefined && detail ? <div className="space-y-5"><Link to={`/staff/customers/${customerId}/hosting`} className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue hover:underline"><ArrowLeft className="size-4" /> Back to hosting</Link><article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"><div className="flex flex-col gap-4 sm:flex-row sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-maven-blue">Hosting account</p><h2 className="mt-1 text-2xl font-black text-maven-navy">{detail.username}</h2><p className="mt-1 text-sm text-slate-500">{detail.primary_domain}</p></div><StatusBadge value={detail.status} /></div><div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Package" value={detail.package_name} icon={<Package className="size-4" />} /><Metric label="Server" value={detail.server_name} icon={<Server className="size-4" />} /><Metric label="Disk" value={`${detail.disk_usage_mb.toLocaleString()} / ${detail.disk_limit_mb.toLocaleString()} MB`} icon={<HardDrive className="size-4" />} /><Metric label="Bandwidth" value={`${detail.bandwidth_usage_mb.toLocaleString()} / ${detail.bandwidth_limit_mb.toLocaleString()} MB`} icon={<Server className="size-4" />} /></div><dl className="mt-7 grid gap-5 sm:grid-cols-3"><div><dt className="text-xs font-bold uppercase text-slate-400">Created</dt><dd className="mt-1 font-semibold text-slate-700">{formatDateTime(detail.created_at)}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Provisioned</dt><dd className="mt-1 font-semibold text-slate-700">{formatDateTime(detail.provisioned_at)}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Suspended</dt><dd className="mt-1 font-semibold text-slate-700">{formatDateTime(detail.suspended_at)}</dd></div></dl></article></div> : <div className="grid gap-4 lg:grid-cols-2">{items.map((item) => <Link key={item.id} to={`/staff/customers/${customerId}/hosting/${item.id}`} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-blue-200"><div className="flex items-start justify-between gap-4"><div><p className="font-black text-maven-navy">{item.primary_domain || item.username}</p><p className="mt-1 text-sm text-slate-500">{item.username} · {item.package_name}</p></div><StatusBadge value={item.status} /></div><div className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><p className="text-xs font-bold uppercase text-slate-400">Server</p><p className="mt-1 font-semibold text-slate-700">{item.server_name}</p></div><div><p className="text-xs font-bold uppercase text-slate-400">Created</p><p className="mt-1 font-semibold text-slate-700">{formatDate(item.created_at)}</p></div></div></Link>)}</div>}
  </SectionState>
}

function OrdersSection({ customerId, detailId }: { customerId: string; detailId?: string }) {
  const [items, setItems] = useState<StaffCustomerOrder[]>([]); const [detail, setDetail] = useState<StaffCustomerOrderDetail | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { let active = true; setLoading(true); setError(''); const promise = detailId ? getCustomerOrder(customerId, detailId).then((data) => active && setDetail(data)) : listCustomerOrders(customerId).then((data) => active && setItems(data)); promise.catch((err) => active && setError(err instanceof ApiError ? err.message : 'Unable to load orders.')).finally(() => active && setLoading(false)); return () => { active = false } }, [customerId, detailId])
  return <SectionState loading={loading} error={error} empty={!detailId && items.length === 0}>
    {detailId && detail ? <div className="space-y-5"><Link to={`/staff/customers/${customerId}/orders`} className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue hover:underline"><ArrowLeft className="size-4" /> Back to orders</Link><article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-maven-blue">Order</p><h2 className="mt-1 text-2xl font-black text-maven-navy">{detail.order.number}</h2><p className="mt-1 text-sm text-slate-500">Created order total: {formatMoney(detail.order.total, detail.order.currency)}</p></div><StatusBadge value={detail.order.status} /></div><div className="mt-7 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-500"><tr><th className="py-3 pr-4">Item</th><th className="py-3 px-4">Cycle</th><th className="py-3 px-4">Qty</th><th className="py-3 pl-4 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{detail.items.map((item) => <tr key={item.order_item_id}><td className="py-4 pr-4"><p className="font-bold text-maven-navy">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.product_type}{item.resource_id ? ` · ${item.resource_id}` : ''}</p></td><td className="px-4 py-4 text-slate-600">{item.billing_cycle}</td><td className="px-4 py-4 text-slate-600">{item.quantity}</td><td className="py-4 pl-4 text-right font-bold text-slate-700">{formatMoney(item.total, detail.order.currency)}</td></tr>)}</tbody></table></div><dl className="mt-7 ml-auto max-w-sm space-y-2 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-semibold">{formatMoney(detail.order.subtotal, detail.order.currency)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="font-semibold">{formatMoney(detail.order.discount, detail.order.currency)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="font-semibold">{formatMoney(detail.order.tax, detail.order.currency)}</dd></div><div className="flex justify-between border-t border-slate-200 pt-3 text-base"><dt className="font-black">Total</dt><dd className="font-black">{formatMoney(detail.order.total, detail.order.currency)}</dd></div></dl></article></div> : <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Order</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Currency</th><th className="px-5 py-4 text-right">Total</th><th className="px-5 py-4" /></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.order_id} className="hover:bg-slate-50/80"><td className="px-5 py-4"><p className="font-bold text-maven-navy">{item.number}</p><p className="mt-0.5 text-xs text-slate-500">{item.order_id}</p></td><td className="px-5 py-4"><StatusBadge value={item.status} /></td><td className="px-5 py-4 text-slate-600">{item.currency}</td><td className="px-5 py-4 text-right font-bold text-slate-700">{formatMoney(item.total, item.currency)}</td><td className="px-5 py-4 text-right"><Link to={`/staff/customers/${customerId}/orders/${item.order_id}`} className="font-bold text-maven-blue hover:underline">View</Link></td></tr>)}</tbody></table></div></div>}
  </SectionState>
}


function BillingSection({ customerId, invoiceId, paymentId, canViewPayments }: { customerId: string; invoiceId?: string; paymentId?: string; canViewPayments: boolean }) {
  const [invoices, setInvoices] = useState<StaffCustomerInvoice[]>([])
  const [payments, setPayments] = useState<StaffCustomerPayment[]>([])
  const [invoice, setInvoice] = useState<StaffCustomerInvoiceDetail | null>(null)
  const [payment, setPayment] = useState<StaffCustomerPaymentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const load = async () => {
      if (invoiceId) {
        const data = await getCustomerInvoice(customerId, invoiceId)
        if (active) setInvoice(data)
        return
      }
      if (paymentId) {
        const data = await getCustomerPayment(customerId, paymentId)
        if (active) setPayment(data)
        return
      }
      const [invoiceRows, paymentRows] = await Promise.all([
        listCustomerInvoices(customerId),
        canViewPayments ? listCustomerPayments(customerId) : Promise.resolve([]),
      ])
      if (active) {
        setInvoices(invoiceRows)
        setPayments(paymentRows)
      }
    }
    load().catch((err) => {
      if (!active) return
      const message = err instanceof ApiError ? err.message : 'Unable to load billing information.'
      setError(message)
    }).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [customerId, invoiceId, paymentId, canViewPayments, revision])

  if (invoiceId && invoice) {
    return <div className="space-y-5">
      <Link to={`/staff/customers/${customerId}/billing`} className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue hover:underline"><ArrowLeft className="size-4" /> Back to billing</Link>
      <article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-wider text-maven-blue">Invoice</p><h2 className="mt-1 text-2xl font-black text-maven-navy">{invoice.invoice.number}</h2><p className="mt-1 text-sm text-slate-500">Due {formatDate(invoice.invoice.due_date)}</p></div>
          <StatusBadge value={invoice.invoice.status} />
        </div>
        <div className="mt-7 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-500"><tr><th className="py-3 pr-4">Item</th><th className="px-4 py-3">Cycle</th><th className="px-4 py-3">Qty</th><th className="py-3 pl-4 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{invoice.items.map((item) => <tr key={item.invoice_item_id}><td className="py-4 pr-4"><p className="font-bold text-maven-navy">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.product_type}</p></td><td className="px-4 py-4 text-slate-600">{item.billing_cycle || '—'}</td><td className="px-4 py-4 text-slate-600">{item.quantity}</td><td className="py-4 pl-4 text-right font-bold text-slate-700">{formatMoney(item.total, invoice.invoice.currency)}</td></tr>)}</tbody></table></div>
        <dl className="mt-7 ml-auto max-w-sm space-y-2 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-semibold">{formatMoney(invoice.invoice.subtotal, invoice.invoice.currency)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="font-semibold">{formatMoney(invoice.invoice.discount, invoice.invoice.currency)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="font-semibold">{formatMoney(invoice.invoice.tax, invoice.invoice.currency)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Paid</dt><dd className="font-semibold text-emerald-700">{formatMoney(invoice.invoice.paid_amount, invoice.invoice.currency)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Credited</dt><dd className="font-semibold">{formatMoney(invoice.invoice.credited_amount, invoice.invoice.currency)}</dd></div><div className="flex justify-between border-t border-slate-200 pt-3 text-base"><dt className="font-black">Balance</dt><dd className="font-black">{formatMoney(invoice.invoice.balance, invoice.invoice.currency)}</dd></div></dl>
      </article>
      <InvoiceAdjustmentsPanel customerId={customerId} invoiceId={invoiceId} currency={invoice.invoice.currency} onChanged={() => setRevision((value) => value + 1)} />
    </div>
  }

  if (paymentId && payment) {
    return <div className="space-y-5"><Link to={`/staff/customers/${customerId}/billing`} className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue hover:underline"><ArrowLeft className="size-4" /> Back to billing</Link><article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-maven-blue">Payment</p><h2 className="mt-1 text-2xl font-black text-maven-navy">{formatMoney(payment.payment.amount, payment.payment.currency)}</h2><p className="mt-1 text-sm text-slate-500">{payment.payment.provider_reference || 'No provider reference'}</p></div><StatusBadge value={payment.payment.status} /></div><dl className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-xs font-bold uppercase text-slate-400">Method</dt><dd className="mt-1 font-semibold text-slate-700">{payment.payment.method}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Customer reference</dt><dd className="mt-1 font-semibold text-slate-700">{payment.customer_reference || '—'}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Processed</dt><dd className="mt-1 font-semibold text-slate-700">{formatDateTime(payment.processed_at)}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Created</dt><dd className="mt-1 font-semibold text-slate-700">{formatDateTime(payment.payment.created_at)}</dd></div></dl><div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Payment provider payloads are intentionally not exposed in the Staff Portal.</div></article><PaymentRefundForm customerId={customerId} paymentId={paymentId} currency={payment.payment.currency} status={payment.payment.status} /></div>
  }

  return <SectionState loading={loading} error={error} empty={!invoices.length && !payments.length}>
    <div className="space-y-6">
      <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"><div className="border-b border-slate-100 p-5"><div className="flex items-center gap-2"><Receipt className="size-5 text-maven-blue" /><h2 className="font-black text-maven-navy">Invoices</h2></div></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Invoice</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Due</th><th className="px-5 py-4 text-right">Total</th><th className="px-5 py-4 text-right">Balance</th><th className="px-5 py-4" /></tr></thead><tbody className="divide-y divide-slate-100">{invoices.map((item) => <tr key={item.invoice_id} className="hover:bg-slate-50/80"><td className="px-5 py-4 font-bold text-maven-navy">{item.number}</td><td className="px-5 py-4"><StatusBadge value={item.status} /></td><td className="px-5 py-4 text-slate-600">{formatDate(item.due_date)}</td><td className="px-5 py-4 text-right font-bold">{formatMoney(item.total, item.currency)}</td><td className="px-5 py-4 text-right font-bold">{formatMoney(item.balance, item.currency)}</td><td className="px-5 py-4 text-right"><Link to={`/staff/customers/${customerId}/billing/invoices/${item.invoice_id}`} className="font-bold text-maven-blue hover:underline">View</Link></td></tr>)}</tbody></table></div></article>
      {canViewPayments && payments.length > 0 && <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"><div className="border-b border-slate-100 p-5"><div className="flex items-center gap-2"><CreditCard className="size-5 text-maven-blue" /><h2 className="font-black text-maven-navy">Payments</h2></div></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Reference</th><th className="px-5 py-4">Method</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Amount</th><th className="px-5 py-4" /></tr></thead><tbody className="divide-y divide-slate-100">{payments.map((item) => <tr key={item.payment_id} className="hover:bg-slate-50/80"><td className="px-5 py-4 font-bold text-maven-navy">{item.provider_reference || item.payment_id}</td><td className="px-5 py-4 text-slate-600">{item.method}</td><td className="px-5 py-4"><StatusBadge value={item.status} /></td><td className="px-5 py-4 text-right font-bold">{formatMoney(item.amount, item.currency)}</td><td className="px-5 py-4 text-right"><Link to={`/staff/customers/${customerId}/billing/payments/${item.payment_id}`} className="font-bold text-maven-blue hover:underline">View</Link></td></tr>)}</tbody></table></div></article>}
    </div>
  </SectionState>
}

function SupportSection({ customerId, detailId }: { customerId: string; detailId?: string }) {
  const [items, setItems] = useState<StaffCustomerTicket[]>([])
  const [detail, setDetail] = useState<StaffCustomerTicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    const promise = detailId
      ? getCustomerTicket(customerId, detailId).then((data) => active && setDetail(data))
      : listCustomerTickets(customerId).then((data) => active && setItems(data))
    promise.catch((err) => active && setError(err instanceof ApiError ? err.message : 'Unable to load support tickets.')).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [customerId, detailId])

  return <SectionState loading={loading} error={error} empty={!detailId && items.length === 0}>
    {detailId && detail ? <div className="space-y-5">
      <Link to={`/staff/customers/${customerId}/support`} className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue hover:underline"><ArrowLeft className="size-4" /> Back to support</Link>
      <article className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-wider text-maven-blue">Support ticket</p><h2 className="mt-1 text-2xl font-black text-maven-navy">{detail.number}</h2><p className="mt-1 text-sm text-slate-500">{detail.subject}</p></div><StatusBadge value={detail.status} />
        </div>
        <dl className="mt-7 grid gap-5 sm:grid-cols-3"><div><dt className="text-xs font-bold uppercase text-slate-400">Category</dt><dd className="mt-1 font-semibold text-slate-700">{detail.category}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Priority</dt><dd className="mt-1 font-semibold text-slate-700">{detail.priority}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-400">Assigned to</dt><dd className="mt-1 font-semibold text-slate-700">{detail.assigned_to_email || 'Unassigned'}</dd></div></dl>
        <div className="mt-7 rounded-xl bg-slate-50 p-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Description</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{detail.description}</p></div>
        <div className="mt-7"><h3 className="flex items-center gap-2 font-black text-maven-navy"><LifeBuoy className="size-5 text-maven-blue" /> Conversation</h3><div className="mt-4 space-y-3">{detail.messages.length ? detail.messages.map((message) => <article key={message.id} className={`rounded-xl border p-4 ${message.internal_note ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}><div className="flex items-center justify-between gap-4"><p className="text-sm font-bold text-slate-700">{message.author_email}{message.internal_note ? ' · Internal note' : ''}</p><time className="text-xs text-slate-400">{formatDateTime(message.created_at)}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p></article>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No messages yet.</p>}</div></div>
      </article>
    </div> : <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Ticket</th><th className="px-5 py-4">Subject</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Priority</th><th className="px-5 py-4">Updated</th><th className="px-5 py-4" /></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id} className="hover:bg-slate-50/80"><td className="px-5 py-4 font-bold text-maven-navy">{item.number}</td><td className="px-5 py-4 text-slate-700">{item.subject}</td><td className="px-5 py-4"><StatusBadge value={item.status} /></td><td className="px-5 py-4"><StatusBadge value={item.priority} /></td><td className="px-5 py-4 text-slate-600">{formatDateTime(item.updated_at)}</td><td className="px-5 py-4 text-right"><Link to={`/staff/customers/${customerId}/support/${item.id}`} className="font-bold text-maven-blue hover:underline">View</Link></td></tr>)}</tbody></table></div></div>}
  </SectionState>
}

function Metric({ label, value, icon }: { label: string; value: string | null; icon: React.ReactNode }) {
  return <div className="rounded-xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">{icon}{label}</div><p className="mt-2 text-sm font-black text-slate-700">{value}</p></div>
}

export function CustomerDetailPage() {
  const { id, domainId, accountId, orderId, invoiceId, paymentId, ticketId } = useParams()
  const location = useLocation()
  const { hasPermission } = useAuth()
  const [customer, setCustomer] = useState<StaffCustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const section = useMemo(() => {
    if (domainId) return 'domains'
    if (accountId) return 'hosting'
    if (orderId) return 'orders'
    if (invoiceId || paymentId) return 'billing'
    if (ticketId) return 'support'
    if (location.pathname.endsWith('/domains')) return 'domains'
    if (location.pathname.endsWith('/hosting')) return 'hosting'
    if (location.pathname.endsWith('/orders')) return 'orders'
    if (location.pathname.endsWith('/billing')) return 'billing'
    if (location.pathname.endsWith('/support')) return 'support'
    return 'overview'
  }, [location.pathname, domainId, accountId, orderId, invoiceId, paymentId, ticketId])

  useEffect(() => { if (!id) return; let active = true; setLoading(true); setError(''); getCustomer(id).then((data) => active && setCustomer(data)).catch((err) => active && setError(err instanceof ApiError ? err.message : 'Unable to load customer.')).finally(() => active && setLoading(false)); return () => { active = false } }, [id])

  if (loading) return <div className="grid min-h-[420px] place-items-center"><Loader2 className="size-7 animate-spin text-maven-blue" /></div>
  if (error || !customer || !id) return <div className="space-y-4"><Link to="/staff/customers" className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue"><ArrowLeft className="size-4" /> Back to customers</Link><div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error || 'Customer not found.'}</div></div>

  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unnamed customer'
  const canViewPayments = hasPermission('view_payment')
  const tabs = [
    { key: 'overview', label: 'Overview', to: `/staff/customers/${id}`, permission: 'view_customer', icon: UserRound },
    { key: 'domains', label: 'Domains', to: `/staff/customers/${id}/domains`, permission: 'view_domain', icon: Globe2 },
    { key: 'hosting', label: 'Hosting', to: `/staff/customers/${id}/hosting`, permission: 'view_hosting', icon: Server },
    { key: 'orders', label: 'Orders', to: `/staff/customers/${id}/orders`, permission: 'view_order', icon: ShoppingCart },
    { key: 'billing', label: 'Billing', to: `/staff/customers/${id}/billing`, permission: 'view_invoice', icon: Receipt },
    { key: 'support', label: 'Support', to: `/staff/customers/${id}/support`, permission: 'view_ticket', icon: LifeBuoy },
  ].filter((tab) => hasPermission(tab.permission))

  return <section className="space-y-6">
    <Link to="/staff/customers" className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue hover:underline"><ArrowLeft className="size-4" /> Back to customers</Link>
    <div className="overflow-hidden rounded-3xl bg-maven-navy text-white shadow-sm"><div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-2xl bg-white/10"><UserRound className="size-7" /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Customer account</p><h1 className="mt-1 text-2xl font-black">{fullName}</h1><p className="mt-1 text-sm text-slate-300">{customer.email}</p></div></div><div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1.5 text-xs font-bold text-emerald-200"><CheckCircle2 className="size-3.5" /> {customer.status}</span><span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-200"><ShieldCheck className="size-3.5" /> Staff view</span></div></div><nav className="flex gap-1 overflow-x-auto border-t border-white/10 px-3 sm:px-5" aria-label="Customer workspace sections">{tabs.map((tab) => { const Icon = tab.icon; return <NavLink key={tab.key} to={tab.to} end={tab.key === 'overview'} className={({ isActive }) => `inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-4 text-sm font-bold transition ${isActive ? 'border-maven-cyan text-white' : 'border-transparent text-slate-300 hover:border-white/20 hover:text-white'}`}><Icon className="size-4" />{tab.label}</NavLink> })}</nav></div>

    <div className="flex items-center gap-2 text-xs font-semibold text-slate-400"><CalendarDays className="size-4" /> Customer since {formatDate(customer.date_joined)} <ChevronRight className="size-3" /> Operational workspace</div>

    {section === 'overview' && <Overview customer={customer} />}
    {section === 'domains' && <DomainsSection customerId={id} detailId={domainId} />}
    {section === 'hosting' && <HostingSection customerId={id} detailId={accountId ? Number(accountId) : undefined} />}
    {section === 'orders' && <OrdersSection customerId={id} detailId={orderId} />}
    {section === 'billing' && <BillingSection customerId={id} invoiceId={invoiceId} paymentId={paymentId} canViewPayments={canViewPayments} />}
    {section === 'support' && <SupportSection customerId={id} detailId={ticketId} />}
  </section>
}
