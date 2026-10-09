import 'server-only'
import { randomUUID } from 'node:crypto'
import { settings } from '../config'
import { database, onCommit, query, queryOne, transaction, type Queryable } from '../db'
import { DetailError, notFound } from '../http/errors'
import { audit } from '../audit/audit'
import { emailAddress, sendBrandedEmail } from '../communications/email'

/** Port of apps/support (contact requests, tickets, idempotent staff operations) plus customer self-service tickets. */

export const CONTACT_TYPES = { general: 'General inquiry', support: 'Customer support', developer: 'Developer services' } as const
export type ContactType = keyof typeof CONTACT_TYPES
export const TICKET_CATEGORIES = ['general', 'domains', 'hosting', 'billing', 'technical', 'account'] as const
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

const contactRouting = (type: ContactType) => {
  const recipients = { general: process.env.GENERAL_INQUIRY_EMAIL?.trim() || 'info@maven-host.com', support: process.env.SUPPORT_INQUIRY_EMAIL?.trim() || 'support@maven-host.com', developer: process.env.DEVELOPER_INQUIRY_EMAIL?.trim() || 'developers@maven-host.com' }
  const senders = { general: settings.email.infoFrom, support: settings.email.supportFrom, developer: settings.email.developerFrom }
  return { recipient: recipients[type], sender: senders[type] }
}

/** PublicContactRequestAPIView */
export async function submitContactRequest(input: { request_type: ContactType; name: string; email: string; phone: string; subject: string; message: string }) {
  const id = randomUUID()
  await database().query(
    `INSERT INTO support_contactrequest (id, request_type, name, email, phone, subject, message, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, input.request_type, input.name, input.email, input.phone, input.subject, input.message],
  )
  const label = CONTACT_TYPES[input.request_type]
  const { recipient, sender } = contactRouting(input.request_type)
  try {
    await sendBrandedEmail({
      subject: `[${label}] ${input.subject}`,
      textContent: `Request type: ${label}\nName: ${input.name}\nEmail: ${input.email}\nPhone: ${input.phone || 'Not provided'}\n\n${input.message}`,
      heading: input.subject, preheader: `New ${label.toLowerCase()} from ${input.name}`, from: sender, recipients: [recipient], contactEmail: sender, replyTo: [input.email],
    })
  } catch (error) {
    console.error(`Could not email staff about contact request ${id}`, error)
  }
  // Acknowledge only the first request from an address per hour, so the form cannot be used to spam a mailbox.
  const recent = (await queryOne<{ n: number }>(`SELECT count(*)::integer AS n FROM support_contactrequest WHERE upper(email) = upper($1) AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'`, [input.email]))!.n
  if (recent === 1) {
    try {
      await sendBrandedEmail({
        subject: `We received your request: ${input.subject}`,
        textContent: `Hello ${input.name},\n\nMavenHost has received your ${label.toLowerCase()}. Our team will review it and follow up by email.\n\nSubject: ${input.subject}\n\nIf you need to add information, reply to this email.`,
        heading: 'We’ve received your request', preheader: 'Your message is with the right MavenHost team.', from: sender, recipients: [input.email], replyTo: [emailAddress(sender)], contactEmail: sender,
      })
    } catch (error) {
      console.error(`Could not send contact acknowledgement ${id}`, error)
    }
  }
  return { id, message: 'Your request has been received. Our team will follow up by email.' }
}

// --- Tickets ---

type TicketRow = {
  id: string; number: string; customer_id: string; subject: string; description: string; category: string; priority: string; status: string
  assigned_to_id: string | null; resolved_at: Date | null; closed_at: Date | null; created_at: Date; updated_at: Date; customer_email: string; assigned_to_email: string | null
}

const TICKET_SELECT = `SELECT t.*, c.email AS customer_email, a.email AS assigned_to_email FROM support_ticket t JOIN accounts_user c ON c.id = t.customer_id LEFT JOIN accounts_user a ON a.id = t.assigned_to_id`

const summary = (ticket: TicketRow) => ({
  id: ticket.id, number: ticket.number, subject: ticket.subject, category: ticket.category, priority: ticket.priority, status: ticket.status,
  customer_email: ticket.customer_email, assigned_to_email: ticket.assigned_to_email, created_at: ticket.created_at, updated_at: ticket.updated_at,
})

export async function listTickets(customerId: string) {
  return (await query<TicketRow>(`${TICKET_SELECT} WHERE t.customer_id = $1 ORDER BY t.updated_at DESC, t.created_at DESC`, [customerId])).map(summary)
}

/** Staff see internal notes; customers never do. */
export async function ticketDetail(customerId: string, ticketId: string, { includeInternal }: { includeInternal: boolean }) {
  const ticket = await queryOne<TicketRow>(`${TICKET_SELECT} WHERE t.customer_id = $1 AND t.id = $2`, [customerId, ticketId])
  if (!ticket) throw notFound()
  const messages = await query(
    `SELECT m.id, u.email AS author_email, m.body, m.internal_note, m.created_at FROM support_ticketmessage m JOIN accounts_user u ON u.id = m.author_id
      WHERE m.ticket_id = $1 ${includeInternal ? '' : 'AND NOT m.internal_note'} ORDER BY m.created_at`,
    [ticket.id],
  )
  return { ...summary(ticket), description: ticket.description, resolved_at: ticket.resolved_at, closed_at: ticket.closed_at, messages }
}

/** Customer self-service: open a ticket (new in the Next.js platform; v1 only had the public contact form). */
export async function openTicket(customerId: string, input: { subject: string; description: string; category: string; priority: string }) {
  const id = randomUUID()
  const number = `MWH-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
  await database().query(
    `INSERT INTO support_ticket (id, number, subject, description, category, priority, status, resolved_at, closed_at, created_at, updated_at, assigned_to_id, customer_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, $7)`,
    [id, number, input.subject, input.description, input.category, input.priority === 'urgent' ? 'high' : input.priority, customerId],
  )
  const customer = (await queryOne<{ email: string }>('SELECT email FROM accounts_user WHERE id = $1', [customerId]))!
  const { recipient } = contactRouting('support')
  sendBrandedEmail({
    subject: `[Support ticket ${number}] ${input.subject}`, textContent: `Customer: ${customer.email}\nCategory: ${input.category}\nPriority: ${input.priority}\n\n${input.description}`,
    heading: input.subject, from: settings.email.supportFrom, recipients: [recipient], replyTo: [customer.email],
  }).catch((error) => console.error(`Could not notify support about ticket ${number}`, error))
  return ticketDetail(customerId, id, { includeInternal: false })
}

/** Customer reply; a reply to a resolved ticket reopens it, a closed ticket stays closed. */
export async function customerReply(customerId: string, ticketId: string, body: string) {
  await transaction(async (client) => {
    const ticket = await queryOne<TicketRow>('SELECT * FROM support_ticket WHERE id = $1 AND customer_id = $2 FOR UPDATE', [ticketId, customerId], client)
    if (!ticket) throw notFound()
    if (ticket.status === 'closed') throw new DetailError('Closed tickets cannot receive new messages. Open a new ticket instead.', 409)
    await client.query(`INSERT INTO support_ticketmessage (id, body, internal_note, created_at, author_id, ticket_id) VALUES ($1, $2, false, CURRENT_TIMESTAMP, $3, $4)`, [randomUUID(), body.trim(), customerId, ticketId])
    const status = ticket.status === 'resolved' ? 'in_progress' : ticket.status === 'waiting_customer' ? 'in_progress' : ticket.status
    await client.query(`UPDATE support_ticket SET status = $2::text, resolved_at = CASE WHEN $2::text = 'in_progress' AND status = 'resolved' THEN NULL ELSE resolved_at END, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [ticketId, status])
  })
  return ticketDetail(customerId, ticketId, { includeInternal: false })
}

type Action = 'assign' | 'resolve' | 'close' | 'reopen' | 'reply' | 'internal_note'
const AUDIT_EVENTS: Record<Action, [string, string]> = {
  assign: ['ticket_assigned', 'Support ticket assigned.'], resolve: ['ticket_resolved', 'Support ticket resolved.'], close: ['ticket_closed', 'Support ticket closed.'],
  reopen: ['ticket_reopened', 'Support ticket reopened.'], reply: ['ticket_message_added', 'Support reply added.'], internal_note: ['ticket_internal_note_added', 'Internal support note added.'],
}

/** Idempotent staff ticket operations (SupportService); a replayed Idempotency-Key returns without repeating the change. */
export async function staffTicketAction(input: { actorId: string; customerId: string; ticketId: string; action: Action; idempotencyKey: string; ipAddress: string | null; assigneeId?: string; body?: string }) {
  await transaction(async (client) => {
    const ticket = await queryOne<TicketRow & { customer_email: string }>(
      `SELECT t.*, c.email AS customer_email FROM support_ticket t JOIN accounts_user c ON c.id = t.customer_id WHERE t.id = $1 AND t.customer_id = $2 FOR UPDATE OF t`,
      [input.ticketId, input.customerId],
      client,
    )
    if (!ticket) throw notFound()
    if (await queryOne('SELECT 1 FROM support_supportoperation WHERE ticket_id = $1 AND actor_id = $2 AND action = $3 AND idempotency_key = $4', [ticket.id, input.actorId, input.action, input.idempotencyKey], client)) return
    const conflict = (message: string) => new DetailError(message, 409)
    let result: Record<string, unknown> = { ticket_id: ticket.id }
    let metadata: Record<string, unknown> = {}
    if (input.action === 'assign') {
      if (ticket.status === 'resolved' || ticket.status === 'closed') throw conflict('Resolved or closed tickets cannot be assigned.')
      const assignee = await queryOne<{ is_staff: boolean; is_active: boolean }>('SELECT is_staff, is_active FROM accounts_user WHERE id = $1', [input.assigneeId], client)
      if (!assignee) throw notFound()
      if (!assignee.is_staff || !assignee.is_active) throw conflict('Tickets may only be assigned to active staff accounts.')
      const status = ticket.status === 'open' ? 'in_progress' : ticket.status
      await client.query('UPDATE support_ticket SET assigned_to_id = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [ticket.id, input.assigneeId, status])
      result = { ...result, status, assigned_to_id: input.assigneeId }
      metadata = { previous_assignee_id: ticket.assigned_to_id, assignee_id: input.assigneeId }
    } else if (input.action === 'resolve') {
      if (!['open', 'in_progress', 'waiting_customer'].includes(ticket.status)) throw conflict('Only open, in-progress, or waiting-for-customer tickets can be resolved.')
      await client.query(`UPDATE support_ticket SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [ticket.id])
      result = { ...result, status: 'resolved' }
    } else if (input.action === 'close') {
      if (ticket.status !== 'resolved') throw conflict('Only resolved tickets can be closed.')
      await client.query(`UPDATE support_ticket SET status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [ticket.id])
      result = { ...result, status: 'closed' }
    } else if (input.action === 'reopen') {
      if (ticket.status !== 'resolved' && ticket.status !== 'closed') throw conflict('Only resolved or closed tickets can be reopened.')
      await client.query(`UPDATE support_ticket SET status = 'in_progress', resolved_at = NULL, closed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [ticket.id])
      result = { ...result, status: 'in_progress' }
    } else {
      if (ticket.status === 'closed') throw conflict('Closed tickets cannot receive new messages.')
      const body = (input.body ?? '').trim()
      if (!body) throw conflict('Message body cannot be empty.')
      const messageId = randomUUID()
      const internal = input.action === 'internal_note'
      await client.query('INSERT INTO support_ticketmessage (id, body, internal_note, created_at, author_id, ticket_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)', [messageId, body, internal, input.actorId, ticket.id])
      if (!internal) {
        onCommit(client, () =>
          sendBrandedEmail({
            subject: `MavenHost support replied to ${ticket.number}`,
            textContent: `A member of our support team replied to your ticket ${ticket.number}.\n\nTicket: ${ticket.subject}\n\nSupport reply:\n${body}\n\nYou can reply to this email to contact our support team.`,
            heading: 'A reply to your support ticket', preheader: `MavenHost support replied to ticket ${ticket.number}.`, from: settings.email.supportFrom,
            recipients: [ticket.customer_email], replyTo: [settings.email.supportFrom], contactEmail: settings.email.supportFrom,
          }).catch((error) => console.error(`Could not email customer about support ticket ${ticket.number}`, error)),
        )
        // v1 moved waiting tickets back to in progress on a staff reply; a staff reply now waits on the customer.
        if (ticket.status === 'open' || ticket.status === 'in_progress' || ticket.status === 'waiting_customer')
          await client.query(`UPDATE support_ticket SET status = 'waiting_customer', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [ticket.id])
      } else await client.query('UPDATE support_ticket SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [ticket.id])
      result = { message_id: messageId, ticket_id: ticket.id }
      metadata = { message_id: messageId }
    }
    await client.query(
      `INSERT INTO support_supportoperation (id, action, idempotency_key, status, result_payload, completed_at, created_at, updated_at, actor_id, ticket_id)
       VALUES ($1, $2, $3, 'succeeded', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5, $6)`,
      [randomUUID(), input.action, input.idempotencyKey, JSON.stringify(result), input.actorId, ticket.id],
    )
    const [event, message] = AUDIT_EVENTS[input.action]
    await audit({ event, category: 'support', status: 'success', performedBy: input.actorId, target: { appLabel: 'support', model: 'ticket', id: ticket.id }, message, metadata, ipAddress: input.ipAddress }, client)
  })
  return ticketDetail(input.customerId, input.ticketId, { includeInternal: true })
}

export async function supportQueue(db: Queryable = database()) {
  return query(`${TICKET_SELECT} WHERE t.status IN ('open', 'in_progress', 'waiting_customer') ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at`, [], db)
}
