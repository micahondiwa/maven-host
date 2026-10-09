import 'server-only'
import { authenticate } from '../auth/session'
import { json, Router } from '../http/router'
import { hostingRoutes } from './hosting'

/** config/urls.py: every `/api/v1/` include, in v1 order. */
export const api = new Router().include('/api/v1/hosting/', hostingRoutes)

/** Operations not yet ported fail closed; they are never proxied to the v1 Django service. */
function migrationInProgress() {
  return json({ message: 'This operation is not available in the local migration build.', code: 'migration_in_progress' }, 503)
}

export function handleApi(request: Request) {
  const path = new URL(request.url).pathname
  return api.dispatch(request, path.endsWith('/') ? path : `${path}/`, authenticate, migrationInProgress)
}
