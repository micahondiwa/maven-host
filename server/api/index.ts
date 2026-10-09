import 'server-only'
import { authenticate } from '../auth/session'
import { json, Router } from '../http/router'
import { authorizationRoutes, authRoutes, customerStaffRoutes, staffRoutes } from './accounts'
import { hostingRoutes } from './hosting'
import { aiRoutes, websiteRoutes } from './websites'
import { customerRoutes, domainRoutes, staffCustomerDomainRoutes } from './domains'

/** config/urls.py: every `/api/v1/` include, in v1 order. */
export const api = new Router()
  .include('/api/v1/auth/', authRoutes)
  .include('/api/v1/staff/customers/', customerStaffRoutes)
  .include('/api/v1/staff/customers/', staffCustomerDomainRoutes)
  .include('/api/v1/staff/', staffRoutes)
  .include('/api/v1/authorization/', authorizationRoutes)
  .include('/api/v1/domains/', domainRoutes)
  .include('/api/v1/hosting/', hostingRoutes)
  .include('/api/v1/ai/', aiRoutes)
  .include('/api/v1/websites/', websiteRoutes)
  .include('/api/v1/customer/', customerRoutes)

/** Operations not yet ported fail closed; they are never proxied to the v1 Django service. */
function migrationInProgress() {
  return json({ message: 'This operation is not available in the local migration build.', code: 'migration_in_progress' }, 503)
}

export function handleApi(request: Request) {
  const path = new URL(request.url).pathname
  return api.dispatch(request, path.endsWith('/') ? path : `${path}/`, authenticate, migrationInProgress)
}
