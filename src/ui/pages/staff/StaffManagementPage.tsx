import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Mail, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, UserPlus, X } from 'lucide-react'
import { ApiError, activateStaff, createStaff, getStaffRoles, listRoles, listStaff, resendStaffInvitation, setStaffRoles, suspendStaff, updateStaff, type Role, type StaffStatus, type StaffUser } from '../../lib/api'
import { useAuth } from '../../lib/auth'

// The backend rejects "Customer" for staff accounts (STAFF_ROLE_CHOICES in
// apps/accounts/api/serializers/staff.py), so never offer it here.
const isStaffRole = (name: string) => name !== 'Customer'

const statusLabel: Record<StaffStatus, string> = { active: 'Active', suspended: 'Suspended', invited: 'Invited' }

function StatusBadge({ status }: { status: StaffStatus }) {
  const classes = status === 'active' ? 'bg-emerald-50 text-emerald-700' : status === 'invited' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${classes}`}>{statusLabel[status]}</span>
}

export function StaffManagementPage() {
  const { user } = useAuth()
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [query, setQuery] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [selected, setSelected] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try { setStaff(await listStaff()) } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not load staff accounts.') } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => staff.filter((member) => `${member.first_name} ${member.last_name} ${member.email}`.toLowerCase().includes(query.toLowerCase())), [staff, query])

  async function runAction(id: string, action: () => Promise<unknown>) {
    setActionId(id); setError('')
    try { await action(); await load() } catch (err) { setError(err instanceof ApiError ? err.message : 'The staff action could not be completed.') } finally { setActionId(null) }
  }

  const canManage = user?.permissions.includes('manage_users')
  const canInvite = user?.permissions.includes('manage_users') && user?.permissions.includes('manage_roles')

  return <div className="space-y-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maven-blue">Workforce</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Staff management</h1><p className="mt-2 text-sm text-maven-muted">Manage staff accounts through the verified backend workforce API.</p></div>{canInvite && <button onClick={() => setShowInvite(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-maven-blue px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"><UserPlus className="size-4" /> Invite staff</button>}</div>{error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
<div className="rounded-2xl border border-slate-200 bg-white"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row"><div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5"><Search className="size-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff by name or email" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div><button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"><RefreshCw className="size-4" /> Refresh</button></div>{loading ? <div className="space-y-3 p-5">{[1,2,3,4].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-50" />)}</div> : filtered.length === 0 ? <div className="p-12 text-center"><p className="font-bold text-maven-navy">No staff accounts found</p><p className="mt-1 text-sm text-maven-muted">Try a different search or invite a new staff member.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-400"><th className="px-5 py-3">Staff member</th><th className="px-5 py-3">Roles</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Joined</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody>{filtered.map((member) => <tr key={member.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"><td className="px-5 py-4"><button className="text-left" onClick={() => setSelected(member)}><p className="font-bold text-maven-navy hover:text-maven-blue">{[member.first_name, member.last_name].filter(Boolean).join(' ') || 'Unnamed staff'}</p><p className="mt-0.5 text-xs text-maven-muted">{member.email}</p></button></td><td className="px-5 py-4"><div className="flex max-w-[280px] flex-wrap gap-1">{member.roles.map((role) => <span key={role} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{role}</span>)}</div></td><td className="px-5 py-4"><StatusBadge status={member.status} /></td><td className="px-5 py-4 text-xs font-medium text-slate-500">{new Date(member.date_joined).toLocaleDateString()}</td><td className="px-5 py-4"><div className="flex justify-end gap-2">{member.status === 'active' ? <button disabled={actionId === member.id || !canManage} onClick={() => runAction(member.id, () => suspendStaff(member.id))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"><Pause className="size-3.5" /> Suspend</button> : member.status === 'suspended' ? <button disabled={actionId === member.id || !canManage} onClick={() => runAction(member.id, () => activateStaff(member.id))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"><Play className="size-3.5" /> Activate</button> : <button disabled={actionId === member.id || !canManage} onClick={() => runAction(member.id, () => resendStaffInvitation(member.id))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-maven-blue disabled:opacity-50"><Mail className="size-3.5" /> Resend</button>}<button onClick={() => setSelected(member)} className="grid size-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><MoreHorizontal className="size-4" /></button></div></td></tr>)}</tbody></table></div>}</div>
{showInvite && <InviteStaffModal onClose={() => setShowInvite(false)} onCreated={async () => { setShowInvite(false); await load() }} />}
{selected && <StaffDetailModal staff={selected} onClose={() => setSelected(null)} onUpdated={async () => { setSelected(null); await load() }} />}
</div>
}

function InviteStaffModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { user } = useAuth()
  const [roleCatalog, setRoleCatalog] = useState<Role[]>([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('Support')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    listRoles().then((items) => {
      if (!active) return
      const staffRoles = items.filter((item) => isStaffRole(item.name))
      const allowed = user?.account_type === 'admin' ? staffRoles : staffRoles.filter((item) => item.name !== 'Platform Administrator')
      setRoleCatalog(allowed)
      setRole(allowed[0]?.name ?? '')
    }).catch((err) => {
      if (active) setError(err instanceof ApiError ? err.message : 'Could not load the available staff roles.')
    }).finally(() => { if (active) setRolesLoading(false) })
    return () => { active = false }
  }, [user?.account_type])

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    try { await createStaff({ email, first_name: firstName, last_name: lastName, role }); await onCreated() } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create the invitation.') } finally { setLoading(false) }
  }
  return <Modal title="Invite staff" onClose={onClose}><form onSubmit={submit} className="space-y-4"><p className="text-sm leading-6 text-maven-muted">The backend will create the staff account and invitation. No password is created in this workflow.</p><Field label="Email" value={email} onChange={setEmail} type="email" required /><div className="grid gap-4 sm:grid-cols-2"><Field label="First name" value={firstName} onChange={setFirstName} /><Field label="Last name" value={lastName} onChange={setLastName} /></div><label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">Initial role</span><select disabled={rolesLoading || roleCatalog.length === 0} value={role} onChange={(event) => setRole(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:border-maven-cyan focus:ring-4 focus:ring-cyan-100">{roleCatalog.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>{error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}<ModalActions onClose={onClose} loading={loading || rolesLoading || roleCatalog.length === 0} label={rolesLoading ? 'Loading roles…' : 'Send invitation'} /> </form></Modal>
}

function StaffDetailModal({ staff, onClose, onUpdated }: { staff: StaffUser; onClose: () => void; onUpdated: () => Promise<void> }) {
  const [firstName, setFirstName] = useState(staff.first_name)
  const [lastName, setLastName] = useState(staff.last_name)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedRoles, setSelectedRoles] = useState<string[]>(staff.roles)
  const canManageRoles = useAuth().hasPermission('manage_roles')
  useEffect(() => {
    if (!canManageRoles) return
    Promise.all([listRoles(), getStaffRoles(staff.id)]).then(([roleResult, assignment]) => { setRoles(roleResult.filter((item) => isStaffRole(item.name))); setSelectedRoles(assignment.roles) }).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the role assignment.'))
  }, [canManageRoles, staff.id])
  async function save() { setLoading(true); setError(''); try { await updateStaff(staff.id, { first_name: firstName, last_name: lastName }); if (canManageRoles) await setStaffRoles(staff.id, selectedRoles); await onUpdated() } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not update the staff account.') } finally { setLoading(false) } }
  return <Modal title="Staff account" onClose={onClose}><div className="space-y-5"><div className="flex items-center justify-between gap-3"><div><p className="font-bold text-maven-navy">{staff.email}</p><p className="mt-1 text-xs text-maven-muted">{staff.id}</p></div><StatusBadge status={staff.status} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="First name" value={firstName} onChange={setFirstName} /><Field label="Last name" value={lastName} onChange={setLastName} /></div><div><p className="text-sm font-bold text-slate-700">Roles</p><div className="mt-2 flex flex-wrap gap-2">{staff.roles.map((role) => <span key={role} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-maven-blue">{role}</span>)}</div></div>{canManageRoles && <div><p className="text-sm font-bold text-slate-700">Assigned roles</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{roles.map((role) => { const checked = selectedRoles.includes(role.name); return <label key={role.name} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${checked ? 'border-blue-100 bg-blue-50/60' : 'border-slate-200'}`}><input type="checkbox" checked={checked} onChange={(event) => setSelectedRoles((current) => event.target.checked ? [...current, role.name] : current.length > 1 ? current.filter((item) => item !== role.name) : current)} className="size-4 accent-blue-600" /><span><span className="block text-sm font-bold text-slate-700">{role.name}</span><span className="text-[10px] text-slate-400">{role.permissions.length} permissions</span></span></label> })}</div></div>}<div><p className="text-sm font-bold text-slate-700">Effective permissions</p><div className="mt-2 flex flex-wrap gap-2">{staff.permissions.map((permission) => <span key={permission} className="rounded-full bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">{permission}</span>)}</div></div>{error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}<div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">Close</button><button onClick={save} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-maven-blue px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? 'Saving…' : <><Check className="size-4" /> Save profile</>}</button></div></div></Modal>
}

function Field({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { return <label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">{label}</span><input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:border-maven-cyan focus:bg-white focus:ring-4 focus:ring-cyan-100" /></label> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-7"><div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-black text-maven-navy">{title}</h2><button onClick={onClose} className="grid size-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="size-5" /></button></div>{children}</div></div> }
function ModalActions({ onClose, loading, label }: { onClose: () => void; loading: boolean; label: string }) { return <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">Cancel</button><button disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-maven-blue px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? 'Sending…' : <><Plus className="size-4" /> {label}</>}</button></div> }
