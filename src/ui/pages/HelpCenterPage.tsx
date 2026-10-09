import { Link } from '@/lib/navigation'
import { ArrowRight, BookOpen, CheckCircle2, CircleHelp, DatabaseZap, Globe2, LifeBuoy, Mail, MessageCircle, Radio, ServerCog, ShieldCheck } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { SectionHeading } from '../components/SectionHeading'
import { SEO } from '../components/SEO'
import { whatsappUrl } from '../lib/site'

const GETTING_STARTED = [
  { icon: BookOpen, title: 'Find and register a domain', body: 'Search a name, review available extensions and current prices, then add a supported registration to your cart. A lookup does not reserve the name.', to: '/domains' },
  { icon: ServerCog, title: 'Choose a hosting plan', body: 'Compare published web, VPS, dedicated and email configurations by workload and included resources.', to: '/hosting' },
  { icon: ShieldCheck, title: 'Protect your account and services', body: 'Use a unique password, keep your account email current and verify changes to DNS, billing and hosting credentials.', to: '/services#account-security' },
  { icon: DatabaseZap, title: 'Connect a domain with DNS', body: 'Point web traffic and email records to the correct services. Change one record at a time and keep a copy of the existing zone.', to: '/services#dns-records' },
]

const GUIDES = [
  { title: 'Point a Namecheap domain to web hosting without breaking email', slug: 'point-a-namecheap-domain-to-web-hosting-without-breaking-email', detail: 'Compare changing nameservers with editing individual DNS records, and keep MX records intact when web and email use different providers.' },
  { title: 'A, AAAA, CNAME, MX and TXT records explained for business websites', slug: 'a-aaaa-cname-mx-and-txt-records-explained-for-business-websites', detail: 'Learn what common DNS records do, where they belong and how to verify that a change reaches the intended hostname.' },
  { title: 'Set up SPF, DKIM and DMARC for a domain email address', slug: 'set-up-spf-dkim-and-dmarc-for-a-domain-email-address', detail: 'Understand the domain authentication records that help receiving mail systems assess messages sent from your domain.' },
  { title: 'Understand DNS TTL and propagation during a website migration', slug: 'understand-dns-ttl-and-propagation-during-a-website-migration', detail: 'Plan DNS cutovers, account for resolver caching and verify both the old and new destinations during a transition.' },
  { title: 'Compare shared, managed WordPress and VPS hosting by workload', slug: 'compare-shared-managed-wordpress-and-vps-hosting-by-workload', detail: 'Match a hosting model to site traffic, application control, maintenance capacity and predictable resource needs.' },
  { title: 'Plan a hosting migration with DNS and SEO checks', slug: 'plan-a-hosting-migration-with-dns-and-seo-checks', detail: 'Use a staged migration checklist for backups, redirects, TLS, crawlability, forms and post-launch monitoring.' },
]

const HELP_TOPICS = [
  { question: 'Can I add products to my cart without creating an account?', answer: 'Yes. You can browse plans, add domain registration, hosting or both as separate cart items, and review the billing summary as a guest. An account is required when you proceed to checkout so the order, payment and services can be attached to your account. A domain name is optional when buying hosting; you can connect one later.' },
  { question: 'Are domain registration and hosting one purchase?', answer: 'They are separate services and separate cart items. You can register or transfer a domain without buying hosting, buy hosting without registering a domain, or add both to the same cart. Registering a domain does not automatically configure DNS or create a hosting account; those steps depend on the products ordered and their provisioning status.' },
  { question: 'How do I connect an existing domain to a hosting plan?', answer: 'First confirm the domain is active and that you can edit its DNS. In the domain account, update the nameservers if you intend to use the hosting provider’s DNS, or change only the required web records if you want to keep DNS elsewhere. Add the domain in your hosting control panel, configure the site, and verify HTTPS and email. Keep existing MX and mail-authentication records when email is hosted separately.' },
  { question: 'What should I check before changing nameservers or DNS?', answer: 'Save or export the current DNS zone first. Record web, email and verification entries, including A/AAAA, CNAME, MX, TXT and any provider-specific records. Enter the replacement zone at the destination before switching nameservers. DNS caches can make the old and new answers appear at different times, so verify from more than one network and avoid deleting the old service until traffic has moved.' },
  { question: 'How does a domain transfer work?', answer: 'A transfer moves registrar management for an eligible domain. Confirm the domain can be transferred under its registry rules, unlock it where required, obtain its authorization code and make sure you can receive approval messages at the registrant contact. Start the transfer with the gaining registrar and respond to verification requests. A transfer does not necessarily move hosting, website files, DNS hosting or email; plan those separately and avoid changing nameservers unless you intend to.' },
  { question: 'Where can I find invoices and order progress?', answer: 'After checkout, sign in and open your account’s Orders or Invoices area. The order shows its current status; an invoice shows billed items and payment balance. A paid order can still require provisioning or verification before a service is ready. If a status is unclear, include the order number when contacting support and do not submit a duplicate payment while a transaction is being checked.' },
  { question: 'How do renewals, cancellations and refunds work?', answer: 'Check the product terms and invoice for the applicable renewal period, cancellation rules and refund eligibility; domain and hosting policies can differ. A cancellation request may stop future renewal without immediately deleting an active service. Before changing or cancelling a service, back up site files, databases and email, and confirm where your domain’s DNS and registration will remain. Contact support with the order number if the account page does not show the action you need.' },
  { question: 'What information should I send to support?', answer: 'Share the account email, order or invoice number, affected domain or service, the approximate start time with timezone, the exact error text and the steps that reproduce it. Include screenshots with passwords, payment-card details, authentication codes and private keys removed. Never send a hosting password or one-time login code in a support message.' },
]

export function HelpCenterPage() {
  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader dark />
      <SEO title="DNS, Nameserver & Domain Help Center | MavenHost" description="Learn how DNS records and authoritative nameservers work, connect a domain to hosting, protect email during DNS changes and manage supported settings in your MavenHost account." path="/help-center" />

      <section id="knowledge-resources" className="relative scroll-mt-28 overflow-hidden hero-neutral py-16 text-maven-text">
        <div className="container-shell relative">
          <span className="chip">Help Center</span>
          <h1 className="mt-4 max-w-2xl text-[2.15rem] font-semibold tracking-tight sm:text-[2.5rem]">Practical help for domains, hosting and websites.</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-maven-muted">Use these steps and guides to plan a purchase, configure DNS, protect email during a move and understand what happens after checkout. If something is account-specific, our support team can investigate it with you.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/contact?type=support" className="btn btn-primary"><LifeBuoy className="size-4" /> Contact support</Link>
            <Link to="/blog" className="inline-flex items-center gap-2 rounded-lg border border-maven-line px-4 py-2.5 text-sm font-semibold text-maven-text hover:bg-maven-signal/5"><BookOpen className="size-4" /> Browse technical articles</Link>
          </div>
        </div>
      </section>

      <main id="main-content" className="container-shell py-14">
        <section aria-labelledby="start-here-heading">
          <SectionHeading kicker="Start here" title="Choose the next step for your website." description="These services are related, but each has its own setup and billing. Start with the product you need, then connect them when you are ready." />
          <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {GETTING_STARTED.map(({ icon: Icon, title, body, to }) => <Link key={title} to={to} className="panel group p-5 transition hover:-translate-y-0.5 hover:border-maven-signal/40">
              <div className="icon-tile on-light"><Icon className="size-5" /></div><h3 className="mt-4 text-[15px] font-semibold text-maven-ink">{title}</h3><p className="mt-2 text-sm leading-6 text-maven-muted">{body}</p><span className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-maven-signal">Explore <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
            </Link>)}
          </div>
        </section>

        <section id="dns-and-nameservers" className="mt-16 scroll-mt-28" aria-label="DNS and nameserver guidance">
          <SectionHeading kicker="DNS & nameservers" title="Choose the right kind of DNS change." description="DNS records send individual hostnames to services. Authoritative nameservers decide which provider publishes the DNS zone for the whole domain. Knowing which one to change helps keep websites and email online." />
          <div className="mt-7 grid gap-5 lg:grid-cols-2">
            <article className="panel p-6">
              <div className="icon-tile on-light"><DatabaseZap className="size-5" /></div>
              <h3 className="mt-4 text-lg font-semibold text-maven-ink">Edit DNS records</h3>
              <p className="mt-2 text-sm leading-6 text-maven-muted">Use this when you want to keep the current DNS provider and point only a website, mail service, or verification hostname somewhere else.</p>
              <dl className="mt-4 space-y-3 text-sm leading-6">
                <div><dt className="font-semibold text-maven-ink">A / AAAA</dt><dd className="text-maven-muted">Direct a hostname to an IPv4 or IPv6 address.</dd></div>
                <div><dt className="font-semibold text-maven-ink">CNAME</dt><dd className="text-maven-muted">Alias one hostname to another, where the provider permits it.</dd></div>
                <div><dt className="font-semibold text-maven-ink">MX</dt><dd className="text-maven-muted">Route incoming email to the mail provider. Keep these when changing website hosting.</dd></div>
                <div><dt className="font-semibold text-maven-ink">TXT</dt><dd className="text-maven-muted">Prove domain ownership and publish email policies such as SPF, DKIM and DMARC.</dd></div>
                <div><dt className="font-semibold text-maven-ink">CAA / NS</dt><dd className="text-maven-muted">Restrict certificate issuers or delegate a subdomain to other nameservers.</dd></div>
              </dl>
            </article>
            <article className="panel p-6">
              <div className="icon-tile on-light"><Globe2 className="size-5" /></div>
              <h3 className="mt-4 text-lg font-semibold text-maven-ink">Change authoritative nameservers</h3>
              <p className="mt-2 text-sm leading-6 text-maven-muted">Use this when you intend to move DNS management to another provider. The new provider must have the complete zone before you switch delegation at the registrar.</p>
              <ol className="mt-4 space-y-3 text-sm leading-6 text-maven-muted">
                <li><span className="font-semibold text-maven-ink">1. Save the current zone.</span> Copy every website, email, verification and subdomain record.</li>
                <li><span className="font-semibold text-maven-ink">2. Recreate records at the destination.</span> Confirm the new provider returns the expected answers before switching.</li>
                <li><span className="font-semibold text-maven-ink">3. Change nameservers at the registrar.</span> This changes where the domain’s DNS zone is managed; it does not transfer the domain or move website files.</li>
                <li><span className="font-semibold text-maven-ink">4. Verify and keep a rollback window.</span> Resolver caches refresh at different times. Keep the old zone and services available while checking the website and email.</li>
              </ol>
            </article>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-maven-line bg-white p-5">
            <p className="max-w-3xl text-sm leading-6 text-maven-muted"><span className="font-semibold text-maven-ink">In your MavenHost account:</span> open Account → Domain List → choose a domain → DNS and nameservers. Record and nameserver controls depend on registrar support. If a setting is unavailable, confirm which provider is authoritative or ask support before changing the zone.</p>
            <Link to="/account/domains" className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-maven-signal">Open domain manager <ArrowRight className="size-4" /></Link>
          </div>
        </section>

        <section id="guides" className="mt-16 scroll-mt-28" aria-labelledby="guides-heading">
          <SectionHeading kicker="Guides" title="Step-by-step answers for common setup work." description="Each guide explains the task, the decisions to make first and checks to run after a change. Provider interfaces differ, so use the linked official documentation for the exact controls in your account." />
          <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {GUIDES.map((guide) => <Link key={guide.slug} to={`/blog/${guide.slug}`} className="panel group flex flex-col p-5 transition hover:border-maven-signal/40">
              <span className="icon-tile on-light size-10"><BookOpen className="size-4" /></span><h3 className="mt-4 text-[15px] font-semibold leading-6 text-maven-ink">{guide.title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-maven-muted">{guide.detail}</p><span className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-maven-signal">Read guide <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
            </Link>)}
          </div>
          <div className="mt-6 rounded-xl border border-maven-line bg-white p-5 text-sm leading-6 text-maven-muted"><p className="font-semibold text-maven-ink">Before you make a production change</p><p className="mt-1">Save the current configuration, confirm you can restore it, and make one change at a time. DNS and mail changes can affect services outside your website. Check the result from the user’s point of view and keep the previous setup available until the new one is verified.</p></div>
        </section>

        <section className="mt-16" aria-labelledby="answers-heading">
          <SectionHeading kicker="Knowledge base" title="Answers to common customer questions." description="These general answers help you plan. Use the selected product’s specifications, current prices and your actual order status for a purchase. Hosting checkout remains pending supplier activation." />
          <div className="mt-6 space-y-3">
            {HELP_TOPICS.map(({ question, answer }) => <details key={question} className="panel group p-0">
              <summary className="flex cursor-pointer list-none items-start gap-3 p-5 marker:hidden"><CircleHelp className="mt-0.5 size-5 shrink-0 text-maven-signal" /><span className="flex-1 font-semibold text-maven-ink">{question}</span><span aria-hidden="true" className="text-xl leading-none text-maven-signal transition-transform group-open:rotate-45">+</span></summary>
              <p className="border-t border-maven-line px-5 py-4 pl-[3.25rem] text-sm leading-7 text-maven-muted">{answer}</p>
            </details>)}
          </div>
        </section>

        <section className="mt-16 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]" aria-labelledby="support-heading">
          <div className="panel p-6">
            <SectionHeading kicker="Human support" title="Give us enough detail to investigate." description="For a billing or service issue, include the account email, order number, affected domain, what you expected to happen, what happened instead and when you first noticed it. Remove passwords, card data and authentication codes from screenshots." />
            <div className="mt-5 flex flex-wrap gap-4 text-sm">
              <Link to="/contact?type=support" className="inline-flex items-center gap-2 font-semibold text-maven-signal"><Mail className="size-4" /> Open a support request</Link>
              <a href={whatsappUrl('Hello MavenHost, I need help with my account or service.')} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2 font-semibold text-maven-signal"><MessageCircle className="size-4" /> Contact us via WhatsApp</a>
            </div>
          </div>
          <div className="panel p-6">
            <h2 id="support-heading" className="flex items-center gap-2 text-base font-semibold text-maven-ink"><CheckCircle2 className="size-5 text-maven-signal" /> Before you submit</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-maven-muted">
              <li>Include the exact error message and steps that reproduce it.</li>
              <li>Share the affected domain or service and approximate time with timezone.</li>
              <li>Tell us whether the issue affects one device/network or multiple users.</li>
              <li>Do not include passwords, payment-card numbers, private keys or one-time codes.</li>
            </ul>
          </div>
        </section>

        <section id="platform-status" className="mt-16 scroll-mt-28 rounded-2xl border border-maven-line bg-white p-6 sm:p-8" aria-labelledby="platform-status-heading">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-maven-signal/10 text-maven-signal"><Radio className="size-5" /></span>
            <div className="min-w-0">
              <p className="mono text-xs font-semibold uppercase tracking-[0.14em] text-maven-signal">Status Updates</p>
              <h2 id="platform-status-heading" className="mt-1 text-xl font-semibold tracking-tight text-maven-ink">Service notices and incident help</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-maven-muted">Public maintenance and incident notices will be listed here when published. This page does not currently display live uptime measurements or automatically confirm that an individual domain, server or account is operational. For a current service check, contact support with the affected service and the time the problem began.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-maven-paper p-4"><p className="text-sm font-semibold text-maven-ink">What to report</p><p className="mt-1 text-sm leading-6 text-maven-muted">Domain or service, error message, approximate start time, timezone and who is affected.</p></div>
            <div className="rounded-xl bg-maven-paper p-4"><p className="text-sm font-semibold text-maven-ink">What an update should include</p><p className="mt-1 text-sm leading-6 text-maven-muted">Affected service, known impact, current investigation or maintenance details, and the next confirmed update.</p></div>
            <div className="rounded-xl bg-maven-paper p-4"><p className="text-sm font-semibold text-maven-ink">Where to get help now</p><p className="mt-1 text-sm leading-6 text-maven-muted">Open a support request for account-specific checks. Include the order number when the issue concerns a recent purchase.</p></div>
          </div>
          <Link to="/contact?type=support" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-maven-signal"><MessageCircle className="size-4" /> Contact customer support <ArrowRight className="size-3.5" /></Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
