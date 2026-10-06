import { useEffect, useMemo, useState } from 'react'
import { Check, KeyRound, ShieldCheck, Users } from 'lucide-react'
import { listPermissions, listRoles, type PermissionCatalogEntry, type Role } from '../../lib/api'
import { ApiError } from '../../lib/api'

export function RoleManagementPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<PermissionCatalogEntry[]>([])
  const [selectedRole, setSelectedRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([listRoles(), listPermissions()]).then(([roleResult, permissionResult]) => {
      if (!active) return
      setRoles(roleResult); setPermissions(permissionResult); setSelectedRole(roleResult[0]?.name ?? '')
    }).catch((err) => { if (active) setError(err instanceof ApiError ? err.message : 'Could not load the authorization catalog.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const role = roles.find((item) => item.name === selectedRole)
  const grouped = useMemo(() => permissions.reduce<Record<string, PermissionCatalogEntry[]>>((acc, permission) => { (acc[permission.module] ??= []).push(permission); return acc }, {}), [permissions])

  return <div className="space-y-6"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maven-blue">Authorization</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Roles & permissions</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-maven-muted">This page is read-only. The backend remains the source of truth for roles, permission definitions and effective access.</p></div>{error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}{loading ? <div className="h-96 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" /> : <div className="grid gap-6 lg:grid-cols-[300px_1fr]"><section className="rounded-2xl border border-slate-200 bg-white p-3"><div className="p-3"><p className="text-xs font-bold uppercase tracking-[0.15em] text-maven-muted">Roles</p></div>{roles.map((item) => <button key={item.name} onClick={() => setSelectedRole(item.name)} className={`w-full rounded-xl p-3 text-left transition ${selectedRole === item.name ? 'bg-blue-50 text-maven-blue' : 'hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-bold">{item.name}</span><span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Users className="size-3" /> {item.user_count}</span></div><p className="mt-1 text-xs text-slate-500">{item.permissions.length} permissions</p></button>)}</section><section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-maven-blue"><ShieldCheck className="size-5" /></span><div><h2 className="text-xl font-black">{role?.name}</h2><p className="text-xs text-maven-muted">{role?.user_count ?? 0} assigned staff accounts</p></div></div></div><span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"><KeyRound className="size-3.5" /> {role?.permissions.length ?? 0} effective permissions</span></div><div className="mt-6 space-y-6">{Object.entries(grouped).map(([module, entries]) => <div key={module}><p className="text-xs font-bold uppercase tracking-[0.15em] text-maven-muted">{module}</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{entries.map((permission) => { const enabled = role?.permissions.includes(permission.codename); return <div key={permission.codename} className={`rounded-xl border p-3 ${enabled ? 'border-blue-100 bg-blue-50/60' : 'border-slate-100 bg-slate-50/60 opacity-60'}`}><div className="flex gap-3"><span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${enabled ? 'bg-maven-blue text-white' : 'bg-slate-200 text-slate-400'}`}>{enabled && <Check className="size-3" />}</span><div><p className="text-sm font-bold text-slate-700">{permission.name}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{permission.codename}</p></div></div></div> })}</div></div>)}</div></section></div>}</div>
}
