import type { ReactNode } from 'react'
import { CustomerHeader } from '../CustomerHeader'
import { SiteFooter } from '../SiteFooter'
import { AuthSidePanel } from './AuthSidePanel'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-maven-paper">
      <CustomerHeader dark />
      <main id="main-content" className="flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="mx-auto grid min-h-[560px] max-w-[1180px] overflow-hidden rounded-2xl border border-maven-line bg-maven-surface shadow-sm lg:grid-cols-[0.92fr_1.08fr]">
          <section className="hidden lg:block">
            <AuthSidePanel />
          </section>
          <section className="flex items-center bg-maven-surface px-6 py-8 sm:px-10 lg:px-8 xl:px-10">
            <div className="w-full max-w-[500px]">{children}</div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
