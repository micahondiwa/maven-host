import type { ReactNode } from 'react'
import { Navigate, useLocation } from '@/lib/navigation'
import { useAuth } from '../../lib/auth'

export function StaffRoute({ children }: { children: ReactNode }) {
  const { user, loading, isStaff } = useAuth()
  const location = useLocation()

  if (loading) return <div className="grid min-h-screen place-items-center bg-maven-surface"><div className="text-center"><div className="mx-auto size-9 animate-spin rounded-full border-4 border-slate-200 border-t-maven-blue" /><p className="mt-3 text-sm font-semibold text-slate-600">Checking your staff access…</p></div></div>
  if (!user) return <Navigate to="/staff/login" replace state={{ from: location.pathname }} />
  if (!isStaff) return <Navigate to="/" replace />
  return children
}

/** Renders the page only when the staff member holds every listed permission (v1 nested these guards). */
export function StaffPermissionRoute({ permissions, children }: { permissions: string[]; children: ReactNode }) {
  const { hasPermission } = useAuth()
  const location = useLocation()
  if (!permissions.every((permission) => hasPermission(permission))) return <Navigate to="/staff" replace state={{ denied: location.pathname }} />
  return children
}
