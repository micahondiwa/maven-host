import { ThemeToggle } from '../ThemeToggle'
import { BrandLogo } from '../BrandLogo'
import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from '@/lib/navigation'
import { ChevronLeft, ChevronRight, LogOut, Menu, ShieldCheck, Users, X, LayoutDashboard } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { SiteFooter } from '../SiteFooter'

const navigation = [
  { to: '/staff', label: 'Dashboard', icon: LayoutDashboard, permission: null, end: true },
  { to: '/staff/customers', label: 'Customers', icon: Users, permission: 'view_customer' },
  { to: '/staff/team', label: 'Staff', icon: Users, permission: 'manage_users' },
  { to: '/staff/roles', label: 'Roles & permissions', icon: ShieldCheck, permission: 'manage_roles' },
]

export function StaffShell({ children }: { children: ReactNode }) {
  const { user, signOut, hasPermission } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'Staff'
  const visibleNavigation = navigation.filter((item) => !item.permission || hasPermission(item.permission))

  async function handleSignOut() {
    await signOut()
    navigate('/staff/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-maven-surface text-maven-navy">
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-maven-surface transition-all duration-200 ${collapsed ? 'w-[78px]' : 'w-[270px]'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex h-[76px] items-center justify-between border-b border-white/10 bg-maven-ink px-5">
          <NavLink to="/staff" className="flex min-w-0 items-center gap-3" onClick={() => setMobileOpen(false)}>
            {collapsed ? <img src="/brand/mavenhost-favicon.svg?v=inara-20261004" alt="MavenHost" className="size-10 shrink-0" /> : <span className="min-w-0"><BrandLogo light compact /><span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.16em] text-white/70">Staff portal</span></span>}
          </NavLink>
          <button className="rounded-lg p-2 text-white/70 hover:bg-white/10 lg:hidden" onClick={() => setMobileOpen(false)}><X className="size-5" /></button>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Staff navigation">
          {visibleNavigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)} className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${isActive ? 'bg-blue-50 text-maven-blue' : 'text-slate-600 hover:bg-slate-50 hover:text-maven-navy'} ${collapsed ? 'justify-center' : ''}`} title={collapsed ? label : undefined}>
              <Icon className="size-5 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-maven-line p-3">
          {!collapsed && <div className="mb-3 rounded-xl bg-slate-50 p-3"><p className="truncate text-sm font-bold text-maven-navy">{displayName}</p><p className="truncate text-xs text-maven-muted">{user?.email}</p><div className="mt-2 flex flex-wrap gap-1">{user?.roles.map((role) => <span key={role} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">{role}</span>)}</div></div>}
          <button onClick={handleSignOut} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-700 ${collapsed ? 'justify-center' : ''}`} title={collapsed ? 'Sign out' : undefined}><LogOut className="size-5 shrink-0" />{!collapsed && 'Sign out'}</button>
        </div>
        <button onClick={() => setCollapsed((value) => !value)} className="absolute -right-3 top-[86px] hidden size-7 place-items-center rounded-full border border-maven-line bg-maven-surface text-slate-500 shadow-sm hover:text-maven-blue lg:grid" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}</button>
      </aside>

      <div className={`min-h-screen transition-all duration-200 ${collapsed ? 'lg:pl-[78px]' : 'lg:pl-[270px]'}`}>
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-maven-line bg-maven-paper/90 px-4 backdrop-blur-xl sm:px-6">
          <button className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-6" /></button>
          <div className="hidden lg:block"><p className="text-xs font-bold uppercase tracking-[0.16em] text-maven-muted">Staff control plane</p><p className="text-sm font-semibold text-slate-700">Operational access managed by backend authorization</p></div>
          <div className="ml-auto flex items-center gap-3"><span className="hidden rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-maven-blue sm:inline-flex">{user?.account_type === 'admin' ? 'Platform admin' : 'Staff'}</span><div className="grid size-9 place-items-center rounded-full bg-maven-navy text-sm font-black text-white">{(user?.first_name || user?.email || 'S').slice(0, 1).toUpperCase()}</div><ThemeToggle /></div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">{children}</main>
        <SiteFooter />
      </div>
    </div>
  )
}
