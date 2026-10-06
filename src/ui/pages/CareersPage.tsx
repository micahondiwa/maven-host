import { Mail } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { SEO } from '../components/SEO'

export function CareersPage() {
  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader dark />
      <SEO title="Careers and Partnerships | MavenHost" description="Contact MavenHost about future roles, contract work or partnerships in domains, web hosting and website services." path="/careers" />
      <main id="main-content"><section className="hero-neutral py-16 text-maven-text sm:py-20">
        <div className="container-shell">
          <span className="chip">Careers and partnerships</span>
          <h1 className="mt-5 max-w-3xl text-[2.5rem] font-semibold leading-tight tracking-tight sm:text-[3.25rem]">Interested in working with MavenHost?</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-7 text-maven-muted">There are no current openings listed here. For future opportunities, contract work or partnerships, send a short introduction and relevant experience to our team.</p>
          <a href="mailto:info@maven-host.com?subject=Careers%20and%20partnerships" className="btn btn-bright mt-7"><Mail className="size-4" /> Contact MavenHost</a>
        </div>
      </section></main>
      <SiteFooter />
    </div>
  )
}
