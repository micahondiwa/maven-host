import { INARA_CREST } from '../lib/site'
import { Notice } from '../components/Notice'
import { Link } from '@/lib/navigation'
import { ArrowRight, ArrowRightLeft, BookOpenCheck, DatabaseZap, Globe2, HardDriveDownload, LockKeyhole, SearchCheck, Server, WandSparkles } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { SEO } from '../components/SEO'

const SERVICES = [
  {
    id: 'domain-registration',
    icon: Globe2,
    title: 'Domain registration and management',
    description: 'Search available domain extensions, review current registration pricing, and manage your domains from a MavenHost account.',
    detail: 'Search .co.ke, .ke, .com and other extensions offered in the currently enabled domain catalog. Availability and price are confirmed during search and checkout.',
    to: '/domains',
    action: 'Search domains',
  },
  {
    id: 'domain-transfer',
    icon: ArrowRightLeft,
    title: 'Domain transfers',
    description: 'Move an eligible domain from another registrar to MavenHost with guidance from our support team.',
    detail: 'Transfer requirements and prices depend on the extension and current registrar. Contact us with the domain name and we will confirm eligibility and next steps before proceeding.',
    to: '/contact?type=support&subject=Domain%20transfer%20request',
    action: 'Ask about a domain transfer',
  },
  {
    id: 'web-hosting',
    icon: Server,
    title: 'Web hosting plans',
    description: 'Compare the current hosting plans by websites, storage, mailboxes, databases, SSL, CDN and security features.',
    detail: 'Published configurations and prices come from the catalog. Hosting checkout and activation are pending; you can compare plans and save a selection now.',
    to: '/hosting',
    action: 'Compare hosting plans',
  },
  {
    id: 'dns-records',
    icon: DatabaseZap,
    title: 'DNS records and nameservers',
    description: 'Connect a domain to a website or email provider by managing DNS records and authoritative nameservers.',
    detail: 'For domains in your MavenHost account, the domain manager exposes common record types and nameserver settings when the registrar supports the operation. DNS changes can take time to propagate. Save existing records before a change, especially when website and email providers differ.',
    to: '/account/domains',
    action: 'Manage domains',
  },
  {
    id: 'backups-ssl',
    icon: HardDriveDownload,
    title: 'Backups, SSL and business email',
    description: 'Review the published backup retention, SSL support and mailbox limits for each configuration.',
    detail: 'These features vary by plan. Review the specifications on each hosting plan before ordering; the catalog is the source of current inclusion and limits.',
    to: '/hosting',
    action: 'Review plan features',
  },
  {
    id: 'ai-website-builder',
    icon: WandSparkles,
    title: 'AI website builder',
    description: 'Turn a business brief into a structured website draft with suggested pages, starter copy and search metadata.',
    detail: 'Generate one anonymous draft per visitor per day. Sign in to save the generated website pages to your MavenHost account.',
    to: '/ai-builder',
    action: 'Try the AI builder',
  },
  {
    id: 'seo-checks',
    icon: SearchCheck,
    title: 'Website SEO checks',
    description: 'Review the SEO basics on a website draft saved to your account.',
    detail: 'The current checks flag missing or overlong page titles and descriptions, missing introductory sections, and pages without a homepage. They are technical checks, not a ranking guarantee.',
    to: '/ai-builder',
    action: 'Build a site to check',
  },
  {
    id: 'account-security',
    icon: LockKeyhole,
    title: 'Account and domain safeguards',
    description: 'Security controls support safer access to customer accounts, domains, orders and hosting credentials.',
    detail: 'The platform uses role-based staff permissions, audit records for account-affecting actions, and encrypted storage for hosting credentials. Domain privacy and transfer controls depend on the extension and registry support.',
    to: '/#security',
    action: 'See security details',
  },
  {
    id: 'guides-support',
    icon: BookOpenCheck,
    title: 'Guides and customer support',
    description: 'Find practical guidance on domains, hosting, DNS, email, site migrations and website basics.',
    detail: 'For account or service questions, contact the team by email or phone. We do not promise a response time on this page.',
    to: '/help-center',
    action: 'Read guides and contact us',
  },
]

export function ServicesPage() {
  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader dark />
      <SEO title="Domain, DNS, Web Hosting & AI Website Services | MavenHost" description="Explore MavenHost domain registration, DNS and nameserver controls, web hosting, AI website drafts and technical SEO checks for Kenyan businesses." path="/services" />
      <section className="hero-neutral py-16 text-maven-text sm:py-20">
        <div className="container-shell">
          <span className="chip">MavenHost services</span>
          <h1 className="mt-5 max-w-3xl text-[2.5rem] font-semibold leading-tight tracking-tight sm:text-[3.25rem]">The essentials to register a domain, build a site and host it.</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-7 text-maven-muted">Find domain, DNS, website and hosting tools in one place. Plan-specific features are shown in the live catalog, and domain controls depend on registrar support.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/domains" className="btn btn-bright">Search a domain <ArrowRight className="size-4" /></Link>
            <Link to="/hosting" className="btn btn-secondary">Compare hosting</Link>
          </div>
        </div>
      </section>

      <main id="main-content" className="container-shell py-12 sm:py-16">
        <div className="divide-y divide-maven-line">
          {SERVICES.map(({ id, icon: Icon, title, description, detail, to, action }) => (
            <article id={id} key={title} className="grid scroll-mt-52 gap-4 py-7 md:grid-cols-[0.85fr_1.15fr]">
              <div className="icon-tile on-light"><Icon className="size-5" /></div>
              <h2 className="mt-4 text-lg font-semibold text-maven-ink">{title}</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-maven-text">{description}</p>
              <p className="mt-3 flex-1 text-sm leading-6 text-maven-muted">{detail}</p>
              <Link to={to} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-maven-signal">{action}<ArrowRight className="size-4" /></Link>
            </article>
          ))}
        </div>
        <section className="section-space border-t border-maven-line"><h2 className="text-2xl font-semibold text-maven-text">A hosting-focused platform from Inara Crest.</h2><p className="mt-3 max-w-3xl text-sm leading-7 text-maven-muted">MavenHost brings domain and hosting selections into one customer platform. Hosting resources are supplied through provider services; they are not presented as data centres owned by MavenHost. Inara Crest Devs handles separate software engineering and maintenance engagements.</p><a href={INARA_CREST.developers} target="_blank" rel="noreferrer" className="btn btn-secondary mt-5">Explore Inara Crest Devs<span className="sr-only"> (opens in a new tab)</span></a><Notice>Service availability, runtime compatibility, migration costs and support scope must be confirmed for the particular product or engagement.</Notice></section>
      </main>
      <SiteFooter />
    </div>
  )
}
