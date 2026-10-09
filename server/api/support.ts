import 'server-only'
import { queryOne } from '../db'
import { AllowAny, json, Router, type Context } from '../http/router'
import { notFound, ValidationError } from '../http/errors'
import { f, validate } from '../http/validation'
import { staffPermission } from '../auth/permissions'
import * as support from '../support/service'

/** apps/support/api (contact_urls.py, urls.py) and customer self-service tickets. */

export const contactRoutes = new Router().post('', async (ctx) => {
  const data = validate(
    {
      request_type: f.choice(Object.keys(support.CONTACT_TYPES) as support.ContactType[]),
      name: f.string({ maxLength: 120 }),
      email: f.email({ maxLength: 254 }),
      phone: f.string({ maxLength: 40, allowBlank: true, default: '' }),
      subject: f.string({ maxLength: 200 }),
      message: f.string({ maxLength: 10000 }),
    },
    await ctx.body(),
  )
  return json(await support.submitContactRequest(data), 201)
}, { authenticate: false, permissions: [AllowAny], throttle: 'public_contact' })

export const customerTicketRoutes = new Router()
  .get('tickets/', (ctx) => support.listTickets(ctx.authenticatedUser.id))
  .post('tickets/', async (ctx) => {
    const data = validate(
      {
        subject: f.string({ maxLength: 200 }),
        description: f.string({ maxLength: 10000 }),
        category: f.choice(support.TICKET_CATEGORIES, { default: 'general' }),
        priority: f.choice(support.TICKET_PRIORITIES, { default: 'normal' }),
      },
      await ctx.body(),
    )
    return json(await support.openTicket(ctx.authenticatedUser.id, data), 201)
  }, { throttle: 'public_contact' })
  .get('tickets/<uuid:ticket_id>/', (ctx) => support.ticketDetail(ctx.authenticatedUser.id, ctx.params.ticket_id, { includeInternal: false }))
  .post('tickets/<uuid:ticket_id>/reply/', async (ctx) => {
    const data = validate({ body: f.string({ maxLength: 10000 }) }, await ctx.body())
    return json(await support.customerReply(ctx.authenticatedUser.id, ctx.params.ticket_id, data.body), 201)
  })

async function staffCustomer(ctx: Context) {
  if (!(await queryOne('SELECT 1 FROM accounts_user WHERE id = $1 AND NOT is_staff AND NOT is_superuser', [ctx.params.customer_id]))) throw notFound('No User matches the given query.')
}

function idempotencyKey(ctx: Context) {
  const key = ctx.header('idempotency-key')
  if (!key || key.length > 255) throw new ValidationError({ 'Idempotency-Key': ['A unique Idempotency-Key header is required (max 255 characters).'] })
  return key
}

const can = (code: string) => ({ permissions: [staffPermission('view_customer'), staffPermission(code)] })

function action(name: 'resolve' | 'close' | 'reopen', permission: string) {
  return [
    `<uuid:ticket_id>/${name}/`,
    async (ctx: Context) => {
      await staffCustomer(ctx)
      validate({ reason: f.string({ maxLength: 500, allowBlank: true }).optional() }, await ctx.body())
      return support.staffTicketAction({ actorId: ctx.authenticatedUser.id, customerId: ctx.params.customer_id, ticketId: ctx.params.ticket_id, action: name, idempotencyKey: idempotencyKey(ctx), ipAddress: ctx.ip })
    },
    can(permission),
  ] as const
}

function message(path: string, name: 'reply' | 'internal_note', permission: string) {
  return [
    `<uuid:ticket_id>/${path}/`,
    async (ctx: Context) => {
      await staffCustomer(ctx)
      const data = validate({ body: f.string({ maxLength: 10000 }) }, await ctx.body())
      return json(await support.staffTicketAction({ actorId: ctx.authenticatedUser.id, customerId: ctx.params.customer_id, ticketId: ctx.params.ticket_id, action: name, idempotencyKey: idempotencyKey(ctx), ipAddress: ctx.ip, body: data.body }), 201)
    },
    can(permission),
  ] as const
}

/** /api/v1/staff/customers/<customer_id>/support/tickets/... */
export const staffTicketRoutes = new Router()
  .get('', async (ctx) => {
    await staffCustomer(ctx)
    return support.listTickets(ctx.params.customer_id)
  }, can('view_ticket'))
  .get('<uuid:ticket_id>/', async (ctx) => {
    await staffCustomer(ctx)
    return support.ticketDetail(ctx.params.customer_id, ctx.params.ticket_id, { includeInternal: true })
  }, can('view_ticket'))
  .post('<uuid:ticket_id>/assign/', async (ctx) => {
    await staffCustomer(ctx)
    const data = validate({ staff_id: f.uuid() }, await ctx.body())
    return support.staffTicketAction({ actorId: ctx.authenticatedUser.id, customerId: ctx.params.customer_id, ticketId: ctx.params.ticket_id, action: 'assign', idempotencyKey: idempotencyKey(ctx), ipAddress: ctx.ip, assigneeId: data.staff_id })
  }, can('assign_ticket'))
  .post(...action('resolve', 'resolve_ticket'))
  .post(...action('close', 'close_ticket'))
  .post(...action('reopen', 'reopen_ticket'))
  .post(...message('reply', 'reply', 'reply_ticket'))
  .post(...message('internal-note', 'internal_note', 'add_internal_note'))
