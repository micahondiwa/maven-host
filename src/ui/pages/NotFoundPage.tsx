import { ArrowLeft, Home } from 'lucide-react'
import { Link } from '@/lib/navigation'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'

import { SEO } from '../components/SEO'
export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col bg-maven-paper">
      <CustomerHeader dark /><SEO title="Page not found | MavenHost" description="Find domains, hosting and support on MavenHost." path="/404" indexable={false} />
      <main id="main-content" className="container-shell flex flex-1 items-center py-20">
        <div className="mx-auto w-full max-w-2xl text-center">
          <p className="mono text-sm font-semibold text-maven-blue">404 / NOT FOUND</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-maven-ink sm:text-5xl">That page does not exist.</h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-maven-muted">
            The address may be outdated, or the page may have moved. Use one of the links below to continue through MavenHost.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/" className="btn btn-primary"><Home className="size-4" /> Go home</Link>
            <Link to="/domains" className="btn btn-secondary"><ArrowLeft className="size-4" /> Search domains</Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
