import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, LoaderCircle, Lock, ShieldCheck } from 'lucide-react'
import { ApiError, apiRequest } from '../../lib/api'

/** Owner security controls for a domain: registrar lock, WHOIS privacy and the transfer (EPP) code. */

type DomainStatus = {
  domain_id: string; domain_name: string; status: string; expires_on: string | null; locked: boolean; lock_available: boolean
  privacy_enabled: boolean; privacy_available: boolean; transfer_code_required: boolean; renewable: boolean
}

const base = (id: string) => `/domains/customer/domains/${id}`
const message = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback)

function Toggle({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-start justify-between gap-4 py-4">
    <div><p className="font-semibold text-maven-ink">{label}</p><p className="mt-0.5 text-sm text-maven-muted">{description}</p></div>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${checked ? 'bg-maven-signal' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  </div>
}

export function DomainSecurityPanel({ domainId }: { domainId: string }) {
  const [status, setStatus] = useState<DomainStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [code, setCode] = useState('')

  const load = useCallback(() => {
    setError('')
    apiRequest<DomainStatus>(`${base(domainId)}/status/`).then(setStatus).catch((err) => setError(message(err, 'Live domain settings are unavailable right now.')))
  }, [domainId])
  useEffect(load, [load])

  async function change(path: 'lock' | 'privacy', body: Record<string, boolean>, done: string) {
    setWorking(true); setError(''); setNotice('')
    try { setStatus(await apiRequest<DomainStatus>(`${base(domainId)}/${path}/`, { method: 'PUT', body })); setNotice(done) }
    catch (err) { setError(message(err, 'The change could not be made.')) }
    finally { setWorking(false) }
  }

  async function reveal() {
    if (!window.confirm('Show the transfer code? Anyone with this code can move the domain to another provider. We will email you that it was retrieved.')) return
    setWorking(true); setError(''); setNotice('')
    try { setCode((await apiRequest<{ auth_code: string }>(`${base(domainId)}/auth-code/`, { method: 'POST', body: {} })).auth_code) }
    catch (err) { setError(message(err, 'The transfer code could not be retrieved.')) }
    finally { setWorking(false) }
  }

  return <section className="mt-6 panel p-5" aria-labelledby="domain-security-title">
    <h3 id="domain-security-title" className="font-semibold text-maven-ink">Security and transfer</h3>
    {!status && !error && <p className="mt-3 flex items-center gap-2 text-sm text-maven-muted"><LoaderCircle className="size-4 animate-spin" /> Checking live settings…</p>}
    {status && <div className="divide-y divide-maven-line">
      <Toggle label="Registrar lock" description={status.lock_available ? 'Blocks transfers to another provider until you unlock it.' : 'This domain extension does not support registrar lock.'}
        checked={status.locked} disabled={working || !status.lock_available} onChange={(locked) => change('lock', { locked }, locked ? 'Registrar lock enabled.' : 'Registrar lock disabled. Remember to re-enable it after any transfer.')} />
      <Toggle label="WHOIS privacy" description={status.privacy_available ? 'Hides your personal contact details from public WHOIS lookups.' : 'This domain extension does not allow WHOIS privacy.'}
        checked={status.privacy_enabled} disabled={working || !status.privacy_available} onChange={(enabled) => change('privacy', { enabled }, enabled ? 'WHOIS privacy enabled.' : 'WHOIS privacy disabled.')} />
      <div className="flex flex-wrap items-start justify-between gap-4 py-4">
        <div><p className="font-semibold text-maven-ink">Transfer code</p><p className="mt-0.5 text-sm text-maven-muted">Needed to move this domain to another provider{status.locked ? '. Unlock the domain first.' : '.'}</p></div>
        {code
          ? <div className="flex items-center gap-2"><code className="mono rounded-lg bg-maven-paper px-3 py-2 text-sm">{code}</code><button type="button" className="btn btn-secondary" aria-label="Copy transfer code" onClick={() => { void navigator.clipboard?.writeText(code); setNotice('Transfer code copied.') }}><Copy className="size-4" /></button></div>
          : <button type="button" disabled={working} onClick={reveal} className="btn btn-secondary"><KeyRound className="size-4" /> Show transfer code</button>}
      </div>
    </div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p>}
    <p className="mt-2 flex items-center gap-3 text-xs text-maven-muted"><Lock className="size-3.5" /> Changes are recorded on your account. <ShieldCheck className="size-3.5" /> Settings are read live from the registry.</p>
  </section>
}
