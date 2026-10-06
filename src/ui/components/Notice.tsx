import type { ReactNode } from 'react'
export function Notice({ children, title }: { children: ReactNode; title?: string }) {
  return <aside className="notice"><p>{title && <strong className="mr-1 font-semibold text-maven-text">{title}</strong>}{children}</p></aside>
}
