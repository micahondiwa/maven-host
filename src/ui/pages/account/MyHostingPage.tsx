import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from '@/lib/navigation'
import { ArrowLeft, HardDriveDownload, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react'
import { ApiError, createHostingBackup, createResellerChildAccount, getMyHostingAccount, getResellerChildAccounts, listHostingBackups, listMyHostingAccounts, restoreHostingBackup, type HostingBackup, type MyHostingAccountDetail, type MyHostingAccountSummary, type ResellerChildCatalog } from '../../lib/api'

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
      <ResellerChildManager accountId={account.account_id} />
      <BackupManager accountId={account.account_id} />
    </div>
  )
}

function ResellerChildManager({ accountId }: { accountId: string }) {
  const [catalog, setCatalog] = useState<ResellerChildCatalog | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [domain, setDomain] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [packageId, setPackageId] = useState('')

  const refresh = useCallback(async () => {
    try {
      const result = await getResellerChildAccounts(accountId)
      setCatalog(result)
      setPackageId((current) => current || String(result.packages[0]?.id ?? ''))
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) setError(err instanceof ApiError ? err.message : 'Reseller account details could not be loaded.')
    }
  }, [accountId])

  useEffect(() => { void refresh() }, [refresh])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!packageId) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      await createResellerChildAccount({ reseller_account_id: accountId, package_id: Number(packageId), domain, username, password, contact_email: email })
      setDomain(''); setUsername(''); setPassword(''); setEmail('')
      setNotice('The customer cPanel account was created in WHM.')
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The cPanel account request could not be completed.')
      await refresh()
    } finally { setWorking(false) }
  }

  if (!catalog && !error) return null
  if (!catalog && error) return <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>

  return <section className="mt-6 panel p-5" aria-labelledby="reseller-accounts-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="reseller-accounts-title" className="font-semibold text-maven-ink">Customer cPanel accounts</h3><p className="mt-1 text-sm text-maven-muted">Create and manage separate customer accounts through your reseller package.</p></div>
      <span className="rounded-full bg-maven-paper px-3 py-1 text-xs font-semibold text-maven-ink">{catalog!.accounts_in_use} / {catalog!.account_limit} used</span>
    </div>
    {catalog!.accounts.length > 0 && <ul className="mt-4 divide-y divide-maven-line">{catalog!.accounts.map((child) => <li key={child.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="mono text-sm font-semibold text-maven-ink">{child.domain}</p><p className="mt-0.5 text-xs text-maven-muted">cPanel user: {child.username}</p></div><span className="text-xs font-semibold capitalize text-maven-muted">{child.status.replace('_', ' ')}</span></li>)}</ul>}
    {catalog!.accounts_in_use < catalog!.account_limit && catalog!.packages.length > 0 && <form onSubmit={submit} className="mt-5 grid gap-3 border-t border-maven-line pt-5 sm:grid-cols-2">
      <label className="text-sm font-medium text-maven-ink">Customer domain<input required value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="customer.example" className="field mt-1.5" /></label>
      <label className="text-sm font-medium text-maven-ink">WHM package<select required value={packageId} onChange={(e) => setPackageId(e.target.value)} className="field mt-1.5">{catalog!.packages.map((item) => <option key={item.id} value={item.id}>{item.plan_name}</option>)}</select></label>
      <label className="text-sm font-medium text-maven-ink">cPanel username<input required pattern="[a-z][a-z0-9]{0,15}" value={username} onChange={(e) => setUsername(e.target.value)} className="field mt-1.5" /></label>
      <label className="text-sm font-medium text-maven-ink">Customer email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1.5" /></label>
      <label className="text-sm font-medium text-maven-ink sm:col-span-2">Initial cPanel password<input required type="password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1.5" /><span className="mt-1 block text-xs font-normal text-maven-muted">Sent securely to WHM for account creation and not stored by MavenHost.</span></label>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger sm:col-span-2">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 sm:col-span-2">{notice}</p>}
      <button type="submit" disabled={working || !packageId} className="btn btn-primary sm:col-span-2">{working ? 'Creating cPanel account…' : 'Create customer account'}</button>
    </form>}
    {catalog!.accounts_in_use < catalog!.account_limit && catalog!.packages.length === 0 && <p className="mt-4 text-sm text-maven-muted">No shared or WordPress WHM packages are configured on this reseller’s server yet.</p>}
    {catalog!.accounts_in_use >= catalog!.account_limit && <p className="mt-4 text-sm text-maven-muted">This plan has reached its customer account limit.</p>}
    {error && catalog && <p role="alert" className="mt-3 text-sm font-medium text-maven-danger">{error}</p>}
    {notice && catalog && <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{notice}</p>}
  </section>
}

function BackupManager({ accountId }: { accountId: string }) {
  const [backups, setBackups] = useState<HostingBackup[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setBackups(await listHostingBackups(accountId)) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Backups are not available for this hosting account.') }
    finally { setLoading(false) }
  }, [accountId])

  useEffect(() => { void refresh() }, [refresh])

  async function createBackup() {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const operation = await createHostingBackup(accountId)
      setNotice(`Backup request queued (${operation.status}). Refresh this list after it completes.`)
    } catch (err) { setError(err instanceof ApiError ? err.message : 'The backup could not be requested.') }
    finally { setWorking(false) }
  }

  async function restoreBackup(backup: HostingBackup) {
    const approved = window.confirm(`Restore ${backup.filename || backup.backup_identifier}? This will replace data in the hosting account.`)
    if (!approved) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const operation = await restoreHostingBackup(accountId, backup.backup_identifier)
      setNotice(`Restore request queued (${operation.status}).`)
    } catch (err) { setError(err instanceof ApiError ? err.message : 'The backup could not be restored.') }
    finally { setWorking(false) }
  }

  return (
    <section className="mt-6 panel p-5" aria-labelledby="hosting-backups-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 id="hosting-backups-title" className="font-semibold text-maven-ink">Hosting backups</h3><p className="mt-1 text-sm text-maven-muted">Request an on-demand backup or restore a provider-listed backup. Check your plan details for its listed backup frequency.</p></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading || working} className="btn btn-secondary"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button type="button" onClick={() => void createBackup()} disabled={working} className="btn btn-primary"><HardDriveDownload className="size-4" />Create backup</button>
        </div>
      </div>
      {loading ? <p className="mt-4 flex items-center gap-2 text-sm text-maven-muted"><LoaderCircle className="size-4 animate-spin" /> Loading backups…</p> : backups.length === 0 ? <p className="mt-4 text-sm text-maven-muted">No provider-listed backups are available yet.</p> : (
        <ul className="mt-4 divide-y divide-maven-line">
          {backups.map((backup) => <li key={backup.backup_identifier} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="mono text-sm font-semibold text-maven-ink">{backup.filename || backup.backup_identifier}</p><p className="mt-1 text-xs text-maven-muted">{new Date(backup.created_at).toLocaleString()}{backup.size_bytes !== null ? ` · ${(backup.size_bytes / (1024 * 1024)).toFixed(1)} MB` : ''}</p></div><button type="button" onClick={() => void restoreBackup(backup)} disabled={working} className="btn btn-secondary"><RotateCcw className="size-4" />Restore</button></li>)}
        </ul>
      )}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p>}
    </section>
  )
}

function UsageBar({ label, used, limit, pct }: { label: string; used: number; limit: number; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="font-medium text-maven-ink">{label}</span><span className="mono text-maven-muted">{used.toLocaleString()} / {limit.toLocaleString()} MB</span></div>
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
