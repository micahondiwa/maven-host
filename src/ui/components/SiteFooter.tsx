import { SocialIcon } from './SocialIcon'
import { Link } from '@/lib/navigation'
import { Mail } from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import { CONTACT, INARA_CREST, SOCIAL_LINKS, isSafeExternalUrl, socialHandle } from '../lib/site'

const COLUMNS: { heading: string; links: { label: string; to: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Domain search', to: '/domains' },
      { label: 'Web hosting', to: '/hosting' },
      { label: 'Reseller hosting', to: '/hosting?category=reseller' },
      { label: 'Email hosting', to: '/hosting?category=email' },
      { label: 'Managed VPS', to: '/hosting?category=vps' },
      { label: 'Dedicated servers', to: '/hosting?category=dedicated' },
      { label: 'Services', to: '/services' },
      { label: 'AI website builder', to: '/ai-builder' },
      { label: 'Pricing', to: '/hosting' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Create account', to: '/register' },
      { label: 'My domains', to: '/account/domains' },
      { label: 'My hosting', to: '/account/hosting' },
      { label: 'Invoices', to: '/account/invoices' },
    ],
  },
  {
    heading: 'Help Center',
    links: [
      { label: 'Knowledge base', to: '/help-center' },
      { label: 'Blogs', to: '/blog' },
      { label: 'Developers', to: '/developers' },
      { label: 'Support', to: '/contact?type=support' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Careers', to: '/careers' },
      { label: 'Staff sign in', to: '/staff/login' },
      { label: 'Contact us', to: '/contact' },
    ],
  },
]

const QUICK_LINKS = [
  { label: 'Search domain names', to: '/domains' },
  { label: 'Compare hosting plans', to: '/hosting' },
  { label: 'Transfer a domain', to: '/domains#domain-transfer-heading' },
  { label: 'Build a website with AI', to: '/ai-builder' },
  { label: 'Browse developer services', to: '/developers' },
  { label: 'Read the latest guides', to: '/blog' },
  { label: 'Get customer support', to: '/contact?type=support' },
  { label: 'Contact MavenHost', to: '/contact' },
]

const FAQS = [
  { question: 'What does a domain purchase include?', answer: 'Registration gives you the right to use the named domain for the purchased term, subject to registrar rules. Hosting, website development and email subscriptions are separate. Availability is not reserved by a search or cart selection.' },
  { question: 'Can I buy hosting for a domain I already own?', answer: 'Yes, the selection does not require a new domain registration. Shared plans use one cPanel account for their listed websites; additional websites do not mean separate cPanel accounts. Hosting checkout and activation are currently pending supplier setup.' },
  { question: 'What will I pay for a hosting billing period?', answer: 'The plan shows the total charged for its selected period in USD. A monthly equivalent is a comparison figure, not a monthly instalment. The catalog shows renewal prices where available and identifies VAT already included in the offer. Confirm configuration-dependent licences and other charges before purchase.' },
  { question: 'Is business email included?', answer: 'The email category shows cPanel hosting plans with the published number of mailboxes and shared account storage. Aliases and forwarding are different from stored mailboxes. Google Workspace and Microsoft 365 are not included, and ordinary hosting email does not include a bulk-mail service or guaranteed inbox placement.' },
  { question: 'Can you move my website or domain?', answer: 'Send the current domain, registrar and hosting setup to support. Eligibility, access, migration scope and fees need confirmation. A registrar transfer does not itself move website files or email, and expired-domain recovery follows different rules.' },
  { question: 'Who helps with application code?', answer: 'MavenHost supports purchased domain and hosting services within the approved support scope. Application development, custom code changes and broader maintenance are separate Inara Crest Devs engagements. They are not included automatically with a MavenHost plan.' },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-maven-ink text-white">
      <div className="container-shell grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div>
          <BrandLogo light footer />
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/75">
            Domains, hosting and infrastructure for businesses that need a dependable digital home.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-white/80">
            <a href={CONTACT.emailHref} className="inline-flex items-center gap-2 transition hover:text-white">
              <Mail className="size-4" /> {CONTACT.email}
            </a>
          </div>

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/75">Follow MavenHost</p>
            <div className="mt-3 flex items-center gap-2">
              {SOCIAL_LINKS.map((social) => {
                if (!isSafeExternalUrl(social.href)) return null
                return (
                  <a
                    key={social.key}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`MavenHost on ${social.label}`}
                    title={`${socialHandle(social.key)} on ${social.label}`}
                    className="grid size-9 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/60 transition hover:border-maven-bright/50 hover:bg-maven-bright/10 hover:text-maven-bright"
                  >
                    <SocialIcon name={social.key} className="size-5" />
                  </a>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-white/70">TikTok: @maven.host</p><p className="mt-4 text-xs leading-6 text-white/75">A hosting platform from <a href={INARA_CREST.home} target="_blank" rel="noreferrer" className="underline underline-offset-2">Inara Crest Technologies<span className="sr-only"> (opens in a new tab)</span></a>.</p>
          </div>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/75">{col.heading}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link to={link.to} className="text-sm text-white/80 transition hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="bg-[#080D14]">
      <div className="container-shell grid gap-10 border-t border-white/10 py-10 lg:grid-cols-[0.85fr_1.65fr]">
        <section aria-labelledby="footer-quick-links">
          <h2 id="footer-quick-links" className="text-sm font-semibold text-white">Quick links</h2>
          <ul className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {QUICK_LINKS.map((link) => (
              <li key={link.label}>
                <Link to={link.to} className="text-sm text-white/75 transition hover:text-maven-bright">{link.label}</Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="footer-faq">
          <h2 id="footer-faq" className="text-sm font-semibold text-white">Frequently asked questions</h2>
          <div className="mt-3 divide-y divide-white/10 border-y border-white/10">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-white/90 marker:hidden [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span aria-hidden="true" className="shrink-0 text-lg leading-none text-maven-bright transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 max-w-3xl pr-8 text-sm leading-6 text-white/65">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
      <div className="container-shell flex flex-col gap-3 border-t border-white/10 py-5 text-xs text-white/70 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} MavenHost. All rights reserved.</p>
        <Link to="/contact?type=support" className="transition hover:text-white">Contact support</Link>
      </div>
      </div>
    </footer>
  )
}
