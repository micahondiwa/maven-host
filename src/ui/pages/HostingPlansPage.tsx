import { PageIntro } from '../components/PageIntro'
import { Notice } from '../components/Notice'
import { PlanPrice } from '../components/PlanPrice'
import { CurrencySelector } from '../components/CurrencySelector'
import { BILLING_TERMS, featureValue as value, features, useHostingCatalog } from '../lib/hosting-presentation'
import { useCurrency } from '../lib/currency'
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from '@/lib/navigation'
import { LoaderCircle } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { SEO } from '../components/SEO'
import { addHostingToCart, ApiError, type HostingPlan } from '../lib/api'
import { useCart } from '../lib/cart'

const TERMS = [...BILLING_TERMS].reverse()
const ROWS = [
  ['websites', 'Websites', ''], ['storage_gb', 'Website storage', ' GB'], ['bandwidth', 'Bandwidth', ''],
  ['max_email_accounts', 'Mailboxes', ''], ['mailbox_storage_gb', 'Storage per mailbox', ' GB'], ['max_databases', 'MySQL databases', ''],
  ['control_panel', 'Control panel', ''], ['ssl', 'SSL certificates', ''], ['cdn', 'Content delivery network', ''],
  ['waf', 'Web application firewall', ''], ['ddos_protection', 'DDoS protection', ''], ['malware_scanning', 'Malware scanning', ''],
  ['two_factor_auth', 'Two-factor sign-in', ''], ['wordpress_manager', 'WordPress management', ''], ['wordpress_staging', 'WordPress staging', ''],
  ['wp_cli', 'WP-CLI', ''], ['ssh', 'SSH access', ''], ['git', 'Git version control', ''], ['php_management', 'PHP version control', ''],
  ['dns_management', 'DNS management', ''], ['webmail', 'Webmail', ''], ['autoresponders', 'Email autoresponders', ''],
  ['spam_filtering', 'Spam filtering', ''], ['dkim', 'DKIM email signing', ''], ['free_migration', 'Website migration', ''],
]
const SPECS = [['websites', 'Websites', ''], ['storage_gb', 'Website storage', ' GB'], ['max_email_accounts', 'Mailboxes', ''], ['mailbox_storage_gb', 'Per mailbox', ' GB'], ['max_databases', 'Databases', ''], ['cdn', 'CDN', '']]
const CATEGORIES = [{ key: 'shared', label: 'Web hosting' }, { key: 'email', label: 'Email hosting' }]

export function HostingPlansPage() {
  const navigate = useNavigate()
  const { refresh } = useCart()
  const currency = useCurrency()
  const [adding, setAdding] = useState<number | null>(null)
  const [params, setParams] = useSearchParams()
  const category = CATEGORIES.some(c => c.key === params.get('category')) ? params.get('category')! : 'shared'
  const email = category === 'email'
  const service = CATEGORIES.find(c => c.key === category)!.label
  const { plans, loading, error: catalogError, retry } = useHostingCatalog()
  const [term, setTerm] = useState('1-year')
  const [error, setError] = useState('')
  const cycle = BILLING_TERMS.find(item => item.value === term)?.cycle
  /** Price row charged for the selection: KES rows when KES is chosen, USD otherwise (display-only currencies pay in USD). */
  const chargePrice = (plan: HostingPlan) => plan.prices.find(p => p.currency === currency.chargeCode && p.billing_cycle === cycle)

  async function add(plan: HostingPlan) {
    const price = chargePrice(plan)
    if (!price) { setError('This plan is temporarily unavailable.'); return }
    setAdding(plan.id); setError('')
    try { await addHostingToCart({ resource_id: price.id, billing_cycle: price.billing_cycle }); await refresh(); navigate('/cart') }
    catch (e) { setError(e instanceof ApiError ? e.message : 'We could not add this plan to your cart.') }
    finally { setAdding(null) }
  }

  useEffect(() => { if (!loading && window.location.hash === '#compare-plans') document.getElementById('compare-plans')?.scrollIntoView() }, [loading])
  const visiblePlans = plans.filter(p => p.plan_type === 'shared')
  const rows = ROWS.filter(([key]) => visiblePlans.some(plan => features(plan)[key] !== undefined))
  return <div className="public-page min-h-screen bg-maven-paper">
    <CustomerHeader dark />
    <SEO title={`${service} | MavenHost`} description="Cloud website hosting with free SSL, a global CDN, 10 GB mailboxes and WordPress tools. Compare plans and VAT-inclusive prices in USD, KES and other East African currencies." path={category === "shared" ? "/hosting" : `/hosting?category=${category}`} />
    <PageIntro eyebrow={service} title={email ? 'Business email, with the limits explained.' : 'Cloud hosting with clear limits and prices.'} description={email ? 'Every cloud hosting plan includes professional mailboxes on your own domain, each with its own 10 GB of storage, plus webmail, spam filtering and DKIM signing.' : 'Compare websites, storage and mailboxes for each plan. Every plan includes free SSL, a global CDN, a web application firewall and WordPress tools. Domain registrations are purchased separately.'}><a href="#plans" className="btn btn-primary">Compare plans</a></PageIntro>
    <main id="main-content" className="container-shell section-space">
      <nav aria-label="Hosting service" className="mb-10 flex flex-wrap justify-center gap-3">{CATEGORIES.map(c => <button key={c.key} type="button" onClick={() => setParams({category: c.key})} aria-pressed={category === c.key} className={`btn ${category === c.key ? 'btn-primary' : 'border border-maven-line bg-white text-maven-ink'}`}>{c.label}</button>)}</nav>
      <Notice title="Not open for activation yet.">The catalog is available to compare and save to your cart. Hosting checkout, payment and provisioning open once the hosting platform is activated. Listed resources become active service entitlements at that point.</Notice>
      {email && <div className="mt-6 grid gap-6 md:grid-cols-3"><article className="service-summary"><h2>Mailboxes</h2><p>Each mailbox has its own login and 10 GB of storage, separate from your website storage. The number of mailboxes is listed per plan.</p></article><article className="service-summary"><h2>Aliases and forwarding</h2><p>Forwarders and autoresponders direct mail to an existing inbox instead of providing another storage allocation.</p></article><article className="service-summary"><h2>Sending and deliverability</h2><p>Hosting email is not a bulk-mail service. DKIM signing is included; no hosting plan can guarantee inbox placement.</p></article></div>}
      <section id="plans" className="scroll-mt-40" aria-labelledby="plans-title">
        <h2 id="plans-title" className="mt-8 text-center text-2xl font-semibold tracking-tight text-maven-ink">{`Select your ${service.toLowerCase()} plan`}</h2>
        <div className="mx-auto mt-8 grid max-w-xl grid-cols-3 gap-3" aria-label="Billing commitment">{TERMS.map(t => <button type="button" key={t.value} aria-pressed={term === t.value} onClick={() => setTerm(t.value)} className={`border px-5 py-3 font-bold ${term === t.value ? 'border-maven-signal bg-maven-signal text-white' : 'border-maven-signal bg-white text-maven-signal'}`}>{t.label}</button>)}</div>
        <CurrencySelector className="mx-auto mt-5 max-w-2xl" />
        <p className="mt-3 text-center text-sm text-maven-muted">Prices include 16% VAT. Renewals are charged at the same price. Longer terms are paid in full upfront.</p>
        {loading && <p role="status" className="my-12 flex items-center justify-center gap-3"><LoaderCircle className="size-5 animate-spin" />Loading plans…</p>}
        {catalogError && <div role="alert" className="my-6 text-center"><p className="text-maven-danger">{catalogError}</p><button type="button" onClick={retry} className="btn btn-secondary mt-3">Retry catalog</button></div>}
        {!loading && !catalogError && visiblePlans.length === 0 && <p className="my-6 text-center text-maven-muted">No plans are currently listed. Contact support to discuss your requirement.</p>}
        {error && <p role="alert" className="mt-8 text-center text-maven-danger">{error}</p>}
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{visiblePlans.map(plan => {
          const hasPrice = Boolean(chargePrice(plan))
          return <article key={plan.id} className="panel flex flex-col p-5"><div className="flex items-start justify-between gap-2"><h3 className="text-xl font-semibold text-maven-text">{plan.name}</h3>{plan.is_featured && <span className="chip">Most popular</span>}</div><p className="mt-2 text-sm text-maven-muted">{plan.short_description}</p><p className="mt-2 text-xs text-maven-muted">{plan.verification_status === 'verified' ? 'Verified configuration' : 'Published configuration · pending activation'}</p><PlanPrice plan={plan} term={term} /><dl className="compact-specs mb-5">{SPECS.map(([key, label, unit]) => <div key={key}><dt>{label}</dt><dd>{value(plan, key, unit)}</dd></div>)}</dl><button type="button" className="btn btn-primary mt-auto w-full disabled:opacity-50" onClick={() => add(plan)} disabled={adding !== null || !hasPrice}>{adding === plan.id ? <LoaderCircle className="size-4 animate-spin" /> : null}{hasPrice ? 'Add to cart' : 'Price confirmation required'}</button></article>
        })}</div>
        <div className="mt-9 text-center"><a href="#compare-plans" className="btn btn-primary">Compare all options</a><p className="mx-auto mt-4 max-w-2xl text-xs leading-6 text-maven-muted">Websites in a plan share its website storage; each mailbox has its own storage. Unlimited resources are subject to acceptable use. You can add a plan to your cart now. Checkout and account setup will open when the service is ready. No payment is collected yet.</p></div>
      </section>
      <section className="my-10 grid gap-6 md:grid-cols-3"><article className="service-summary"><h2>Control panel</h2><p>Manage websites, files, databases, email, DNS and SSL from the Maven Host control panel, with two-factor sign-in. Extra websites are added within your plan; their domain registrations are not included.</p></article><article className="service-summary"><h2>Application and migration checks</h2><p>Confirm the required PHP version, database engine, background processes and deployment access before purchase. We can migrate an existing website for you; timing is confirmed when you order.</p></article><article className="service-summary"><h2>Limits and recovery</h2><p>Storage and acceptable-use limits still apply to resources described as unlimited. Keep your own independent copies of important data in addition to platform protection.</p></article></section>
      <section id="compare-plans" className="scroll-mt-40" aria-labelledby="comparison-title"><h2 id="comparison-title" className="text-center text-3xl font-semibold text-maven-ink">Compare {service.toLowerCase()}</h2><p className="mt-3 text-center text-sm text-maven-muted">Website limits, resources and features, side by side.</p>
        <div className="mt-8 overflow-x-auto border border-maven-line" tabIndex={0} role="region" aria-label={`${service} comparison`}><table className="w-full min-w-[720px] border-collapse bg-white text-sm"><caption className="sr-only">MavenHost {service.toLowerCase()} specifications and VAT-inclusive prices</caption><thead><tr><th scope="col" className="p-5 text-left">Features</th>{visiblePlans.map(plan => <th scope="col" key={plan.id} className={`p-5 text-center align-top ${plan.is_featured ? 'bg-maven-bright/10' : ''}`}><span className="block text-lg text-maven-ink">{plan.name}</span><PlanPrice plan={plan} term={term} /><button type="button" onClick={() => add(plan)} disabled={adding !== null || !chargePrice(plan)} className="btn btn-primary mt-4 text-xs disabled:opacity-50">{adding === plan.id ? "Adding…" : "Add to cart"}</button></th>)}</tr></thead><tbody>{rows.map(([key, label, unit]) => <tr key={key} className="border-t border-maven-line"><th scope="row" className="p-5 text-left font-medium text-maven-ink">{label}</th>{visiblePlans.map(plan => <td key={plan.id} className={`p-5 text-center text-maven-ink ${plan.is_featured ? 'bg-maven-bright/10' : ''}`}>{value(plan, key, unit)}</td>)}</tr>)}</tbody></table></div>
        <p className="mt-4 text-xs leading-6 text-maven-muted">Listed resources are the plan limits that apply once the service is activated. Checkout and account setup are not available yet.</p>
      </section>
    </main><SiteFooter />
  </div>
}
