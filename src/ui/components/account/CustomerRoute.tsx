import type { ReactNode } from 'react'
import { Navigate, useLocation } from '@/lib/navigation'
import { useAuth } from '../../lib/auth'

export function CustomerRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-maven-surface">
        <div className="text-center">
          <div className="mx-auto size-9 animate-spin rounded-full border-4 border-slate-200 border-t-maven-blue" />
          <p className="mt-3 text-sm font-semibold text-slate-600">Loading your account…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return children
}
