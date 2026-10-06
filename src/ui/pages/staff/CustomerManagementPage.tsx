import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@/lib/navigation'
import { Search, Users, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { ApiError, listCustomers, type StaffCustomer } from '../../lib/api'

function statusLabel(status: StaffCustomer['status']) {
  return status === 'active' ? 'Active' : status === 'unverified' ? 'Unverified' : 'Suspended'
}

export function CustomerManagementPage() {
  const [customers, setCustomers] = useState<StaffCustomer[]>([])
  const [search, setSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [next, setNext] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    listCustomers(submittedSearch, page).then((data) => {
      if (!active) return
      setCustomers(data.results)
      setCount(data.count)
      setNext(data.next)
      setPrevious(data.previous)
    }).catch((err) => {
      if (active) setError(err instanceof ApiError ? err.message : 'Unable to load customers.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [submittedSearch, page])

  function submit(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setSubmittedSearch(search)
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-maven-blue">Customer operations</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-maven-navy">Customers</h1>
          <p className="mt-2 max-w-2xl text-sm text-maven-muted">Search and review customer accounts within your authorized operational scope.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-600 ring-1 ring-slate-200"><Users className="size-4 text-maven-blue" /> {count.toLocaleString()} customers</div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:flex-row">
        <label className="sr-only" htmlFor="customer-search">Search customers</label>
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input id="customer-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email, name, or company" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-maven-blue focus:bg-white focus:ring-2 focus:ring-blue-100" /></div>
        <button className="rounded-xl bg-maven-navy px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-maven-blue focus:ring-offset-2">Search</button>
      </form>

      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Customer</th><th className="px-5 py-4">Company</th><th className="px-5 py-4">Country</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500"><Loader2 className="mx-auto size-5 animate-spin" /><span className="mt-2 block text-sm">Loading customers…</span></td></tr> : customers.length === 0 ? <tr><td colSpan={5} className="px-5 py-14 text-center"><Users className="mx-auto size-8 text-slate-300" /><p className="mt-3 font-bold text-slate-700">No customers found</p><p className="mt-1 text-sm text-slate-500">Try another search term.</p></td></tr> : customers.map((customer) => <tr key={customer.id} className="hover:bg-slate-50/80">
                <td className="px-5 py-4"><p className="font-bold text-maven-navy">{[customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unnamed customer'}</p><p className="mt-0.5 text-xs text-slate-500">{customer.email}</p></td>
                <td className="px-5 py-4 text-slate-600">{customer.company || '—'}</td>
                <td className="px-5 py-4 text-slate-600">{customer.country || '—'}</td>
                <td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${customer.status === 'active' ? 'bg-emerald-50 text-emerald-700' : customer.status === 'unverified' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{statusLabel(customer.status)}</span></td>
                <td className="px-5 py-4 text-right"><Link to={`/staff/customers/${customer.id}`} className="font-bold text-maven-blue hover:underline">View</Link></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
          <p className="text-xs font-semibold text-slate-500">Page {page}</p>
          <div className="flex gap-2"><button disabled={!previous || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="size-4" /></button><button disabled={!next || loading} onClick={() => setPage((value) => value + 1)} className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="size-4" /></button></div>
        </div>
      </div>
    </section>
  )
}
