import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { DomainSearch } from '../features/domain/DomainSearch'
import { Link } from '@/lib/navigation'
import { ArrowRight, ArrowRightLeft, CheckCircle2 } from 'lucide-react'

import { SEO } from '../components/SEO'
export function DomainsPage() {
  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader dark />
      <SEO title="Domain Registration & Transfers | MavenHost" description="Search and register .co.ke, .ke, .com and other domains, or ask MavenHost to guide your domain transfer from another registrar." path="/domains" />
      <main id="main-content">
        <section className="relative isolate overflow-hidden hero-neutral pb-14 pt-2 text-maven-text sm:pb-16 sm:pt-3 lg:pb-20 lg:pt-4">
          <div className="container-shell relative">
            <div id="domain-search" className="panel-raised w-full scroll-mt-24 bg-white p-1.5 text-maven-ink shadow-sm">
              <DomainSearch compact />
            </div>
            <div className="mt-7 max-w-3xl sm:mt-9">
              <span className="chip">Domain search</span>
              <h1 className="mt-4 text-[2.35rem] font-semibold leading-[1.08] tracking-tight sm:text-[3.1rem]">Search for a domain name for your business, project or brand.</h1>
              <p className="mt-4 max-w-2xl text-[15px] leading-7 text-maven-muted">Enter a business name or a complete domain. Compare supported extensions, registration and renewal costs, then save your choice to the cart. A search does not reserve a name.</p>
            </div>
          </div>
        </section>
        <section className="container-shell section-space"><h2 className="text-2xl font-semibold text-maven-text">Registration, renewal and recovery are different.</h2><div className="mt-6 grid gap-6 md:grid-cols-3"><article className="service-summary"><h3>Register a new name</h3><p>Availability can change before registration completes. Compare the extension, current registration price and renewal price. Premium names need separate price confirmation.</p></article><article className="service-summary"><h3>Keep an existing name</h3><p>Renewal extends a registration you already hold. A transfer changes the registrar and may have different eligibility and fee rules; it is not a new registration.</p></article><article className="service-summary"><h3>Recover an expired name</h3><p>Recovery depends on the extension, expiry stage and registrar. Additional charges may apply. Contact support with the domain before assuming that an ordinary renewal will restore it.</p></article></div></section>
        <section className="container-shell pb-16" aria-labelledby="domain-transfer-heading">
          <div className="grid gap-8 rounded-3xl border border-maven-line bg-white p-6 shadow-sm sm:p-9 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div>
              <span className="chip">Move your domain</span>
              <h2 id="domain-transfer-heading" className="mt-4 text-2xl font-semibold tracking-tight text-maven-ink sm:text-3xl">Transfer a domain to MavenHost</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-maven-muted">Send the domain and current registrar so support can confirm transfer eligibility, authorization requirements, any extension-specific waiting period and the current fee. Moving the registrar does not automatically move website files or email.</p>
              <Link to="/contact?type=support&subject=Domain%20transfer%20request" className="btn btn-primary mt-6">Ask about a transfer <ArrowRight className="size-4" /></Link>
            </div>
            <div className="rounded-2xl bg-maven-paper p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-maven-ink">What to include in your request</h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-maven-muted">
                <li className="flex gap-2.5"><CheckCircle2 className="mt-1 size-4 shrink-0 text-maven-signal" />The full domain name you want to transfer</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-1 size-4 shrink-0 text-maven-signal" />Its current registrar and any transfer deadline</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-1 size-4 shrink-0 text-maven-signal" />Whether you need help preparing the transfer authorization code</li>
              </ul>
              <p className="mt-4 border-t border-maven-line pt-4 text-xs leading-5 text-maven-muted"><ArrowRightLeft className="mr-1 inline size-3.5" />Transfer availability, process and pricing depend on the domain extension and registrar. We confirm these before proceeding.</p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
