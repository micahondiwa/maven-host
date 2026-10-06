import { useEffect, useState } from 'react'
import { ArrowRight, KeyRound, ShieldCheck, Users, Workflow } from 'lucide-react'
import { Link } from '@/lib/navigation'
import { listRoles, listStaff, type Role, type StaffUser } from '../../lib/api'
import { useAuth } from '../../lib/auth'

function StatCard({ icon: Icon, label, value, description }: { icon: typeof Users; label: string; value: string | number; description: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-maven-blue"><Icon className="size-5" /></span></div><p className="mt-5 text-3xl font-black tracking-tight text-maven-navy">{value}</p><p className="mt-1 text-sm font-bold text-slate-700">{label}</p><p className="mt-1 text-xs leading-5 text-maven-muted">{description}</p></div>
}

export function StaffDashboardPage() {
  const { user, hasPermission } = useAuth()
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [staffResult, rolesResult] = await Promise.all([
          hasPermission('manage_users') ? listStaff() : Promise.resolve([] as StaffUser[]),
          hasPermission('manage_roles') ? listRoles() : Promise.resolve([] as Role[]),
        ])
        if (active) { setStaff(staffResult); setRoles(rolesResult) }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load the staff overview.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [hasPermission])

  const activeCount = staff.filter((member) => member.status === 'active').length
  const pendingCount = staff.filter((member) => member.status === 'invited').length

  return <div className="space-y-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maven-blue">Overview</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Good to see you, {user?.first_name || 'there'}.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-maven-muted">This control plane only presents information returned by the backend and actions allowed by your effective permissions.</p></div></div>{error && <div role="alert" className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div>}{loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((item) => <div key={item} className="h-40 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />)}</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><StatCard icon={Users} label="Staff accounts" value={hasPermission('manage_users') ? staff.length : '—'} description={hasPermission('manage_users') ? `${activeCount} active · ${pendingCount} invited` : 'Requires user-management permission'} /><StatCard icon={ShieldCheck} label="Defined roles" value={hasPermission('manage_roles') ? roles.length : '—'} description="Authoritative role catalog from Django" /><StatCard icon={KeyRound} label="Effective permissions" value={user?.permissions.length ?? 0} description="Calculated by the backend for this session" /><StatCard icon={Workflow} label="Access plane" value={user?.account_type === 'admin' ? 'Admin + Staff' : 'Staff'} description="Current authenticated account classification" /></div>}

<div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]"><section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-black">Your access</h2><p className="mt-1 text-sm text-maven-muted">Roles and permissions are server-derived.</p></div><ShieldCheck className="size-5 text-maven-cyan" /></div><div className="mt-5 flex flex-wrap gap-2">{user?.roles.length ? user.roles.map((role) => <span key={role} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">{role}</span>) : <span className="text-sm text-maven-muted">No staff roles returned.</span>}</div><div className="mt-6 border-t border-slate-100 pt-5"><p className="text-xs font-bold uppercase tracking-[0.15em] text-maven-muted">Permissions</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{user?.permissions.map((permission) => <div key={permission} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">{permission}</div>)}</div></div></section>
<section className="rounded-2xl border border-slate-200 bg-maven-navy p-6 text-white"><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Next action</p><h2 className="mt-3 text-2xl font-black tracking-tight">Manage the workforce</h2><p className="mt-3 text-sm leading-6 text-slate-300">Invite staff, review status, change profiles, manage roles and perform allowed lifecycle actions.</p>{hasPermission('manage_users') && <Link to="/staff/team" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-maven-navy">Open staff management <ArrowRight className="size-4" /></Link>}</section></div></div>
}
