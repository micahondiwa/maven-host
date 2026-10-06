import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@/lib/navigation'
import { ArrowRight, CalendarClock, LoaderCircle, Mail, ShieldCheck, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { listHostingSubscriptions, type HostingSubscription, ApiError, getCustomerProfile, listMyDomains, listMyHostingAccounts, listOrders, updateCustomerProfile, type CustomerProfile, type MyDomain, type MyHostingAccountSummary, type OrderSummary } from '../../lib/api'

const day = 24 * 60 * 60 * 1000

export function ExpiringSoonPage() {
  const [domains, setDomains] = useState<MyDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    listMyDomains().then(setDomains).catch((e) => setError(e instanceof ApiError ? e.message : 'We could not load domain expiry information.')).finally(() => setLoading(false))
  }, [])
  if (loading) return <Loading label="Checking domain expiry dates…" />
  if (error) return <ErrorMessage message={error} />
  const soon = domains.filter((domain) => domain.expires_at && new Date(`${domain.expires_at}T23:59:59`).getTime() <= Date.now() + 30 * day).sort((a, b) => (a.expires_at ?? '').localeCompare(b.expires_at ?? ''))
  return <section className="max-w-4xl">
    <p className="text-sm leading-6 text-maven-muted">Domains with a recorded expiry date in the past or in the next 30 days appear here. Hosting renewal dates are not currently exposed by the hosting account data.</p>
    {soon.length ? <div className="panel mt-5 divide-y divide-maven-line">{soon.map((domain) => {
      const daysLeft = Math.ceil((new Date(`${domain.expires_at}T23:59:59`).getTime() - Date.now()) / day)
      return <Link key={domain.id} to={`/account/domains/${domain.id}`} className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-black/[0.025]"><div><p className="mono font-semibold text-maven-ink">{domain.domain_name}</p><p className="mt-1 text-sm text-maven-muted">Expires {domain.expires_at}{domain.auto_renew ? ' · auto-renew is on' : ''}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${daysLeft < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{daysLeft < 0 ? `${Math.abs(daysLeft)} days past` : daysLeft === 0 ? 'Expires today' : `${daysLeft} days left`}</span></Link>
    })}</div> : <div className="panel mt-5 p-6"><div className="flex items-start gap-3"><CalendarClock className="mt-0.5 size-5 text-maven-signal"/><div><h2 className="font-semibold text-maven-ink">No domains due in the next 30 days</h2><p className="mt-1 text-sm leading-6 text-maven-muted">{domains.length ? 'Your recorded domain dates are outside this window, or the registrar has not supplied an expiry date.' : 'Your account does not have any registered domains yet.'}</p><Link to="/account/domains" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-maven-signal">View domain list <ArrowRight className="size-4"/></Link></div></div></div>}
  </section>
}

export function AccountServicePage({ section }: { section: 'email' | 'ssl' | 'subscriptions' | 'offers' }) {
  const [domains, setDomains] = useState<MyDomain[]>([])
  const [hosting, setHosting] = useState<MyHostingAccountSummary[]>([])
  const [subscriptions, setSubscriptions] = useState<HostingSubscription[]>([])
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([listMyDomains(), listMyHostingAccounts(), listOrders(), listHostingSubscriptions()])
      .then(([d, h, o, subscriptions]) => { setDomains(d); setHosting(h); setOrders(o); setSubscriptions(subscriptions) })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'We could not load your account services.'))
      .finally(() => setLoading(false))
  }, [])
  if (loading) return <Loading label="Loading your services…" />
  if (error) return <ErrorMessage message={error} />

  if (section === 'email') return <section className="max-w-4xl">
    <InfoCard icon={Mail} title="Business email for your domains" description="MavenHost Business Email plans are listed with hosting. Mailbox creation and day-to-day settings are managed from the control panel for the hosting service that includes your email plan." />
    <h2 className="mt-7 font-semibold text-maven-ink">Your hosting services</h2>
    {hosting.length ? <div className="panel mt-3 divide-y divide-maven-line">{hosting.map((account) => <Link key={account.account_id} to={`/account/hosting/${account.account_id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-black/[0.025]"><span><span className="block font-semibold text-maven-ink">{account.package_name}</span><span className="mono mt-1 block text-sm text-maven-muted">{account.primary_domain}</span></span><span className="inline-flex items-center gap-1 text-sm font-semibold text-maven-signal">Open account <ArrowRight className="size-4"/></span></Link>)}</div> : <EmptyService text="No hosting accounts are linked to your account yet." link="Browse email and hosting plans" to="/hosting?category=email" />}
    <p className="mt-4 text-sm text-maven-muted">If your email service was purchased separately or you cannot find its control panel, <Link to="/contact?type=support" className="font-semibold text-maven-signal">contact support</Link> and include the domain name.</p>
  </section>

  if (section === 'ssl') return <section className="max-w-4xl">
    <InfoCard icon={ShieldCheck} title="SSL for your websites" description="SSL availability is a feature of the hosting plan. Certificate installation and site-level checks are handled with the hosting service; this dashboard does not currently receive certificate issuance or renewal status from the provider." />
    <h2 className="mt-7 font-semibold text-maven-ink">Your hosting services</h2>
    {hosting.length ? <div className="panel mt-3 divide-y divide-maven-line">{hosting.map((account) => <Link key={account.account_id} to={`/account/hosting/${account.account_id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-black/[0.025]"><span><span className="block font-semibold text-maven-ink">{account.package_name}</span><span className="mono mt-1 block text-sm text-maven-muted">{account.primary_domain}</span></span><span className="inline-flex items-center gap-1 text-sm font-semibold text-maven-signal">View hosting <ArrowRight className="size-4"/></span></Link>)}</div> : <EmptyService text="No hosting services found. Check your plan details before ordering a certificate." link="Browse hosting plans" to="/hosting" />}
    <p className="mt-4 text-sm text-maven-muted">For a certificate installation or renewal check, <Link to="/contact?type=support" className="font-semibold text-maven-signal">contact support</Link>.</p>
  </section>

  if (section === 'subscriptions') return <section className="max-w-4xl">
    {subscriptions.length > 0 && <div className="panel mb-5 divide-y divide-maven-line">{subscriptions.map(item => <div key={item.id} className="p-5"><h2 className="font-semibold text-maven-ink">{item.plan} · {item.primary_domain}</h2><p className="mt-2 text-sm text-maven-muted">{item.retail_price} {item.currency} · {item.billing_cycle.replaceAll('_', ' ')} · {item.status}</p><p className="mt-1 text-sm text-maven-muted">{item.renews_at ? `Next renewal: ${new Date(item.renews_at).toLocaleDateString()}` : 'Renewal date to be confirmed'} · manual renewal</p></div>)}</div>}

    <InfoCard icon={CalendarClock} title="Your active services and billing history" description="This view brings together your registered domains, provisioned hosting, and orders. Domain expiry dates are shown where the registrar supplies them. Hosting subscriptions show their purchased period and next renewal date. Automatic renewal is not enabled." />
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div><h2 className="font-semibold text-maven-ink">Domains ({domains.length})</h2><div className="panel mt-3 divide-y divide-maven-line">{domains.length ? domains.map((d) => <Link key={d.id} to={`/account/domains/${d.id}`} className="block p-4 hover:bg-black/[0.025]"><span className="mono font-semibold text-maven-ink">{d.domain_name}</span><span className="mt-1 block text-sm text-maven-muted">{d.expires_at ? `Expires ${d.expires_at}` : 'Expiry date unavailable'} · auto-renew {d.auto_renew ? 'on' : 'off'}</span></Link>) : <p className="p-4 text-sm text-maven-muted">No registered domains.</p>}</div></div>
      <div><h2 className="font-semibold text-maven-ink">Hosting ({hosting.length})</h2><div className="panel mt-3 divide-y divide-maven-line">{hosting.length ? hosting.map((h) => <Link key={h.account_id} to={`/account/hosting/${h.account_id}`} className="block p-4 hover:bg-black/[0.025]"><span className="font-semibold text-maven-ink">{h.package_name}</span><span className="mt-1 block text-sm text-maven-muted">{h.primary_domain} · {h.status}</span></Link>) : <p className="p-4 text-sm text-maven-muted">No provisioned hosting accounts.</p>}</div></div>
    </div>
    <div className="mt-6 flex items-center justify-between"><h2 className="font-semibold text-maven-ink">Recent orders ({orders.length})</h2><Link to="/account/orders" className="text-sm font-semibold text-maven-signal">View all</Link></div>
    {orders.length ? <div className="panel mt-3 divide-y divide-maven-line">{orders.slice(0, 5).map((order) => <Link key={order.order_id} to={`/orders/${order.order_id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-black/[0.025]"><span><span className="mono block font-semibold text-maven-ink">{order.number}</span><span className="mt-1 block text-sm capitalize text-maven-muted">{order.status.replaceAll('_', ' ')}</span></span><span className="text-sm font-semibold text-maven-ink">{order.currency} {Number(order.total).toFixed(2)}</span></Link>)}</div> : <div className="panel mt-3 p-4 text-sm text-maven-muted">No orders are recorded on this account yet.</div>}
    <p className="mt-2 text-sm text-maven-muted">Order invoices and payment status are available in <Link to="/account/invoices" className="font-semibold text-maven-signal">Invoices</Link>.</p>
  </section>

  return <section className="max-w-4xl">
    <InfoCard icon={Tag} title="Offers for your account" description="Customer-specific offers will appear here when available. Current plan pricing and any public promotions are shown in the catalog and at checkout." />
    <div className="mt-5 flex flex-wrap gap-3"><Link to="/domains" className="btn btn-primary">Explore domains</Link><Link to="/hosting" className="btn btn-secondary">Compare hosting</Link></div>
  </section>
}

export function ProfilePage() {
  const [data, setData] = useState<CustomerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { getCustomerProfile().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : 'We could not load your profile.')).finally(() => setLoading(false)) }, [])
  if (loading) return <Loading label="Loading your profile…" />
  if (!data) return <ErrorMessage message={error || 'Your profile could not be loaded.'} />
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    const form = new FormData(event.currentTarget)
    setSaving(true); setError(''); setSaved(false)
    try {
      const updated = await updateCustomerProfile({ first_name: String(form.get('first_name') ?? ''), last_name: String(form.get('last_name') ?? ''), profile: {
        phone_number: String(form.get('phone_number') ?? ''), company: String(form.get('company') ?? ''), country: String(form.get('country') ?? ''), city: String(form.get('city') ?? ''), address: String(form.get('address') ?? ''), postal_code: String(form.get('postal_code') ?? ''), timezone: String(form.get('timezone') ?? ''), preferred_currency: String(form.get('preferred_currency') ?? 'USD'),
      } })
      setData(updated); setSaved(true)
    } catch (e) { setError(e instanceof ApiError ? e.message : 'We could not save your profile.') }
    finally { setSaving(false) }
  }
  const profile = data.profile
  const fields = [
    ['first_name', 'First name', data.first_name], ['last_name', 'Last name', data.last_name], ['phone_number', 'Phone number', profile.phone_number], ['company', 'Company', profile.company], ['country', 'Country', profile.country], ['city', 'City', profile.city], ['address', 'Street address', profile.address], ['postal_code', 'Postal code', profile.postal_code], ['timezone', 'Time zone', profile.timezone], ['preferred_currency', 'Preferred currency', profile.preferred_currency || 'USD'],
  ]
  return <form onSubmit={save} className="max-w-3xl space-y-5">
    <div className="panel p-5"><p className="text-sm text-maven-muted">Sign-in email</p><p className="mt-1 font-semibold text-maven-ink">{data.email}</p><p className="mt-1 text-xs text-maven-muted">Email address changes require account verification. Contact support if you need to update it.</p></div>
    <div className="panel grid gap-4 p-5 sm:grid-cols-2">{fields.map(([name, label, value]) => <label key={name} className="block text-sm font-medium text-maven-ink">{label}<input name={name} defaultValue={value} className="mt-1.5 w-full rounded-lg border border-maven-line bg-white px-3 py-2.5 text-sm" /></label>)}</div>
    {error && <ErrorMessage message={error} />}{saved && <p role="status" className="text-sm font-semibold text-emerald-700">Profile saved.</p>}
    <button disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save profile'}</button>
  </form>
}

function InfoCard({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <div className="panel flex items-start gap-4 p-5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-maven-signal/10 text-maven-signal"><Icon className="size-5"/></span><div><h2 className="font-semibold text-maven-ink">{title}</h2><p className="mt-1 text-sm leading-6 text-maven-muted">{description}</p></div></div>
}

function EmptyService({ text, link, to }: { text: string; link: string; to: string }) {
  return <div className="panel mt-3 p-5"><p className="text-sm text-maven-muted">{text}</p><Link to={to} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-maven-signal">{link}<ArrowRight className="size-4"/></Link></div>
}

function Loading({ label }: { label: string }) { return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" />{label}</div> }
function ErrorMessage({ message }: { message: string }) { return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{message}</p> }
