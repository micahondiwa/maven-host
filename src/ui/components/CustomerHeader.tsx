import { SocialIcon } from './SocialIcon'
import { ThemeToggle } from './ThemeToggle'
import { useTheme } from '../lib/theme'
import { useEffect, useRef, useState } from 'react'

import { Link, useLocation } from '@/lib/navigation'

import { ArrowRightLeft, BookOpen, BookOpenCheck, BriefcaseBusiness, ChevronDown, Code2, Contact, Database, FileText, Globe2, Home, LayoutDashboard, LifeBuoy, Mail, Menu, MessageCircle, Monitor, Search, Server, ShieldCheck, ShoppingCart, Tag, UserRound, Users, WandSparkles, X, type LucideIcon } from 'lucide-react'

import { BrandLogo } from './BrandLogo'

import { useAuth } from '../lib/auth'

import { useCart } from '../lib/cart'

import { CONTACT, SOCIAL_LINKS, isSafeExternalUrl, whatsappUrl } from '../lib/site'

import { MavenAssistant } from './MavenAssistant'



const SOCIALS = ['linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'] as const

type NavLink = { to: string; label: string; description?: string; icon: LucideIcon; group?: string }

type NavEntry = { label: string; icon: LucideIcon; to?: string; rootTo?: string; activePath?: string; activePaths?: string[]; items?: NavLink[] }



const NAV_ENTRIES: NavEntry[] = [
  { to: '/', label: 'Home', icon: Home },
  { label: 'Domains', icon: Globe2, rootTo: '/domains', activePath: '/domains', items: [
    { to: '/domains', label: 'Search a domain', description: 'Find a name and compare available extensions', icon: Search },
    { to: '/domains#domain-transfer-heading', label: 'Transfer a domain', description: 'Check eligibility and transfer requirements', icon: ArrowRightLeft },
    { to: '/account/domains', label: 'Manage domains', description: 'Your purchased domains and supported DNS controls', icon: Globe2 },
  ] },
  { label: 'Hosting', icon: Server, rootTo: '/hosting', activePath: '/hosting', items: [
    { to: '/hosting', label: 'Web hosting', description: 'Cloud hosting plans · checkout opening soon', icon: Monitor },
    { to: '/hosting?category=email', label: 'Email hosting', description: '10 GB mailboxes included with every plan', icon: Mail },
    { to: '/hosting?category=vps', label: 'Managed VPS', description: 'Published configurations · confirm availability', icon: Server },
    { to: '/hosting?category=dedicated', label: 'Dedicated servers', description: 'Starting configurations · confirm stock and licences', icon: Database },
    { to: '/hosting#compare-plans', label: 'Compare all options', description: 'Billing periods, resources and restrictions', icon: Tag },
  ] },
  { label: 'Developers', icon: Code2, rootTo: '/developers', activePath: '/developers', items: [
    { to: '/developers', label: 'Hosting for developers', description: 'Deploy and maintain your own applications', icon: Code2 },
    { to: '/developers#runtime-checklist', label: 'Runtime checklist', description: 'Confirm languages, databases and deployment access', icon: FileText },
    { to: '/developers#engineering-help', label: 'Inara Crest Devs', description: 'Separate application development and engineering help', icon: BriefcaseBusiness },
  ] },
  { label: 'Resources', icon: BookOpen, rootTo: '/blog', activePath: '/blog', activePaths: ['/blog', '/services', '/ai-builder', '/careers'], items: [
    { to: '/blog', label: 'Blogs', description: 'Published guides on building and operating websites', icon: BookOpen },
    { to: '/help-center#guides', label: 'Setup guides', description: 'Domain, DNS and hosting guidance', icon: BookOpenCheck },
    { to: '/services', label: 'Services overview', description: 'What MavenHost provides and where support starts', icon: Globe2 },
    { to: '/ai-builder', label: 'AI website drafts', description: 'Draft pages and copy; review before using them', icon: WandSparkles },
    { to: '/careers', label: 'Careers and partnerships', description: 'Contact the team about working together', icon: Users },
  ] },
  { label: 'Support', icon: LifeBuoy, rootTo: '/help-center', activePath: '/help-center', activePaths: ['/help-center', '/contact'], items: [
    { to: '/help-center', label: 'Help centre', description: 'Practical answers and setup guidance', icon: LifeBuoy },
    { to: '/contact?type=support', label: 'Get hosting support', description: 'Help with a purchased domain, account or service', icon: Mail },
    { to: '/contact?type=general', label: 'Help choosing a service', description: 'Discuss a plan, transfer or proposed workload', icon: Contact },
    { to: '/help-center#platform-status', label: 'Service status guidance', description: 'Where to check order progress and report a problem', icon: ShieldCheck },
  ] },
]

type AccountEntry = { label: string; to: string; icon: LucideIcon }

const ACCOUNT_ENTRIES: AccountEntry[] = [
  { label: 'Dashboard', to: '/account', icon: LayoutDashboard },
  { label: 'Expiring Soon', to: '/account/expiring', icon: FileText },
  { label: 'Domain List', to: '/account/domains', icon: Globe2 },
  { label: 'Hosting List', to: '/account/hosting', icon: Server },
  { label: 'Private Email', to: '/account/private-email', icon: Mail },
  { label: 'SSL Certificates', to: '/account/ssl-certificates', icon: ShieldCheck },
  { label: 'My Subscriptions', to: '/account/subscriptions', icon: FileText },
  { label: 'My Offers', to: '/account/offers', icon: Tag },
  { label: 'Profile', to: '/account/profile', icon: UserRound },
] as const

const HELP_ENTRIES = [
  { label: 'Knowledge Base', to: '/help-center', icon: BookOpenCheck, description: 'Answers for orders, domains, hosting and accounts' },
  { label: 'DNS & Nameservers', to: '/help-center#dns-and-nameservers', icon: Database, description: 'Understand DNS records, delegation and safe changes' },
  { label: 'Guides', to: '/help-center#guides', icon: BookOpen, description: 'Step-by-step setup and troubleshooting' },
  { label: 'Blog', to: '/blog', icon: FileText, description: 'Technical articles across stacks and services' },
  { label: 'Status Updates', to: '/help-center#platform-status', icon: ShieldCheck, description: 'Service notices and incident support' },
] as const


export function CustomerHeader(_props: { dark?: boolean }) {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const [hoverMenu, setHoverMenu] = useState<string | null>(null)

  const { user } = useAuth()

  const { itemCount } = useCart()

  const location = useLocation()

  const [menuOpen, setMenuOpen] = useState(false)

  const [openDropdown, setOpenDropdown] = useState<string | null>(null)

  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null)

  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false)

  const [helpDropdownOpen, setHelpDropdownOpen] = useState(false)

  const headerRef = useRef<HTMLDivElement>(null)





  useEffect(() => {

    setOpenDropdown(null)
    setHoverMenu(null)

    setAccountDropdownOpen(false)

    setHelpDropdownOpen(false)

    setOpenMobileGroup(null)

    setMenuOpen(false)

  }, [location.pathname, location.search, location.hash])



  useEffect(() => {

    function dismissOnOutsideClick(event: PointerEvent) {

      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) { setOpenDropdown(null); setAccountDropdownOpen(false); setHelpDropdownOpen(false); setHoverMenu(null); setMenuOpen(false); setOpenMobileGroup(null) }

    }

    document.addEventListener('pointerdown', dismissOnOutsideClick)

    return () => document.removeEventListener('pointerdown', dismissOnOutsideClick)

  }, [])



  const isActive = (to: string) => {

    // Only the path, hash and query are compared, so a fixed base keeps this safe during server rendering.
    const destination = new URL(to, 'http://localhost')

    const pathname = destination.pathname

    if (pathname === '/') return location.pathname === '/' && (!destination.hash || location.hash === destination.hash)

    if (location.pathname !== pathname && !location.pathname.startsWith(`${pathname}/`)) return false

    if (destination.hash && location.hash !== destination.hash) return false

    for (const [key, value] of destination.searchParams) {

      if (new URLSearchParams(location.search).get(key) !== value) return false

    }

    return true

  }



  const navLinkClass = (active: boolean) => active

    ? `shrink-0 whitespace-nowrap relative rounded-lg px-1 py-3 text-[13px] xl:px-2 xl:text-[14px] after:absolute after:inset-x-2 after:-bottom-4 after:h-[3px] after:rounded-full after:bg-maven-signal font-semibold transition ${dark ? 'bg-white/10 text-maven-bright ring-1 ring-white/10' : 'bg-maven-signal/10 text-maven-signal'}`

    : `shrink-0 whitespace-nowrap rounded-lg px-1 py-3 text-[13px] xl:px-2 xl:text-[14px] font-medium transition ${dark ? 'text-white/85 hover:bg-white/8 hover:text-white' : 'text-maven-ink hover:bg-maven-signal/5 hover:text-maven-signal'}`



  const subItemActive = (to: string) => {
    if (!isActive(to)) return false
    const target = new URL(to, window.location.origin)
    if (target.pathname === '/hosting' && !target.search && !target.hash) return !new URLSearchParams(location.search).get('category') || new URLSearchParams(location.search).get('category') === 'shared'
    return true
  }
  const entryActive = (entry: NavEntry) => (entry.activePaths ?? [entry.to ?? entry.activePath ?? '']).some(path => isActive(path))
  const routeSection = NAV_ENTRIES.find((entry) => entry.items && entryActive(entry))
  const submenuLabel = accountDropdownOpen ? 'Account' : helpDropdownOpen ? 'Help Center' : openDropdown ?? routeSection?.label ?? (location.pathname.startsWith('/account') ? 'Account' : location.pathname.startsWith('/help-center') ? 'Help Center' : null)
  const submenuItems: NavLink[] = submenuLabel === 'Account'
    ? ACCOUNT_ENTRIES.map((entry) => ({ ...entry, to: user ? entry.to : '/login' }))
    : submenuLabel === 'Help Center' ? [...HELP_ENTRIES]
    : NAV_ENTRIES.find((entry) => entry.label === submenuLabel)?.items ?? []
  function selectSubmenu(label: string) {
    setOpenDropdown(label === 'Account' || label === 'Help Center' ? null : label)
    setAccountDropdownOpen(label === 'Account')
    setHelpDropdownOpen(label === 'Help Center')
  }

  function closeMobileMenu() {

    setMenuOpen(false)

    setOpenMobileGroup(null)

  }



  return (

    <>

      <div ref={headerRef} className="sticky top-0 z-30" onKeyDown={(event) => { if (event.key === 'Escape') { setOpenDropdown(null); setAccountDropdownOpen(false); setHelpDropdownOpen(false); setHoverMenu(null); setMenuOpen(false); setOpenMobileGroup(null) } }}>
        <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="border-b border-white/10 bg-[#0B4C72] py-1.5 text-white">

        <div className="container-shell flex items-center justify-between gap-2 sm:gap-4">

          <div className="flex items-center gap-1 sm:gap-3">

            {SOCIALS.map((key) => {

              const link = SOCIAL_LINKS.find((item) => item.key === key)

              if (!link || !isSafeExternalUrl(link.href)) return null

              return (

                <a key={key} href={link.href} target="_blank" rel="noreferrer" aria-label={link.label} className="grid size-6 place-items-center text-white transition hover:text-maven-bright">

                  <SocialIcon name={key} />

                </a>

              )

            })}

          </div>

          <div className="flex items-center gap-2 text-[12px] sm:gap-4 font-medium text-white/65">

            <a href={CONTACT.emailHref} className="hidden items-center gap-1.5 transition hover:text-maven-bright sm:inline-flex">

              <Mail className="size-3.5" /> {CONTACT.email}

            </a>

            <a href={whatsappUrl()} target="_blank" rel="noreferrer noopener" aria-label="Contact MavenHost on WhatsApp" className="inline-flex items-center gap-1.5 transition hover:text-maven-bright">

              <MessageCircle className="size-3.5" /> WhatsApp

            </a>
            <ThemeToggle onDark />



          </div>

        </div>

      </div>

      <header className={`relative site-header site-header-light nav-strip-white border-b ${dark ? 'border-white/10 bg-maven-ink/95' : 'border-maven-line bg-maven-surface/95'} backdrop-blur`} onMouseLeave={() => setHoverMenu(null)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHoverMenu(null); setMenuOpen(false); setOpenMobileGroup(null) }}>

        <div className="container-shell flex min-h-[80px] items-center gap-4 py-3 lg:gap-4 min-[1440px]:gap-10">

          <Link to="/" className="shrink-0" onClick={() => setMenuOpen(false)}>

            <BrandLogo compact />

          </Link>

          <nav onKeyDown={(event) => { if (event.key === 'Escape') setOpenDropdown(null) }} className="hidden min-w-0 flex-1 flex-nowrap items-center justify-start gap-0 text-[12px] xl:gap-2 font-medium text-white/75 lg:flex" aria-label="Primary navigation">

            {NAV_ENTRIES.map((entry) => {
              const active = entryActive(entry)
              if (entry.to) return <Link key={entry.label} to={entry.to} onMouseEnter={() => setHoverMenu(null)} aria-current={active ? 'page' : undefined} className={navLinkClass(active)}>{entry.label}</Link>
              const expanded = submenuLabel === entry.label
              return <div key={entry.label} className={`inline-flex items-center ${navLinkClass(active || expanded)}`} onMouseEnter={() => { selectSubmenu(entry.label); setHoverMenu(entry.label) }}>
                <Link to={entry.rootTo ?? '/'} aria-current={active ? 'page' : undefined} className="whitespace-nowrap" onFocus={() => { selectSubmenu(entry.label); setHoverMenu(entry.label) }}>{entry.label}</Link>
                <button type="button" aria-label={`Show ${entry.label} options`} aria-expanded={expanded} aria-controls="persistent-section-navigation" onFocus={() => { selectSubmenu(entry.label); setHoverMenu(entry.label) }} onClick={() => { selectSubmenu(entry.label); setHoverMenu(entry.label) }} className="inline-flex items-center pl-1"><ChevronDown className="size-3" /></button>
              </div>
            })}

            {user && (

              <Link

                to="/account/orders"

                aria-current={location.pathname.startsWith('/account/orders') ? 'page' : undefined}

                className={navLinkClass(location.pathname.startsWith('/account/orders'))}

              >

                Orders

              </Link>

            )}

          </nav>

          <div className="header-actions ml-auto flex shrink-0 items-center gap-1 border-l border-maven-line pl-3">

            <Link

              to="/cart"

              className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[13px] font-semibold transition ${isActive('/cart') ? 'bg-white/10 text-maven-bright ring-1 ring-maven-bright/40' : 'text-white hover:bg-white/10'}`}

              aria-label="Cart"

              aria-current={isActive('/cart') ? 'page' : undefined}

            >

              <ShoppingCart className="size-4" />

              <span className="hidden sm:inline">Cart</span>

              {itemCount > 0 && <span className="mono text-[12px] text-maven-bright">{itemCount}</span>}

            </Link>

            {user ? <>
            <button type="button" aria-label="Account" aria-expanded={submenuLabel === 'Account'} aria-controls="persistent-section-navigation" onMouseEnter={() => { selectSubmenu('Account'); setHoverMenu('Account') }} onFocus={() => { selectSubmenu('Account'); setHoverMenu('Account') }} onClick={() => { selectSubmenu('Account'); setHoverMenu('Account') }} className="hidden items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-[13px] font-semibold lg:inline-flex"><UserRound className="size-4" /><span className="hidden min-[1440px]:inline">Account</span><ChevronDown className="size-3" /></button>
            </> : <><Link to="/login" className="hidden items-center gap-1 rounded-lg px-2 py-2 text-[13px] font-semibold lg:inline-flex"><UserRound className="size-4" />Sign in</Link><Link to="/register" className="btn btn-primary hidden px-3 py-2 text-xs xl:inline-flex">Get started</Link></>}
            <button type="button" aria-label="Help Center" aria-expanded={submenuLabel === 'Help Center'} aria-controls="persistent-section-navigation" onMouseEnter={() => { selectSubmenu('Help Center'); setHoverMenu('Help Center') }} onFocus={() => { selectSubmenu('Help Center'); setHoverMenu('Help Center') }} onClick={() => { selectSubmenu('Help Center'); setHoverMenu('Help Center') }} className="hidden items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-[13px] font-medium"><LifeBuoy className="size-4" /><span className="hidden min-[1440px]:inline">Help Center</span><ChevronDown className="size-3" /></button>
            <button

              onClick={() => setMenuOpen((v) => !v)}

              aria-label={menuOpen ? 'Close menu' : 'Open menu'}

              aria-expanded={menuOpen}

              aria-controls="mobile-primary-navigation"

              className="ml-1 flex items-center rounded-lg p-2 text-white transition hover:bg-white/10 lg:hidden"

            >

              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}

            </button>

          </div>

        </div>



        {hoverMenu && <div className={`absolute inset-x-0 top-[80px] z-50 hidden border-y shadow-xl lg:block ${dark ? 'border-white/10 bg-maven-ink' : 'border-maven-line bg-maven-surface'}`}>
          <nav aria-label={`${hoverMenu} hover menu`} className="container-shell max-h-[calc(100dvh-180px)] overflow-y-auto py-5">
            <p className="mb-3 text-sm font-semibold text-maven-text">Explore {hoverMenu}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(hoverMenu === 'Account' ? ACCOUNT_ENTRIES.map((item) => ({ ...item, to: user ? item.to : '/login' })) : hoverMenu === 'Help Center' ? [...HELP_ENTRIES] : NAV_ENTRIES.find((entry) => entry.label === hoverMenu)?.items ?? []).map((item) => {
                const Icon = item.icon
                return <Link key={item.label} to={item.to} onClick={() => setHoverMenu(null)} className="flex items-start gap-3 rounded-xl px-3 py-3 text-maven-text transition hover:bg-maven-signal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-maven-signal"><Icon className="mt-0.5 size-5 shrink-0 text-maven-signal" /><span><span className="block text-sm font-semibold">{item.label}</span>{'description' in item && <span className="mt-1 block text-xs leading-5 text-maven-muted">{item.description}</span>}</span></Link>
              })}
            </div>
          </nav>
        </div>}

        {submenuLabel && submenuItems.length > 0 && <div className={`hidden border-t lg:block ${dark ? 'border-white/10 bg-maven-ink' : 'border-maven-line bg-maven-surface'}`}>
          <nav id="persistent-section-navigation" aria-label={`${submenuLabel} options`} className="container-shell flex items-center gap-6 overflow-x-auto py-3 [scrollbar-width:thin]">
            {submenuItems.map((item) => {
              const Icon = item.icon
              const active = subItemActive(item.to)
              return <Link key={`${item.label}-${item.to}`} to={item.to} aria-current={active ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-1 py-1 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-maven-signal ${dark ? active ? 'text-maven-bright' : 'text-white/85 hover:text-maven-bright' : active ? 'text-maven-signal' : 'text-maven-ink hover:text-maven-signal'}`}><Icon className={`size-4 ${dark ? 'text-maven-bright' : 'text-maven-signal'}`} />{item.label}</Link>
            })}
          </nav>
        </div>}

        {menuOpen && (

          <div className={`lg:hidden ${dark ? 'border-t border-white/10 bg-maven-ink' : 'border-t border-maven-line bg-maven-paper'}`}>

            <nav id="mobile-primary-navigation" className="container-shell flex max-h-[calc(100dvh-8rem)] flex-col overflow-y-auto py-3" aria-label="Mobile primary navigation">

              {NAV_ENTRIES.map((entry) => {

                const active = entryActive(entry)

                const EntryIcon = entry.icon

                if (entry.to) return <Link key={entry.label} to={entry.to} onClick={closeMobileMenu} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-semibold ${active ? 'bg-maven-bright text-maven-ink' : dark ? 'text-white/90 hover:bg-white/5 hover:text-white' : 'text-maven-ink hover:bg-maven-paper'}`}><EntryIcon className={`size-4 ${active ? '' : dark ? 'text-white/55' : 'text-maven-muted'}`} />{entry.label}</Link>



                const expanded = openMobileGroup === entry.label

                const groupId = `mobile-nav-${entry.label.toLowerCase().replaceAll(' ', '-')}`

                return <div key={entry.label} className={`rounded-xl ${active ? dark ? 'bg-white/[0.04]' : 'bg-maven-paper' : ''}`}>

                  <button type="button" aria-expanded={expanded} aria-controls={groupId} onClick={() => setOpenMobileGroup(expanded ? null : entry.label)} className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[15px] font-semibold ${active ? dark ? 'text-maven-bright' : 'text-maven-signal' : dark ? 'text-white/90 hover:bg-white/5 hover:text-white' : 'text-maven-ink hover:bg-maven-paper'}`}>

                    <span className="flex items-center gap-3"><EntryIcon className={`size-4 ${active ? '' : dark ? 'text-white/55' : 'text-maven-muted'}`} />{entry.label}</span><ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />

                  </button>

                  {expanded && <div id={groupId} className={`space-y-1 border-l py-1 pl-3 ${dark ? 'ml-4 border-white/15' : 'ml-4 border-maven-line'}`}>

                    {entry.items?.map((item) => {

                      const ItemIcon = item.icon

                      const itemActive = isActive(item.to)

                      return <Link key={`${item.to}-${item.label}`} to={item.to} onClick={closeMobileMenu} aria-current={itemActive ? 'page' : undefined} className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${itemActive ? dark ? 'bg-white/10 text-maven-bright' : 'bg-maven-signal/10 text-maven-signal' : dark ? 'text-white/75 hover:bg-white/5 hover:text-white' : 'text-maven-ink hover:bg-white'}`}>

                      <ItemIcon className={`mt-0.5 size-4 shrink-0 ${itemActive ? '' : dark ? 'text-white/50' : 'text-maven-muted'}`} /><span className="block text-sm font-medium">{item.label}{item.description && <span className={`mt-0.5 block text-xs font-normal leading-5 ${dark ? 'text-white/55' : 'text-maven-muted'}`}>{item.description}</span>}</span>

                    </Link>})}

                  </div>}

                </div>

              })}

                            {!user && <div className="my-3 grid grid-cols-2 gap-3"><Link to="/login" onClick={closeMobileMenu} className="btn btn-secondary">Sign in</Link><Link to="/register" onClick={closeMobileMenu} className="btn btn-primary">Get started</Link></div>}
{user ? (

                <>

                  <Link to="/account/orders" onClick={() => setMenuOpen(false)} aria-current={location.pathname.startsWith('/account/orders') ? 'page' : undefined} className="rounded-lg px-3 py-3 text-[15px] font-semibold text-white/85 hover:bg-white/5 hover:text-white">Orders</Link>

                  <div className="mt-1 border-t border-white/10 pt-2">
                    <button type="button" aria-expanded={openMobileGroup === 'Help Center'} aria-controls="mobile-help-menu" onClick={() => setOpenMobileGroup(openMobileGroup === 'Help Center' ? null : 'Help Center')} className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[15px] font-semibold text-white/90 hover:bg-white/5"><span className="flex items-center gap-3"><LifeBuoy className="size-4 text-white/55" />Help Center</span><ChevronDown className={`size-4 transition-transform ${openMobileGroup === 'Help Center' ? 'rotate-180' : ''}`} /></button>
                    {openMobileGroup === 'Help Center' && <div id="mobile-help-menu" className="ml-4 space-y-1 border-l border-white/15 py-1 pl-3"><Link to="/help-center" onClick={closeMobileMenu} aria-current={isActive('/help-center') ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${isActive('/help-center') ? 'bg-white/10 text-maven-bright' : 'text-white/85 hover:bg-white/5 hover:text-white'}`}><LifeBuoy className="size-4 shrink-0" />All Help Center</Link>{HELP_ENTRIES.map((entry) => { const EntryIcon = entry.icon; const active = isActive(entry.to); return <Link key={entry.label} to={entry.to} onClick={closeMobileMenu} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? 'bg-white/10 text-maven-bright' : 'text-white/75 hover:bg-white/5 hover:text-white'}`}><EntryIcon className="size-4 shrink-0" />{entry.label}</Link> })}</div>}
                  </div>
                  <div className="mt-1 border-t border-white/10 pt-2">
                    <button type="button" aria-expanded={openMobileGroup === 'Account'} aria-controls="mobile-account-menu" onClick={() => setOpenMobileGroup(openMobileGroup === 'Account' ? null : 'Account')} className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[15px] font-semibold text-white/90 hover:bg-white/5"><span className="flex items-center gap-3"><UserRound className="size-4 text-white/55" />Account</span><ChevronDown className={`size-4 transition-transform ${openMobileGroup === 'Account' ? 'rotate-180' : ''}`} /></button>
                    {openMobileGroup === 'Account' && <div id="mobile-account-menu" className="ml-4 space-y-1 border-l border-white/15 py-1 pl-3">{ACCOUNT_ENTRIES.map((entry) => {
                      const EntryIcon = entry.icon
                      const active = user && (entry.to === '/account' ? location.pathname === '/account' : isActive(entry.to))
                      return <Link key={entry.label} to={user ? entry.to : '/login'} onClick={closeMobileMenu} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? 'bg-white/10 text-maven-bright' : 'text-white/75 hover:bg-white/5 hover:text-white'}`}><EntryIcon className="size-4 shrink-0" />{entry.label}</Link>
                    })}</div>}
                  </div>

                </>

              ) : (

                <div className="mt-2 flex flex-col border-t border-white/10 pt-2">
                  <div className="mt-1 border-t border-white/10 pt-2">
                    <button type="button" aria-expanded={openMobileGroup === 'Help Center'} aria-controls="mobile-help-menu" onClick={() => setOpenMobileGroup(openMobileGroup === 'Help Center' ? null : 'Help Center')} className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[15px] font-semibold text-white/90 hover:bg-white/5"><span className="flex items-center gap-3"><LifeBuoy className="size-4 text-white/55" />Help Center</span><ChevronDown className={`size-4 transition-transform ${openMobileGroup === 'Help Center' ? 'rotate-180' : ''}`} /></button>
                    {openMobileGroup === 'Help Center' && <div id="mobile-help-menu" className="ml-4 space-y-1 border-l border-white/15 py-1 pl-3"><Link to="/help-center" onClick={closeMobileMenu} aria-current={isActive('/help-center') ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${isActive('/help-center') ? 'bg-white/10 text-maven-bright' : 'text-white/85 hover:bg-white/5 hover:text-white'}`}><LifeBuoy className="size-4 shrink-0" />All Help Center</Link>{HELP_ENTRIES.map((entry) => { const EntryIcon = entry.icon; const active = isActive(entry.to); return <Link key={entry.label} to={entry.to} onClick={closeMobileMenu} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? 'bg-white/10 text-maven-bright' : 'text-white/75 hover:bg-white/5 hover:text-white'}`}><EntryIcon className="size-4 shrink-0" />{entry.label}</Link> })}</div>}
                  </div>
                  <div className="mt-1 border-t border-white/10 pt-2">
                    <button type="button" aria-expanded={openMobileGroup === 'Account'} aria-controls="mobile-account-menu" onClick={() => setOpenMobileGroup(openMobileGroup === 'Account' ? null : 'Account')} className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[15px] font-semibold text-white/90 hover:bg-white/5"><span className="flex items-center gap-3"><UserRound className="size-4 text-white/55" />Account</span><ChevronDown className={`size-4 transition-transform ${openMobileGroup === 'Account' ? 'rotate-180' : ''}`} /></button>
                    {openMobileGroup === 'Account' && <div id="mobile-account-menu" className="ml-4 space-y-1 border-l border-white/15 py-1 pl-3">{ACCOUNT_ENTRIES.map((entry) => { const EntryIcon = entry.icon; return <Link key={entry.label} to="/login" onClick={closeMobileMenu} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/75 hover:bg-white/5 hover:text-white"><EntryIcon className="size-4 shrink-0" />{entry.label}</Link> })}</div>}
                  </div>
                </div>

              )}

            </nav>

          </div>

        )}

      </header>
      </div>

      <MavenAssistant />

    </>

  )

}
