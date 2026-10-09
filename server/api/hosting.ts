import 'server-only'
import { AllowAny, json, Router, type Context } from '../http/router'
import { DetailError, notFound } from '../http/errors'
import { queryOne } from '../db'
import { f, validate } from '../http/validation'
import { staffPermission } from '../auth/permissions'
import { getPublicPlan, listPublicPlans } from '../hosting/catalog'
import * as hosting from '../hosting/service'

/** apps/hosting/api/urls.py */

const notAvailable = () => {
  throw new DetailError(hosting.HOSTING_ACTION_NOT_AVAILABLE, 409, 'not_available')
}

function lifecycle(type: 'suspend' | 'unsuspend' | 'terminate') {
  return async (ctx: Context) => {
    const data = validate({ account_id: f.string({ maxLength: 20 }), reason: f.string({ allowBlank: true, maxLength: 500, default: '' }) }, await ctx.body())
    const accountId = hosting.parseAccountId(data.account_id)
    return json(await hosting.requestOperation({ accountId, customerId: ctx.authenticatedUser.id, type, reason: data.reason, actorId: ctx.authenticatedUser.id }), 202)
  }
}

export const hostingRoutes = new Router()
  .get('subscriptions/', (ctx) => hosting.listSubscriptions(ctx.authenticatedUser.id))
  // Reseller child accounts were a WHM feature; the hosting supplier has no verified equivalent yet.
  .get('reseller/accounts/', notAvailable)
  .post('reseller/accounts/', notAvailable)
  .get('plans/<slug:slug>/', (ctx) => getPublicPlan(ctx.params.slug, ctx.query), { authenticate: false, permissions: [AllowAny] })
  .get('plans/', (ctx) => listPublicPlans(ctx.query), { authenticate: false, permissions: [AllowAny] })
  .get('accounts/', async (ctx) => {
    const accountId = ctx.query.get('account_id')
    if (!accountId) return { accounts: await hosting.listAccounts(ctx.authenticatedUser.id) }
    return hosting.accountDetail(ctx.authenticatedUser.id, hosting.parseAccountId(accountId))
  })
  .post('accounts/provision/', async (ctx) => {
    const data = validate(
      {
        domain_id: f.uuid().nullable().optional(),
        domain_name: f.string({ maxLength: 253 }).optional(),
        package_id: f.integer({ min: 1 }),
        username: f.string({ maxLength: 64 }),
        billing_cycle: f.choice(['monthly', 'quarterly', 'semi_annually', 'annually'] as const),
      },
      await ctx.body(),
      { validate: (values) => {
        if (!values.domain_id && !values.domain_name) throw new DetailError('Provide a domain_id or domain_name for the hosting account.', 400)
      } },
    )
    return json(await hosting.provisionHosting({ customerId: ctx.authenticatedUser.id, domainId: data.domain_id, domainName: data.domain_name, packageId: data.package_id, username: data.username, actorId: ctx.authenticatedUser.id }), 201)
  }, { permissions: [staffPermission('create_hosting')] })
  .post('accounts/suspend/', lifecycle('suspend'))
  .post('accounts/unsuspend/', lifecycle('unsuspend'))
  .post('accounts/terminate/', lifecycle('terminate'))
  .post('accounts/password/', notAvailable)
  .post('accounts/package/', notAvailable)
  .get('accounts/operations/<uuid:operation_id>/', (ctx) => hosting.operationStatus(ctx.params.operation_id, ctx.authenticatedUser.id))
  .post('accounts/backup/', notAvailable)
  .get('accounts/backups/', notAvailable)
  .post('accounts/backup/restore/', notAvailable)

/** /api/v1/staff/customers/<customer_id>/hosting/ (apps/accounts/api/views/customer_hosting.py). */
export const staffCustomerHostingRoutes = new Router()
  .get('<uuid:customer_id>/hosting/', async (ctx) => {
    await staffCustomer(ctx)
    return hosting.staffCustomerAccounts(ctx.params.customer_id)
  }, { permissions: [staffPermission('view_customer'), staffPermission('view_hosting')] })
  .get('<uuid:customer_id>/hosting/<int:account_id>/', async (ctx) => {
    await staffCustomer(ctx)
    return hosting.staffCustomerAccounts(ctx.params.customer_id, Number(ctx.params.account_id))
  }, { permissions: [staffPermission('view_customer'), staffPermission('view_hosting')] })

async function staffCustomer(ctx: Context) {
  if (!(await queryOne('SELECT 1 FROM accounts_user WHERE id = $1 AND NOT is_staff AND NOT is_superuser', [ctx.params.customer_id]))) throw notFound('No User matches the given query.')
}
