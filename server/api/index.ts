import 'server-only'
import { authenticate } from '../auth/session'
import { json, Router } from '../http/router'
import { authorizationRoutes, authRoutes, customerStaffRoutes, staffRoutes } from './accounts'
import { hostingRoutes, staffCustomerHostingRoutes } from './hosting'
import { aiRoutes, websiteRoutes } from './websites'
import { customerRoutes, domainRoutes, staffCustomerDomainRoutes } from './domains'
import { billingRoutes, notificationRoutes, orderRoutes, staffCommerceRoutes } from './commerce'
import { bootstrap } from '../bootstrap'
import { contactRoutes, customerTicketRoutes, staffTicketRoutes } from './support'
import { blogRoutes } from './blog'

/** config/urls.py: every `/api/v1/` include, in v1 order. */
export const api = new Router()
  .include('/api/v1/auth/', authRoutes)
  .include('/api/v1/staff/customers/', customerStaffRoutes)
  .include('/api/v1/staff/customers/<uuid:customer_id>/support/tickets/', staffTicketRoutes)
  .include('/api/v1/staff/customers/', staffCustomerHostingRoutes)
  .include('/api/v1/staff/customers/', staffCustomerDomainRoutes)
  .include('/api/v1/staff/customers/', staffCommerceRoutes)
  .include('/api/v1/staff/', staffRoutes)
  .include('/api/v1/authorization/', authorizationRoutes)
  .include('/api/v1/domains/', domainRoutes)
  .include('/api/v1/hosting/', hostingRoutes)
  .include('/api/v1/ai/', aiRoutes)
  .include('/api/v1/websites/', websiteRoutes)
  .include('/api/v1/orders/', orderRoutes)
  .include('/api/v1/billing/', billingRoutes)
  .include('/api/v1/notifications/', notificationRoutes)
  .include('/api/v1/customer/', customerRoutes)
  .include('/api/v1/blog/', blogRoutes)
  .include('/api/v1/contact/', contactRoutes)
  .include('/api/v1/support/', customerTicketRoutes)

/** Operations not yet ported fail closed; they are never proxied to the v1 Django service. */
function migrationInProgress() {
  return json({ message: 'This operation is not available in the local migration build.', code: 'migration_in_progress' }, 503)
}

export function handleApi(request: Request) {
  bootstrap()
  const path = new URL(request.url).pathname
  return api.dispatch(request, path.endsWith('/') ? path : `${path}/`, authenticate, migrationInProgress)
}
