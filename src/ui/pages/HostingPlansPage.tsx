import { PageIntro } from '../components/PageIntro'
import { Notice } from '../components/Notice'
import { PlanPrice } from '../components/PlanPrice'
import { BILLING_TERMS, featureValue as value, features, usd, useHostingCatalog } from '../lib/hosting-presentation'
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
const SHARED_SPECS = [['websites', 'Websites', ''], ['storage_gb', 'Website storage', ' GB'], ['max_email_accounts', 'Mailboxes', ''], ['mailbox_storage_gb', 'Per mailbox', ' GB'], ['max_databases', 'Databases', ''], ['cdn', 'CDN', '']]

export function HostingPlansPage() {
  const navigate = useNavigate()
  const { refresh } = useCart()
  const [adding, setAdding] = useState<number | null>(null)
  async function add(plan: HostingPlan) {
    const cycles: Record<string, string> = { '1-month': 'monthly', '1-year': 'annually', '2-year': 'biennially' }
    const price = plan.prices.find(p => p.currency === 'USD' && p.billing_cycle === cycles[selectedTerm])
    if (!price) { setError('This plan is temporarily unavailable.'); return }
    setAdding(plan.id); setError('')
    try { await addHostingToCart({ resource_id: price.id, billing_cycle: price.billing_cycle }); await refresh(); navigate('/cart') }
    catch (e) { setError(e instanceof ApiError ? e.message : 'We could not add this plan to your cart.') }
    finally { setAdding(null) }
  }
  const [params, setParams] = useSearchParams()
  const categories = [{key: 'shared', label: 'Web hosting'}, {key: 'email', label: 'Email hosting'}, {key: 'vps', label: 'Managed VPS'}, {key: 'dedicated', label: 'Dedicated servers'}]
  const category = categories.some(c => c.key === params.get('category')) ? params.get('category')! : 'shared'
  const infrastructure = category === 'vps' || category === 'dedicated'
  const email = category === 'email'
  const service = categories.find(c => c.key === category)!.label
  const { plans, loading, error: catalogError, retry } = useHostingCatalog()
  const [term, setTerm] = useState('1-year')
  useEffect(() => { setTerm(infrastructure ? '1-month' : '1-year') }, [infrastructure])
  const selectedTerm = infrastructure ? '1-month' : term
  const [error, setError] = useState('')

  useEffect(() => { if (!loading && window.location.hash === '#compare-plans') document.getElementById('compare-plans')?.scrollIntoView() }, [loading])
  const visiblePlans = plans.filter(p => p.plan_type === (infrastructure ? category : 'shared'))
  const rows = infrastructure ? [['processor', 'Processor', ''], ['cpu_cores', 'CPU cores', ''], ['cpu_threads', 'CPU threads', ''], ['memory_gb', 'RAM', ' GB'], ...(category === 'vps' ? [['storage_gb', 'NVMe storage', ' GB']] : [['storage_configuration', 'Storage configuration', '']]), ['bandwidth', 'Monthly bandwidth', ' GB'], ['network_port', 'Network port', ''], ['control_panel', 'Control panel options', ''], ['managed_infrastructure', 'Managed infrastructure', '']].filter(([key]) => visiblePlans.some(p => p.proposed_features?.[key] !== undefined)) : ROWS.filter(([key]) => visiblePlans.some(plan => features(plan)[key] !== undefined))
  return <div className="public-page min-h-screen bg-maven-paper">
    <CustomerHeader dark />
    <SEO title={`${service} | MavenHost`} description={infrastructure ? `${service} base configurations. Compare CPU, memory, storage and VAT-inclusive starting prices.` : 'Cloud website hosting with free SSL, a global CDN, 10 GB mailboxes and WordPress tools. Compare plans and VAT-inclusive prices.'} path={category === "shared" ? "/hosting" : `/hosting?category=${category}`} />
    <PageIntro eyebrow={service} title={infrastructure ? 'Choose resources for a workload, not a promise.' : email ? 'Business email, with the limits explained.' : 'Cloud hosting with clear limits and prices.'} description={infrastructure ? 'Compare published server configurations. Final stock, licences, runtime requirements and renewal pricing need confirmation before a purchase.' : email ? 'Every cloud hosting plan includes professional mailboxes on your own domain, each with its own 10 GB of storage, plus webmail, spam filtering and DKIM signing.' : 'Compare websites, storage and mailboxes for each plan. Every plan includes free SSL, a global CDN, a web application firewall and WordPress tools. Domain registrations are purchased separately.'}><a href="#plans" className="btn btn-primary">Compare plans</a></PageIntro>
    <main id="main-content" className="container-shell section-space">
      <nav aria-label="Hosting service" className="mb-10 flex flex-wrap justify-center gap-3">{categories.map(c => <button key={c.key} type="button" onClick={() => setParams({category: c.key})} aria-pressed={category === c.key} className={`btn ${category === c.key ? 'btn-primary' : 'border border-maven-line bg-white text-maven-ink'}`}>{c.label}</button>)}</nav>
      <Notice title="Not open for activation yet.">The catalog is available to compare and save to your cart. Hosting checkout, payment and provisioning open once the hosting platform is activated. Listed resources become active service entitlements at that point.</Notice>
      {email && <div className="mt-6 grid gap-6 md:grid-cols-3"><article className="service-summary"><h2>Mailboxes</h2><p>Each mailbox has its own login and 10 GB of storage, separate from your website storage. The number of mailboxes is listed per plan.</p></article><article className="service-summary"><h2>Aliases and forwarding</h2><p>Forwarders and autoresponders direct mail to an existing inbox instead of providing another storage allocation.</p></article><article className="service-summary"><h2>Sending and deliverability</h2><p>Hosting email is not a bulk-mail service. DKIM signing is included; no hosting plan can guarantee inbox placement.</p></article></div>}
      <section id="plans" className="scroll-mt-40" aria-labelledby="plans-title">
        <h2 id="plans-title" className="mt-8 text-center text-2xl font-semibold tracking-tight text-maven-ink">{`Select your ${service.toLowerCase()} plan`}</h2>
        <div className="mx-auto mt-8 grid max-w-xl grid-cols-3 gap-3" aria-label="Billing commitment">{(infrastructure ? TERMS.filter(t => t.value === "1-month") : TERMS).map(t => <button type="button" key={t.value} aria-pressed={term === t.value} onClick={() => setTerm(t.value)} className={`border px-5 py-3 font-bold ${term === t.value ? 'border-maven-signal bg-maven-signal text-white' : 'border-maven-signal bg-white text-maven-signal'}`}>{t.label}</button>)}</div>
        <p className="mt-5 text-center text-sm text-maven-muted">{infrastructure ? "USD base prices include 16% VAT. Configuration, licences, availability and renewal pricing require confirmation." : "USD prices include 16% VAT. Renewals are charged at the same price. Longer terms are paid in full upfront."}</p>
        {loading && <p role="status" className="my-12 flex items-center justify-center gap-3"><LoaderCircle className="size-5 animate-spin" />Loading plans…</p>}
        {catalogError && <div role="alert" className="my-6 text-center"><p className="text-maven-danger">{catalogError}</p><button type="button" onClick={retry} className="btn btn-secondary mt-3">Retry catalog</button></div>}
        {!loading && !catalogError && visiblePlans.length === 0 && <p className="my-6 text-center text-maven-muted">No configurations are currently listed for this category. Contact support to discuss your requirement.</p>}
        {error && <p role="alert" className="mt-8 text-center text-maven-danger">{error}</p>}
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{visiblePlans.map(plan => {
          const cycle = BILLING_TERMS.find(item => item.value === selectedTerm)?.cycle
          const hasPrice = plan.prices.some(price => price.currency === 'USD' && price.billing_cycle === cycle)
          const specs = infrastructure ? [['cpu_cores', 'CPU cores', ''], ['memory_gb', 'RAM', ' GB'], [category === 'vps' ? 'storage_gb' : 'storage_configuration', 'Storage', category === 'vps' ? ' GB' : ''], ['bandwidth', 'Bandwidth', ' GB'], ['control_panel', 'Control panel', '']] : SHARED_SPECS
          return <article key={plan.id} className="panel flex flex-col p-5"><div className="flex items-start justify-between gap-2"><h3 className="text-xl font-semibold text-maven-text">{plan.name}</h3>{plan.is_featured && <span className="chip">Most popular</span>}</div><p className="mt-2 text-sm text-maven-muted">{plan.short_description}</p><p className="mt-2 text-xs text-maven-muted">{plan.verification_status === 'verified' ? 'Verified configuration' : 'Published configuration · pending activation'}</p><PlanPrice plan={plan} term={selectedTerm} /><dl className="compact-specs mb-5">{specs.map(([key, label, unit]) => <div key={key}><dt>{label}</dt><dd>{value(plan, key, unit)}</dd></div>)}</dl><button type="button" className="btn btn-primary mt-auto w-full disabled:opacity-50" onClick={() => add(plan)} disabled={adding !== null || !hasPrice}>{adding === plan.id ? <LoaderCircle className="size-4 animate-spin" /> : null}{hasPrice ? 'Add to cart' : 'Price confirmation required'}</button></article>
        })}</div>
        <div className="mt-9 text-center"><a href="#compare-plans" className="btn btn-primary">Compare all options</a><p className="mx-auto mt-4 max-w-2xl text-xs leading-6 text-maven-muted">{infrastructure ? 'Server configurations and starting prices are indicative. Stock is reconfirmed when ordering opens.' : 'Websites in a plan share its website storage; each mailbox has its own storage. Unlimited resources are subject to acceptable use.'} You can add a plan to your cart now. Checkout and account setup will open when the service is ready. No payment is collected yet.</p></div>
      </section>
      <section className="my-10 grid gap-6 md:grid-cols-3"><article className="service-summary"><h2>Control panel</h2><p>{infrastructure ? 'Control-panel choices and licences depend on the final server configuration. Do not assume that a starting price includes a paid panel licence.' : 'Manage websites, files, databases, email, DNS and SSL from the Maven Host control panel, with two-factor sign-in. Extra websites are added within your plan; their domain registrations are not included.'}</p></article><article className="service-summary"><h2>Application and migration checks</h2><p>Confirm the required PHP version, database engine, background processes and deployment access before purchase. We can migrate an existing website for you; timing is confirmed when you order.</p></article><article className="service-summary"><h2>Limits and recovery</h2><p>Storage and acceptable-use limits still apply to resources described as unlimited. Keep your own independent copies of important data in addition to platform protection.</p></article></section>
      <section id="compare-plans" className="scroll-mt-40" aria-labelledby="comparison-title"><h2 id="comparison-title" className="text-center text-3xl font-semibold text-maven-ink">Compare {service.toLowerCase()}</h2><p className="mt-3 text-center text-sm text-maven-muted">{infrastructure ? 'Base server resources and configuration options, side by side.' : 'Website limits, resources and features, side by side.'}</p>
        <div className="mt-8 overflow-x-auto border border-maven-line" tabIndex={0} role="region" aria-label={`${service} comparison`}><table className="w-full min-w-[720px] border-collapse bg-white text-sm"><caption className="sr-only">MavenHost {service.toLowerCase()} specifications and VAT-inclusive prices</caption><thead><tr><th scope="col" className="p-5 text-left">Features</th>{visiblePlans.map(plan => { const o = plan.advertised_offers?.find(x => x.term === selectedTerm); return <th scope="col" key={plan.id} className={`p-5 text-center ${plan.is_featured ? 'bg-maven-bright/10' : ''}`}><span className="block text-lg text-maven-ink">{plan.name}</span><span className="mt-2 block text-maven-signal">{o ? `${usd(o.total)} USD / ${o.months} month${o.months > 1 ? 's' : ''}` : 'Confirm price'}</span><span className="mt-1 block text-xs font-normal text-maven-muted">{o && o.months > 1 ? `${usd(o.monthly)} monthly equivalent` : 'Monthly billing'}</span><button type="button" onClick={() => add(plan)} disabled={adding !== null || !plan.prices.some(price => price.currency === 'USD' && price.billing_cycle === BILLING_TERMS.find(item => item.value === selectedTerm)?.cycle)} className="btn btn-primary mt-4 text-xs disabled:opacity-50">{adding === plan.id ? "Adding…" : "Add to cart"}</button></th> })}</tr></thead><tbody>{rows.map(([key, label, unit]) => <tr key={key} className="border-t border-maven-line"><th scope="row" className="p-5 text-left font-medium text-maven-ink">{label}</th>{visiblePlans.map(plan => <td key={plan.id} className={`p-5 text-center text-maven-ink ${plan.is_featured ? 'bg-maven-bright/10' : ''}`}>{value(plan, key, unit)}</td>)}</tr>)}</tbody></table></div>
        <p className="mt-4 text-xs leading-6 text-maven-muted">{infrastructure ? "Base server configurations exclude unconfirmed optional licences and upgrades. Final configuration, supplier availability and renewal prices require confirmation. Checkout and server setup are not available yet." : "Listed resources are the plan limits that apply once the service is activated. Checkout and account setup are not available yet."}</p>
      </section>
    </main><SiteFooter />
  </div>
}
