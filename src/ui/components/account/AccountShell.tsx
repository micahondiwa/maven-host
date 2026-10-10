import type { ReactNode } from 'react'
import { NavLink, useNavigate } from '@/lib/navigation'
import { LogOut } from 'lucide-react'
import { CustomerHeader } from '../CustomerHeader'
import { SiteFooter } from '../SiteFooter'
import { useAuth } from '../../lib/auth'

const tabs = [
  { to: '/account', label: 'Dashboard', end: true },
  { to: '/account/expiring', label: 'Expiring Soon' },
  { to: '/account/domains', label: 'Domain List' },
  { to: '/account/hosting', label: 'Hosting List' },
  { to: '/account/private-email', label: 'Private Email' },
  { to: '/account/ssl-certificates', label: 'SSL Certificates' },
  { to: '/account/subscriptions', label: 'My Subscriptions' },
  { to: '/account/offers', label: 'My Offers' },
  { to: '/account/profile', label: 'Profile' },
  { to: '/account/websites', label: 'Websites' },
  { to: '/account/orders', label: 'Orders' },
  { to: '/account/invoices', label: 'Invoices' },
]

export function AccountShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-maven-paper">
      <CustomerHeader />
      <div className="border-b border-maven-line">
        <div className="container-shell flex flex-wrap items-center justify-between gap-4 py-7">
          <div>
            <p className="mono text-xs text-maven-muted">{user?.email}</p>
            <h1 className="mt-1 text-[1.6rem] font-semibold tracking-tight text-maven-ink">{[user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Your account'}</h1>
          </div>
          <button onClick={handleSignOut} className="btn btn-secondary">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </div>
      <div className="container-shell grid gap-7 py-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Account sections" className="panel flex min-w-0 gap-1 overflow-x-auto p-2 text-sm lg:sticky lg:top-52 lg:flex-col lg:overflow-visible">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `shrink-0 whitespace-nowrap rounded-lg px-3 py-2.5 font-semibold transition ${isActive ? 'bg-maven-signal/10 text-maven-signal' : 'text-maven-muted hover:bg-maven-paper hover:text-maven-ink'}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <main id="main-content" className="min-w-0">{children}</main>
      </div>
      <SiteFooter />
    </div>
  )
}
