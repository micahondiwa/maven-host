import type { ReactNode } from 'react'
export function PageIntro({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <section className="hero-neutral page-intro"><div className="container-shell"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="intro-copy">{description}</p>{children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}</div></section>
}
