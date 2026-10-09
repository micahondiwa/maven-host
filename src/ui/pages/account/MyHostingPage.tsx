import { useEffect, useState } from 'react'
import { Link, useParams } from '@/lib/navigation'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { ApiError, getMyHostingAccount, listMyHostingAccounts, type MyHostingAccountDetail, type MyHostingAccountSummary } from '../../lib/api'

export function MyHostingPage() {
  const { id } = useParams()
  return id ? <HostingDetail id={id} /> : <HostingList />
}

function HostingList() {
  const [accounts, setAccounts] = useState<MyHostingAccountSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listMyHostingAccounts()
      .then(setAccounts)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your hosting accounts.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading your hosting accounts…</div>
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>

  if (accounts.length === 0) {
    return (
      <div className="panel border-dashed p-12 text-center">
        <p className="mono text-sm text-maven-muted">hosting / empty</p>
        <p className="mt-3 font-semibold text-maven-ink">You don't have any hosting accounts yet</p>
        <Link to="/hosting" className="btn btn-primary mt-4">Browse hosting plans</Link>
      </div>
    )
  }

  return (
    <div className="panel divide-y divide-maven-line">
      {accounts.map((a) => (
        <Link key={a.account_id} to={`/account/hosting/${a.account_id}`} className="flex items-center justify-between p-5 transition hover:bg-black/5">
          <div>
            <p className="mono font-semibold text-maven-ink">{a.primary_domain || a.username}</p>
            <p className="mt-0.5 text-sm text-maven-muted">{a.package_name} · {a.server_name}</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-maven-muted"><span className="status-dot is-live" /> {a.status}</span>
        </Link>
      ))}
    </div>
  )
}

function HostingDetail({ id }: { id: string }) {
  const [account, setAccount] = useState<MyHostingAccountDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getMyHostingAccount(id)
      .then(setAccount)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load this hosting account.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading hosting account…</div>
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>
  if (!account) return null

  const diskPct = account.disk_limit_mb > 0 ? Math.min(100, Math.round((account.disk_used_mb / account.disk_limit_mb) * 100)) : 0
  const bwPct = account.bandwidth_limit_mb > 0 ? Math.min(100, Math.round((account.bandwidth_used_mb / account.bandwidth_limit_mb) * 100)) : 0

  return (
    <div className="max-w-2xl">
      <Link to="/account/hosting" className="inline-flex items-center gap-2 text-sm font-semibold text-maven-signal"><ArrowLeft className="size-4" /> Back to hosting</Link>
      <h2 className="mono mt-4 text-[1.5rem] font-semibold text-maven-ink">{account.primary_domain || account.username}</h2>
      <p className="mt-1 text-sm text-maven-muted">{account.package_name} on {account.server_name}</p>

      <div className="mt-6 panel space-y-5 p-6">
        <UsageBar label="Disk usage" used={account.disk_used_mb} limit={account.disk_limit_mb} pct={diskPct} />
        <UsageBar label="Bandwidth usage" used={account.bandwidth_used_mb} limit={account.bandwidth_limit_mb} pct={bwPct} />
      </div>

      <div className="mt-6 panel divide-y divide-maven-line">
        <Field label="Status" value={account.suspended ? 'Suspended' : account.status} />
        <Field label="Dedicated IP" value={account.dedicated_ip ?? 'Shared'} />
        <Field label="Created" value={new Date(account.created_at).toLocaleDateString()} />
        <Field label="Username" value={account.username} />
      </div>
      <SupportActions />
    </div>
  )
}

/** Backups, restores and control-panel changes are handled by support until online self-service is enabled. */
function SupportActions() {
  return <section className="mt-6 panel p-5" aria-labelledby="hosting-support-title">
    <h3 id="hosting-support-title" className="font-semibold text-maven-ink">Backups and account changes</h3>
    <p className="mt-1 text-sm leading-6 text-maven-muted">To restore a backup, change your plan, reset control-panel access or suspend the service, contact MavenHost support and we will complete it for you.</p>
    <Link to="/contact?type=support" className="btn btn-secondary mt-4">Contact support</Link>
  </section>
}

function UsageBar({ label, used, limit, pct }: { label: string; used: number; limit: number; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="font-medium text-maven-ink">{label}</span><span className="mono text-maven-muted">{used.toLocaleString()} MB / {limit > 0 ? `${limit.toLocaleString()} MB` : 'Unlimited'}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-maven-signal" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 text-sm">
      <span className="text-maven-muted">{label}</span>
      <span className="mono font-medium text-maven-ink">{value}</span>
    </div>
  )
}
