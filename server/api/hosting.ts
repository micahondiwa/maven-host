import 'server-only'
import { AllowAny, Router } from '../http/router'
import { getPublicPlan, listPublicPlans } from '../hosting/catalog'

/** apps/hosting/api/urls.py */
export const hostingRoutes = new Router()
  .get('plans/<slug:slug>/', (ctx) => getPublicPlan(ctx.params.slug, ctx.query), { authenticate: false, permissions: [AllowAny] })
  .get('plans/', (ctx) => listPublicPlans(ctx.query), { authenticate: false, permissions: [AllowAny] })
