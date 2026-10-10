import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from '@/lib/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Plus, Search, Settings2 } from 'lucide-react'
import { ApiError } from '../../lib/api'
import {
  createAdminRecord, getAdminOptions, getAdminRecord, listAdminRecords, listAdminResources, runAdminAction, updateAdminRecord,
  type AdminField, type AdminMeta, type AdminRecord, type AdminResourceSummary,
} from '../../lib/admin-api'

/** Generic staff administration pages (replace the v1 Django admin for operational data). */

const card = 'rounded-2xl bg-white ring-1 ring-slate-200'
const errorMessage = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback)

function formatValue(field: AdminField | undefined, record: AdminRecord, name: string) {
  const value = record[name]
  if (!field) return String(value ?? '—')
  if (field.type === 'ref') return String(record[`${name}__label`] ?? value ?? '—')
  if (value === null || value === undefined || value === '') return '—'
  if (field.type === 'boolean') return value ? 'Yes' : 'No'
  if (field.type === 'datetime') {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }
  if (field.type === 'json') return JSON.stringify(value)
  const text = String(value)
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

export function AdminIndexPage() {
  const [resources, setResources] = useState<AdminResourceSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { listAdminResources().then(setResources).catch((err) => setError(errorMessage(err, 'Unable to load administration.'))) }, [])
  const groups = useMemo(() => {
    const map = new Map<string, AdminResourceSummary[]>()
    for (const resource of resources ?? []) map.set(resource.group, [...(map.get(resource.group) ?? []), resource])
    return [...map.entries()]
  }, [resources])
  return <div className="space-y-8">
    <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maven-blue">Administration</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Platform settings and catalog</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-maven-muted">Records you can view or manage with your permissions. Every change is recorded in the audit log.</p></div>
    {error && <div role="alert" className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div>}
    {!resources && !error && <Loader2 className="size-6 animate-spin text-maven-blue" />}
    {resources && resources.length === 0 && <p className="text-sm text-maven-muted">Your role does not include any administration areas.</p>}
    {groups.map(([group, items]) => <section key={group}><h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{group}</h2><div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <Link key={item.key} to={`/staff/admin/${item.key}`} className={`${card} p-5 transition hover:-translate-y-0.5 hover:ring-blue-200`}><div className="flex items-start justify-between gap-3"><h3 className="font-black text-maven-navy">{item.label}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{item.can_manage ? 'Manage' : 'View'}</span></div><p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p></Link>)}</div></section>)}
  </div>
}

function FilterControl({ resource, field, value, onChange }: { resource: string; field: AdminField; value: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  useEffect(() => { if (field.type === 'ref') getAdminOptions(resource, field.name).then(setOptions).catch(() => setOptions([])) }, [resource, field])
  const choices = field.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : field.type === 'choice' ? (field.choices ?? []).map((choice) => ({ value: choice, label: choice })) : field.type === 'ref' ? options : []
  return <label className="text-xs font-bold uppercase tracking-wider text-slate-500">{field.label}
    {choices.length ? <select value={value} onChange={(event) => onChange(event.target.value)} className="field mt-1 normal-case"><option value="">All</option>{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      : <input value={value} onChange={(event) => onChange(event.target.value)} className="field mt-1 normal-case" placeholder="Exact value" />}
  </label>
}

export function AdminResourcePage() {
  const { resource = '' } = useParams<{ resource: string }>()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<Awaited<ReturnType<typeof listAdminRecords>> | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState(params.get('search') ?? '')
  const query = params.toString()

  useEffect(() => {
    let active = true
    setError('')
    listAdminRecords(resource, Object.fromEntries(new URLSearchParams(query))).then((result) => active && setData(result)).catch((err) => active && setError(errorMessage(err, 'Unable to load records.')))
    return () => { active = false }
  }, [resource, query])

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }
  const page = Number(params.get('page') ?? '1')
  const meta = data?.meta
  const fields = new Map((meta?.fields ?? []).map((field) => [field.name, field]))

  return <div className="space-y-6">
    <Link to="/staff/admin" className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue"><ArrowLeft className="size-4" /> Administration</Link>
    {error && <div role="alert" className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div>}
    {!data && !error && <Loader2 className="size-6 animate-spin text-maven-blue" />}
    {meta && data && <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maven-blue">{meta.group}</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{meta.label}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-maven-muted">{meta.description}</p></div>
        {meta.can_create && <Link to={`/staff/admin/${resource}/new`} className="btn btn-primary"><Plus className="size-4" /> New</Link>}
      </div>
      {(meta.searchable || meta.filters.length > 0) && <form onSubmit={(event: FormEvent) => { event.preventDefault(); update({ search }) }} className={`${card} grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4`}>
        {meta.searchable && <label className="text-xs font-bold uppercase tracking-wider text-slate-500 sm:col-span-2">Search<div className="mt-1 flex gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} className="field normal-case" /><button type="submit" className="btn btn-secondary" aria-label="Search"><Search className="size-4" /></button></div></label>}
        {meta.filters.map((name) => fields.get(name) && <FilterControl key={name} resource={resource} field={fields.get(name)!} value={params.get(`filter_${name}`) ?? ''} onChange={(value) => update({ [`filter_${name}`]: value })} />)}
      </form>}
      <div className={`${card} overflow-hidden`}><div className="overflow-x-auto"><table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr>{meta.list.map((name) => <th key={name} className="px-5 py-4">{fields.get(name)?.label ?? name}</th>)}<th className="px-5 py-4" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.results.map((record) => <tr key={String(record.id)} className="hover:bg-slate-50/80">{meta.list.map((name) => <td key={name} className="px-5 py-3 text-slate-700">{formatValue(fields.get(name), record, name)}</td>)}<td className="px-5 py-3 text-right"><Link to={`/staff/admin/${resource}/${record.id}`} className="font-bold text-maven-blue hover:underline">{meta.can_manage ? 'Edit' : 'View'}</Link></td></tr>)}</tbody>
      </table></div>{data.results.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No records match.</p>}</div>
      <div className="flex items-center justify-between text-sm text-slate-500"><span>{data.count} record{data.count === 1 ? '' : 's'}</span><div className="flex gap-2"><button type="button" disabled={!data.previous} onClick={() => update({ page: String(page - 1) })} className="btn btn-secondary disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="size-4" /></button><button type="button" disabled={!data.next} onClick={() => update({ page: String(page + 1) })} className="btn btn-secondary disabled:opacity-40" aria-label="Next page"><ChevronRight className="size-4" /></button></div></div>
    </>}
  </div>
}

function FieldInput({ resource, field, value, onChange }: { resource: string; field: AdminField; value: unknown; onChange: (value: unknown) => void }) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  useEffect(() => { if (field.type === 'ref') getAdminOptions(resource, field.name).then(setOptions).catch(() => setOptions([])) }, [resource, field])
  const id = `field-${field.name}`
  const common = { id, className: 'field mt-1.5' }
  switch (field.type) {
    case 'boolean':
      return <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="mt-2 size-5 accent-maven-signal" />
    case 'longtext':
      return <textarea {...common} rows={4} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
    case 'json':
      return <textarea {...common} rows={8} spellCheck={false} className="field mt-1.5 font-mono text-xs" value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)} onChange={(event) => onChange(event.target.value)} />
    case 'choice':
      return <select {...common} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}><option value="" disabled>Select…</option>{(field.choices ?? []).map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>
    case 'ref':
      return <select {...common} value={value === null || value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value || null)}><option value="">{field.nullable ? 'None' : 'Select…'}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    case 'secret':
      return <input {...common} type="password" autoComplete="new-password" placeholder={value ? 'Saved — enter a new value to replace it' : 'Enter value'} onChange={(event) => onChange(event.target.value)} />
    case 'integer':
    case 'decimal':
      return <input {...common} inputMode="decimal" value={value === null || value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)} />
    default:
      return <input {...common} value={String(value ?? '')} maxLength={field.max_length ?? undefined} onChange={(event) => onChange(event.target.value)} />
  }
}

export function AdminRecordPage() {
  const { resource = '', id = '' } = useParams<{ resource: string; id: string }>()
  const navigate = useNavigate()
  const creating = id === 'new'
  const [meta, setMeta] = useState<AdminMeta | null>(null)
  const [record, setRecord] = useState<AdminRecord | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      if (creating) setMeta((await listAdminRecords(resource, { page_size: '1' })).meta)
      else { const result = await getAdminRecord(resource, id); setMeta(result.meta); setRecord(result.record) }
    } catch (err) { setError(errorMessage(err, 'Unable to load this record.')) }
  }, [resource, id, creating])
  useEffect(() => { void load() }, [load])

  const editableFields = (meta?.fields ?? []).filter((field) => field.editable || (creating && field.required))
  const shown = (field: AdminField) => (creating ? editableFields.includes(field) : true)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setErrors({}); setError(''); setNotice('')
    const body: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(draft)) {
      const field = meta?.fields.find((item) => item.name === name)
      if (field?.type === 'secret' && !value) continue
      if (field?.type === 'json' && typeof value === 'string') {
        try { body[name] = JSON.parse(value) } catch { setErrors({ [name]: ['Enter valid JSON.'] }); setSaving(false); return }
      } else body[name] = value
    }
    try {
      const saved = creating ? await createAdminRecord(resource, body) : await updateAdminRecord(resource, id, body)
      setDraft({})
      if (creating) navigate(`/staff/admin/${resource}/${saved.id}`, { replace: true })
      else { setRecord(saved); setNotice('Saved. The change is recorded in the audit log.') }
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors)
      setError(errorMessage(err, 'The record could not be saved.'))
    } finally { setSaving(false) }
  }

  async function act(name: string, confirmText: string | null) {
    if (confirmText && !window.confirm(confirmText)) return
    setError(''); setNotice('')
    try { setRecord(await runAdminAction(resource, id, name)); setNotice('Action completed.') } catch (err) { setError(errorMessage(err, 'The action could not be completed.')) }
  }

  if (!meta) return error ? <div role="alert" className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div> : <Loader2 className="size-6 animate-spin text-maven-blue" />
  const canEdit = meta.can_manage
  return <div className="space-y-6">
    <Link to={`/staff/admin/${resource}`} className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue"><ArrowLeft className="size-4" /> {meta.label}</Link>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maven-blue">{meta.label}</p><h1 className="mt-2 text-2xl font-black tracking-[-0.03em]">{creating ? 'New record' : String(record?.[meta.list[0]] ?? record?.id ?? '')}</h1></div>
      {!creating && meta.actions.length > 0 && <div className="flex gap-2">{meta.actions.map((action) => <button key={action.name} type="button" onClick={() => act(action.name, action.confirm)} className="btn btn-secondary"><Settings2 className="size-4" /> {action.label}</button>)}</div>}
    </div>
    {error && <div role="alert" className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">{notice}</div>}
    <form onSubmit={save} className={`${card} grid gap-5 p-6 md:grid-cols-2`}>
      {meta.fields.filter(shown).map((field) => {
        const editable = canEdit && (field.editable || (creating && field.required))
        const value = field.name in draft ? draft[field.name] : record?.[field.name]
        return <div key={field.name} className={field.type === 'json' || field.type === 'longtext' ? 'md:col-span-2' : ''}>
          <label htmlFor={`field-${field.name}`} className="text-sm font-semibold text-slate-700">{field.label}{editable && field.required ? ' *' : ''}</label>
          {editable ? <FieldInput resource={resource} field={field} value={value} onChange={(next) => setDraft((current) => ({ ...current, [field.name]: next }))} /> : <p className={`mt-1.5 break-words text-sm text-slate-600 ${field.type === 'json' ? 'font-mono text-xs' : ''}`}>{record ? formatValue(field, record, field.name) : '—'}</p>}
          {field.help && <p className="mt-1 text-xs text-slate-500">{field.help}</p>}
          {errors[field.name] && <p role="alert" className="mt-1 text-xs font-semibold text-red-700">{errors[field.name].join(' ')}</p>}
        </div>
      })}
      {errors.non_field_errors && <p role="alert" className="text-sm font-semibold text-red-700 md:col-span-2">{errors.non_field_errors.join(' ')}</p>}
      {canEdit && (creating || editableFields.length > 0) && <div className="md:col-span-2"><button type="submit" disabled={saving || (!creating && Object.keys(draft).length === 0)} className="btn btn-primary disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : null}{creating ? 'Create' : 'Save changes'}</button></div>}
    </form>
  </div>
}
