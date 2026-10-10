import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from '@/lib/navigation'
import { ArrowLeft, LoaderCircle, Lock, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { DomainSecurityPanel } from '../../components/account/DomainSecurityPanel'
import { DomainRenewalPanel } from '../../components/account/DomainRenewalPanel'
import { ApiError, createDomainDNSRecord, deleteDomainDNSRecord, getMyDomain, listDomainDNSRecords, listDomainNameservers, listMyDomains, updateDomainNameservers, type DNSRecord, type MyDomain, type MyDomainDetail } from '../../lib/api'

export function MyDomainsPage() {
  const { id } = useParams()
  return id ? <DomainDetail id={id} /> : <DomainList />
}

function DomainList() {
  const [domains, setDomains] = useState<MyDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listMyDomains()
      .then(setDomains)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load your domains.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading your domains…</div>
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>

  if (domains.length === 0) {
    return (
      <div className="panel border-dashed p-12 text-center">
        <p className="mono text-sm text-maven-muted">domains / empty</p>
        <p className="mt-3 font-semibold text-maven-ink">You don't own any domains yet</p>
        <Link to="/#domains" className="btn btn-primary mt-4">Search for a domain</Link>
      </div>
    )
  }

  return (
    <div className="panel divide-y divide-maven-line">
      {domains.map((d) => (
        <Link key={d.id} to={`/account/domains/${d.id}`} className="flex items-center justify-between p-5 transition hover:bg-black/5">
          <div>
            <p className="mono font-semibold text-maven-ink">{d.domain_name}</p>
            <p className="mt-0.5 text-sm text-maven-muted">via {d.registrar} · expires {d.expires_at ?? '—'}</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-maven-muted">
            {d.auto_renew && <span>auto-renew on</span>}
            <span className="flex items-center gap-1.5"><span className="status-dot is-live" /> {d.status}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function DomainDetail({ id }: { id: string }) {
  const [domain, setDomain] = useState<MyDomainDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getMyDomain(id)
      .then(setDomain)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load this domain.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading domain…</div>
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>
  if (!domain) return null

  return (
    <div className="max-w-4xl">
      <Link to="/account/domains" className="inline-flex items-center gap-2 text-sm font-semibold text-maven-signal"><ArrowLeft className="size-4" /> Back to domains</Link>
      <h2 className="mono mt-4 text-[1.5rem] font-semibold text-maven-ink">{domain.domain_name}</h2>
      <div className="mt-6 panel divide-y divide-maven-line">
        <Field label="Status" value={domain.status} />
        <Field label="Registrar" value={domain.registrar} />
        <Field label="TLD" value={domain.tld ?? '—'} />
        <Field label="Registration term" value={`${domain.registration_years} year(s)`} />
        <Field label="Expires" value={domain.expires_at ?? '—'} />
        <Field label="Auto-renew" value={domain.auto_renew ? 'On' : 'Off'} />
      </div>
      <div className="mt-5 flex gap-5 text-sm text-maven-muted">
        <span className="inline-flex items-center gap-1.5"><Lock className="size-4" /> {domain.locked ? 'Transfer locked' : 'Transfer unlocked'}</span>
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" /> {domain.privacy_enabled ? 'Privacy on' : 'Privacy off'}</span>
      </div>
      <DomainRenewalPanel domainId={domain.id} />
      <DomainSecurityPanel domainId={domain.id} />
      <DomainDNSManager domain={domain} />
    </div>
  )
}

function DomainDNSManager({ domain }: { domain: MyDomainDetail }) {
  const [records, setRecords] = useState<DNSRecord[]>([])
  const [nameservers, setNameservers] = useState<string[]>([])
  const [recordType, setRecordType] = useState<DNSRecord['type']>('A')
  const [host, setHost] = useState('@')
  const [recordValue, setRecordValue] = useState('')
  const [priority, setPriority] = useState('10')
  const [caaFlag, setCaaFlag] = useState('0')
  const [caaTag, setCaaTag] = useState('issue')
  const [loading, setLoading] = useState(true)
  const [recordsLoaded, setRecordsLoaded] = useState(false)
  const [nameserversLoaded, setNameserversLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [nameserverText, setNameserverText] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [recordsResult, nameserversResult] = await Promise.allSettled([
        listDomainDNSRecords(domain.id),
        listDomainNameservers(domain.id),
      ])
      const failures: string[] = []
      if (recordsResult.status === 'fulfilled') {
        setRecords(recordsResult.value)
        setRecordsLoaded(true)
      } else {
        failures.push(recordsResult.reason instanceof ApiError ? recordsResult.reason.message : 'DNS records are not available for this registrar.')
      }
      if (nameserversResult.status === 'fulfilled') {
        setNameservers(nameserversResult.value)
        setNameserverText(nameserversResult.value.join('\n'))
        setNameserversLoaded(true)
      } else {
        failures.push(nameserversResult.reason instanceof ApiError ? nameserversResult.reason.message : 'Nameserver settings are not available for this registrar.')
      }
      setError(failures.join(' '))
    } finally {
      setLoading(false)
    }
  }, [domain.id])

  useEffect(() => { void reload() }, [reload])

  async function addRecord(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const record: Omit<DNSRecord, 'id'> = {
        type: recordType,
        host: host.trim() || '@',
        value: recordValue.trim(),
        ttl: 1800,
        ...(recordType === 'MX' ? { priority: Number(priority) } : {}),
        ...(recordType === 'CAA' ? { flag: Number(caaFlag), tag: caaTag } : {}),
      }
      await createDomainDNSRecord(domain.id, record)
      setRecordValue('')
      await reload()
      setNotice('DNS record added. Changes may take time to propagate.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The DNS record could not be added.')
    } finally { setSaving(false) }
  }

  async function removeRecord(recordId: string) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await deleteDomainDNSRecord(domain.id, recordId)
      await reload()
      setNotice('DNS record removed. Changes may take time to propagate.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The DNS record could not be removed.')
    } finally { setSaving(false) }
  }

  async function saveNameservers(event: FormEvent) {
    event.preventDefault()
    const next = nameserverText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await updateDomainNameservers(domain.id, next)
      await reload()
      setNotice('Nameserver change submitted. DNS may be unavailable while the change propagates.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The nameservers could not be updated.')
    } finally { setSaving(false) }
  }

  return (
    <section className="mt-8 space-y-5" aria-labelledby="dns-settings-title">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 id="dns-settings-title" className="text-lg font-semibold text-maven-ink">DNS and nameservers</h3>
          <button type="button" onClick={() => void reload()} disabled={loading} className="inline-flex items-center gap-2 text-sm font-semibold text-maven-signal"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
        <p className="mt-1 text-sm leading-6 text-maven-muted">Manage common DNS records and authoritative nameservers when the registrar supports these controls. Some registrar APIs replace the full zone when saving, so review the listed records first; unsupported record types can prevent an update.</p>
      </div>

      <div className="panel p-5">
        <h4 className="font-semibold text-maven-ink">DNS records</h4>
        <form onSubmit={addRecord} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-semibold text-maven-muted">Type<select value={recordType} onChange={(event) => setRecordType(event.target.value as DNSRecord['type'])} className="field mt-1"><option>A</option><option>AAAA</option><option>CNAME</option><option>MX</option><option>TXT</option><option>NS</option><option>CAA</option></select></label>
          <label className="text-xs font-semibold text-maven-muted">Host<input value={host} onChange={(event) => setHost(event.target.value)} className="field mt-1" placeholder="@" /></label>
          <label className="text-xs font-semibold text-maven-muted sm:col-span-2 lg:col-span-2">Value<input required value={recordValue} onChange={(event) => setRecordValue(event.target.value)} className="field mt-1" placeholder={recordType === 'A' ? '192.0.2.1' : 'Target or text value'} /></label>
          {recordType === 'MX' && <label className="text-xs font-semibold text-maven-muted">Priority<input type="number" min="0" value={priority} onChange={(event) => setPriority(event.target.value)} className="field mt-1" /></label>}
          {recordType === 'CAA' && <><label className="text-xs font-semibold text-maven-muted">CAA flag<input type="number" min="0" max="255" value={caaFlag} onChange={(event) => setCaaFlag(event.target.value)} className="field mt-1" /></label><label className="text-xs font-semibold text-maven-muted">CAA tag<input value={caaTag} onChange={(event) => setCaaTag(event.target.value)} className="field mt-1" placeholder="issue" /></label></>}
          <button type="submit" disabled={saving || !recordValue.trim()} className="btn btn-primary sm:col-span-2 lg:col-span-5"><Plus className="size-4" />Add DNS record</button>
        </form>
        {loading ? <p className="mt-4 flex items-center gap-2 text-sm text-maven-muted"><LoaderCircle className="size-4 animate-spin" /> Loading DNS records…</p> : !recordsLoaded ? <p className="mt-4 text-sm text-maven-muted">DNS record management is not available for this registrar.</p> : records.length === 0 ? <p className="mt-4 text-sm text-maven-muted">No DNS records were returned by this registrar.</p> : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-maven-line">
            <table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-maven-paper text-xs uppercase text-maven-muted"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Host</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">TTL</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{records.map((record, index) => <tr key={record.id ?? `${record.type}-${record.host}-${index}`} className="border-t border-maven-line"><td className="px-3 py-2 font-semibold text-maven-ink">{record.type}</td><td className="px-3 py-2 mono text-maven-ink">{record.host}</td><td className="max-w-[260px] truncate px-3 py-2 mono text-maven-ink" title={record.value}>{record.value}</td><td className="px-3 py-2 text-maven-muted">{record.ttl}s</td><td className="px-3 py-2 text-right">{record.id && <button type="button" onClick={() => void removeRecord(record.id!)} disabled={saving} className="rounded p-2 text-maven-muted hover:bg-red-50 hover:text-maven-danger" aria-label={`Remove ${record.type} record for ${record.host}`}><Trash2 className="size-4" /></button>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      <form onSubmit={saveNameservers} className="panel p-5">
        <h4 className="font-semibold text-maven-ink">Authoritative nameservers</h4>
        <p className="mt-1 text-sm text-maven-muted">Changing nameservers changes where the DNS zone is managed. Copy required website and email records to the new provider first.</p>
        {nameserversLoaded ? <>
          {nameservers.length > 0 && <p className="mt-3 text-xs text-maven-muted">Current: <span className="mono text-maven-ink">{nameservers.join(' · ')}</span></p>}
          <label htmlFor={`nameservers-${domain.id}`} className="sr-only">Nameservers, one per line</label>
          <textarea id={`nameservers-${domain.id}`} value={nameserverText} onChange={(event) => setNameserverText(event.target.value)} rows={3} className="field mt-3 font-mono text-sm" placeholder={'ns1.example.com\nns2.example.com'} />
          <button type="submit" disabled={saving || nameserverText.trim().split(/\r?\n/).filter(Boolean).length < 2} className="btn btn-secondary mt-3">Save nameservers</button>
        </> : <p className="mt-3 text-sm text-maven-muted">Nameserver management is not available for this registrar.</p>}
      </form>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p>}
    </section>
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
