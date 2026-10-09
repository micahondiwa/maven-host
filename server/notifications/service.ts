import 'server-only'
import { randomUUID } from 'node:crypto'
import { settings } from '../config'
import { database, query, queryOne } from '../db'
import { notFound } from '../http/errors'
import { escapeHtml, sendBrandedEmail } from '../communications/email'
import { listen, type PlatformEvent } from '../events/bus'

/** Port of apps/notifications (templates, preferences, in-app and email delivery, event listeners). */

export const NOTIFICATION_TYPES = ['order_paid', 'payment_completed', 'invoice_paid', 'domain_registered', 'hosting_provisioned', 'hosting_suspended', 'hosting_unsuspended', 'hosting_terminated', 'hosting_password_changed', 'hosting_package_changed'] as const
export const CHANNELS = ['email', 'in_app'] as const
type Channel = (typeof CHANNELS)[number]
type Template = { subject: string; title: string; body: string; html: string }

const TEMPLATES: Record<string, Template> = {
  'order_paid.email': {
    subject: 'Order {{ order_number }} paid', title: 'Order paid',
    body: 'We’ve received payment for order {{ order_number }}. The total paid was {{ amount }} {{ currency }}. Keep this email as your payment confirmation.',
    html: '<p>We’ve received payment for order <strong>{{ order_number }}</strong>.</p><p>The total paid was <strong>{{ amount }} {{ currency }}</strong>. Keep this email as your payment confirmation.</p>',
  },
  'order_paid.in_app': { subject: '', title: 'Order {{ order_number }} paid', body: 'Your order {{ order_number }} has been paid successfully. Total: {{ amount }} {{ currency }}.', html: '' },
  'payment_completed.email': {
    subject: 'Payment received', title: 'Payment received',
    body: 'Your payment of {{ amount }} {{ currency }} for invoice {{ invoice_id }} has been received. Thank you for choosing MavenHost.',
    html: '<p>Your payment for invoice <strong>{{ invoice_id }}</strong> has been received.</p><p>Amount paid: <strong>{{ amount }} {{ currency }}</strong>.</p><p>Thank you for choosing MavenHost.</p>',
  },
  'payment_completed.in_app': { subject: '', title: 'Payment received', body: 'Payment for invoice {{ invoice_id }} was received: {{ amount }} {{ currency }}.', html: '' },
  'invoice_paid.email': {
    subject: 'Invoice {{ invoice_id }} paid', title: 'Invoice paid',
    body: 'Invoice {{ invoice_id }} has been paid in full. This email confirms that no balance remains on this invoice.',
    html: '<p>Invoice <strong>{{ invoice_id }}</strong> has been paid in full.</p><p>This email confirms that no balance remains on this invoice.</p>',
  },
  'invoice_paid.in_app': { subject: '', title: 'Invoice paid', body: 'Invoice {{ invoice_id }} has been paid in full.', html: '' },
  'domain_registered.email': {
    subject: 'Domain {{ domain_name }} registered', title: 'Domain registered',
    body: 'Your domain {{ domain_name }} has been registered successfully. The current expiry date is {{ expires_at }}. Review its renewal and contact details in your MavenHost account.',
    html: '<p>Your domain <strong>{{ domain_name }}</strong> has been registered successfully.</p><p>Current expiry date: <strong>{{ expires_at }}</strong>.</p><p>Review its renewal and contact details in your MavenHost account.</p>',
  },
  'domain_registered.in_app': { subject: '', title: 'Domain {{ domain_name }} registered', body: 'Your domain {{ domain_name }} has been registered successfully.', html: '' },
  'hosting_provisioned.email': {
    subject: 'Hosting is ready for {{ domain_name }}', title: 'Hosting account ready',
    body: 'Hosting for {{ domain_name }} is ready. Sign in to your MavenHost account to review the service and its setup details.',
    html: '<p>Hosting for <strong>{{ domain_name }}</strong> is ready.</p><p>Sign in to your MavenHost account to review the service and its setup details.</p>',
  },
  'hosting_provisioned.in_app': { subject: '', title: 'Hosting account ready', body: 'Hosting for {{ domain_name }} has been provisioned successfully.', html: '' },
}

for (const [type, title, body] of [
  ['hosting_suspended', 'Hosting suspended', 'Hosting for {{ domain_name }} is currently suspended. Sign in to review the service status or contact MavenHost Support if you need help.'],
  ['hosting_unsuspended', 'Hosting restored', 'Hosting for {{ domain_name }} has been restored. Sign in to your MavenHost account to review its current status.'],
  ['hosting_terminated', 'Hosting terminated', 'The hosting service for {{ domain_name }} has been terminated. Contact MavenHost Support if you believe this change was unexpected.'],
  ['hosting_password_changed', 'Hosting password changed', 'The hosting account password for {{ domain_name }} was changed. If you did not make this change, contact MavenHost Support immediately.'],
  ['hosting_package_changed', 'Hosting package changed', 'The hosting package for {{ domain_name }} has been changed. Sign in to review the updated service details.'],
])
  for (const channel of CHANNELS) TEMPLATES[`${type}.${channel}`] = { subject: channel === 'email' ? title : '', title, body, html: channel === 'email' ? `<p>${body}</p>` : '' }

export const DEFAULT_TEMPLATES = TEMPLATES

/** Django template variable substitution with auto-escaping (`{{ name }}`, unknown names render empty). */
export function renderTemplate(source: string, context: Record<string, unknown>) {
  return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), context)
    return value === undefined || value === null ? '' : escapeHtml(value)
  })
}

async function render(key: string, context: Record<string, unknown>) {
  let definition = TEMPLATES[key]
  const stored = await queryOne<{ subject_template: string; title_template: string; body_template: string; html_template: string }>(
    'SELECT subject_template, title_template, body_template, html_template FROM notifications_notificationtemplate WHERE key = $1 AND is_active',
    [key],
  )
  if (stored) definition = { subject: stored.subject_template, title: stored.title_template, body: stored.body_template, html: stored.html_template }
  return {
    subject: renderTemplate(definition.subject, context).trim(),
    title: renderTemplate(definition.title, context).trim(),
    body: renderTemplate(definition.body, context).trim(),
    html: renderTemplate(definition.html, context).trim(),
  }
}

async function preferenceEnabled(userId: string, type: string, channel: Channel) {
  const preference = await queryOne<{ enabled: boolean }>('SELECT enabled FROM notifications_notificationpreference WHERE user_id = $1 AND notification_type = $2 AND channel = $3', [userId, type, channel])
  return preference ? preference.enabled : true
}

type NotificationRow = { id: string; user_id: string; notification_type: string; channel: string; status: string; subject: string; title: string; body: string; html_body: string; attempt_count: number }

const BILLING_TYPES = new Set(['order_paid', 'payment_completed', 'invoice_paid'])

async function deliver(notification: NotificationRow) {
  if (notification.channel !== 'email' || notification.status === 'sent') return
  const db = database()
  const attemptNumber = notification.attempt_count + 1
  const attempt = (await queryOne<{ id: number }>(
    `INSERT INTO notifications_notificationdeliveryattempt (attempt_number, status, error_message, provider_message_id, attempted_at, completed_at, notification_id)
     VALUES ($1, 'pending', '', '', CURRENT_TIMESTAMP, NULL, $2) RETURNING id`,
    [attemptNumber, notification.id],
  ))!
  await db.query('UPDATE notifications_notification SET attempt_count = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [notification.id, attemptNumber])
  const recipient = (await queryOne<{ email: string }>('SELECT email FROM accounts_user WHERE id = $1', [notification.user_id]))?.email
  let error = ''
  if (!recipient) error = 'User has no email address.'
  else {
    const billing = BILLING_TYPES.has(notification.notification_type)
    const sender = billing ? settings.email.billingFrom : settings.email.notificationsFrom
    try {
      await sendBrandedEmail({
        subject: notification.subject || notification.title, textContent: notification.body, htmlContent: notification.html_body, heading: notification.title,
        contactEmail: sender, from: sender, recipients: [recipient], replyTo: [billing ? sender : settings.email.supportFrom],
      })
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
  }
  if (!error) {
    await db.query(`UPDATE notifications_notificationdeliveryattempt SET status = 'sent', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [attempt.id])
    await db.query(`UPDATE notifications_notification SET status = 'sent', provider_message_id = '', sent_at = CURRENT_TIMESTAMP, failure_reason = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [notification.id])
  } else {
    await db.query(`UPDATE notifications_notificationdeliveryattempt SET status = 'failed', error_message = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [attempt.id, error])
    await db.query(`UPDATE notifications_notification SET status = 'failed', failure_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [notification.id, error])
  }
}

/** NotificationService.notify */
export async function notify(userId: string, type: string, event: PlatformEvent, channels: readonly Channel[] = ['in_app', 'email']) {
  const user = await queryOne('SELECT 1 FROM accounts_user WHERE id = $1', [userId])
  if (!user) throw new Error('User matching query does not exist.')
  const context = { ...event.payload, user_id: userId }
  for (const channel of channels) {
    if (!(await preferenceEnabled(userId, type, channel))) continue
    const rendered = await render(`${type}.${channel}`, context)
    await database().query(
      `INSERT INTO notifications_notification (id, notification_type, channel, status, event_id, event_name, subject, title, body, html_body, metadata, failure_reason,
         provider_message_id, attempt_count, sent_at, read_at, created_at, updated_at, user_id)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, '', '', 0, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $11)
       ON CONFLICT (event_id, notification_type, channel) DO NOTHING`,
      [randomUUID(), type, channel, event.eventId, event.name, rendered.subject.slice(0, 255), rendered.title.slice(0, 255), rendered.body, rendered.html, JSON.stringify({ event_payload: event.payload }), userId],
    )
    const notification = (await queryOne<NotificationRow>('SELECT * FROM notifications_notification WHERE event_id = $1 AND notification_type = $2 AND channel = $3', [event.eventId, type, channel]))!
    if (channel === 'in_app' && notification.status === 'pending')
      await database().query(`UPDATE notifications_notification SET status = 'sent', sent_at = created_at, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [notification.id])
    else if (channel === 'email') await deliver(notification)
  }
}

const customerOf = (event: PlatformEvent) => (event.payload.customer_id as string | undefined) || null

async function hostingOwner(event: PlatformEvent) {
  const accountId = event.payload.account_id
  if (!accountId) return null
  return (await queryOne<{ owner_id: string }>('SELECT owner_id FROM hosting_hostingaccount WHERE id = $1', [accountId]))?.owner_id ?? null
}

/** notifications/listeners/registry.py */
export function registerNotificationListeners() {
  const route = (eventName: string, type: string, resolveUser: (event: PlatformEvent) => Promise<string | null> | string | null) =>
    listen(eventName, async (event) => {
      const userId = await resolveUser(event)
      if (userId) await notify(userId, type, event)
    })
  route('orders.order.paid', 'order_paid', customerOf)
  route('billing.payment.completed', 'payment_completed', customerOf)
  route('billing.invoice.paid', 'invoice_paid', customerOf)
  route('domains.domain.registered', 'domain_registered', customerOf)
  route('hosting.account.provisioned', 'hosting_provisioned', hostingOwner)
  route('hosting.account.suspended', 'hosting_suspended', hostingOwner)
  route('hosting.account.unsuspended', 'hosting_unsuspended', hostingOwner)
  route('hosting.account.terminated', 'hosting_terminated', hostingOwner)
  route('hosting.account.password_changed', 'hosting_password_changed', hostingOwner)
  route('hosting.package.changed', 'hosting_package_changed', hostingOwner)
}

// --- API (apps/notifications/api) ---

const NOTIFICATION_FIELDS = 'id, notification_type, channel, status, event_name, subject, title, body, metadata, sent_at, read_at, created_at'

export const notificationsApi = {
  list: (userId: string) => query(`SELECT ${NOTIFICATION_FIELDS} FROM notifications_notification WHERE user_id = $1 AND channel = 'in_app' ORDER BY created_at DESC LIMIT 100`, [userId]),
  unreadCount: async (userId: string) => ({
    count: (await queryOne<{ n: number }>(`SELECT count(*)::integer AS n FROM notifications_notification WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL AND status IN ('sent', 'read')`, [userId]))!.n,
  }),
  markRead: async (userId: string, id: string) => {
    const row = await queryOne(
      `UPDATE notifications_notification SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2 RETURNING ${NOTIFICATION_FIELDS}`,
      [id, userId],
    )
    if (!row) throw notFound()
    return row
  },
  markAllRead: async (userId: string) => ({
    updated: (await database().query(
      `UPDATE notifications_notification SET status = 'read', read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND read_at IS NULL AND channel = 'in_app' AND status <> 'failed'`,
      [userId],
    )).rowCount,
  }),
  preferences: (userId: string) => query('SELECT id, notification_type, channel, enabled, updated_at FROM notifications_notificationpreference WHERE user_id = $1 ORDER BY notification_type, channel', [userId]),
  setPreference: async (userId: string, type: string, channel: string, enabled: boolean) => {
    await database().query(
      `INSERT INTO notifications_notificationpreference (notification_type, channel, enabled, updated_at, user_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
       ON CONFLICT (user_id, notification_type, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
      [type, channel, enabled, userId],
    )
    return (await queryOne('SELECT id, notification_type, channel, enabled, updated_at FROM notifications_notificationpreference WHERE user_id = $1 AND notification_type = $2 AND channel = $3', [userId, type, channel]))!
  },
}
