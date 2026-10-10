import 'server-only'
import { json, Router, type Context, type Permission } from '../http/router'
import * as admin from '../admin/service'

/** /api/v1/staff/admin/ — generic staff administration (replaces the Django admin for operational data). */

const isStaff: Permission = (ctx) => Boolean(ctx.user?.is_staff)
const STAFF = { permissions: [isStaff], throttle: 'staff_management' }
const resource = (ctx: Context) => admin.visibleResource(ctx.authenticatedUser, ctx.params.resource)

export const adminRoutes = new Router()
  .get('', (ctx) => admin.listResources(ctx.authenticatedUser), STAFF)
  .get('<slug:resource>/', async (ctx) => {
    const target = await resource(ctx)
    return { meta: await admin.resourceMeta(ctx.authenticatedUser, target), ...(await admin.listRecords(target, ctx.url)) }
  }, STAFF)
  .post('<slug:resource>/', async (ctx) => json(await admin.createRecord(ctx.authenticatedUser, await resource(ctx), await ctx.body(), ctx.ip), 201), STAFF)
  .get('<slug:resource>/options/<slug:field>/', async (ctx) => admin.refOptions(await resource(ctx), ctx.params.field), STAFF)
  .get('<slug:resource>/<str:id>/', async (ctx) => {
    const target = await resource(ctx)
    return { meta: await admin.resourceMeta(ctx.authenticatedUser, target), record: await admin.recordDetail(target, ctx.params.id) }
  }, STAFF)
  .patch('<slug:resource>/<str:id>/', async (ctx) => admin.updateRecord(ctx.authenticatedUser, await resource(ctx), ctx.params.id, await ctx.body(), ctx.ip), STAFF)
  .post('<slug:resource>/<str:id>/actions/<slug:action>/', async (ctx) => admin.runAction(ctx.authenticatedUser, await resource(ctx), ctx.params.id, ctx.params.action, ctx.ip), STAFF)
