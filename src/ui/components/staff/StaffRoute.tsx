import { Navigate, Outlet, useLocation } from '@/lib/navigation'
import { useAuth } from '../../lib/auth'

export function StaffRoute() {
  const { user, loading, isStaff } = useAuth()
  const location = useLocation()

  if (loading) return <div className="grid min-h-screen place-items-center bg-maven-surface"><div className="text-center"><div className="mx-auto size-9 animate-spin rounded-full border-4 border-slate-200 border-t-maven-blue" /><p className="mt-3 text-sm font-semibold text-slate-600">Checking your staff access…</p></div></div>
  if (!user) return <Navigate to="/staff/login" replace state={{ from: location.pathname }} />
  if (!isStaff) return <Navigate to="/" replace />
  return <Outlet />
}

export function StaffPermissionRoute({ permission }: { permission: string }) {
  const { hasPermission } = useAuth()
  const location = useLocation()
  if (!hasPermission(permission)) return <Navigate to="/staff" replace state={{ denied: location.pathname }} />
  return <Outlet />
}
