import 'server-only'
import { dispatch, listen, type PlatformEvent } from '../events/bus'
import { audit } from '../audit/audit'

/** Hosting outbox events are delivered to in-process listeners (v1 core/events registry + audit/listeners/hosting.py). */

export const HOSTING_EVENTS: Record<string, [string, string]> = {
  'hosting.account.provisioned': ['hosting_provisioned', 'Hosting account provisioned.'],
  'hosting.account.suspended': ['hosting_suspended', 'Hosting account suspended.'],
  'hosting.account.unsuspended': ['hosting_unsuspended', 'Hosting account unsuspended.'],
  'hosting.account.terminated': ['hosting_terminated', 'Hosting account terminated.'],
  'hosting.account.password_changed': ['hosting_password_changed', 'Hosting password changed.'],
  'hosting.package.changed': ['hosting_package_changed', 'Hosting package changed.'],
}

/** Outbox handler: hand the durable event to the platform listeners. */
export const deliverHostingEvent = (event: { event_name: string; event_id: string; payload: Record<string, unknown> }) =>
  dispatch(event.event_name, { ...event.payload, event_id: event.event_id }).then(() => undefined)

export function registerHostingAuditListeners() {
  for (const [name, [auditEvent, message]] of Object.entries(HOSTING_EVENTS))
    listen(name, async (event: PlatformEvent) => {
      const accountId = String(event.payload.account_id ?? '')
      await audit({
        event: auditEvent, category: 'hosting', status: 'success', target: accountId ? { appLabel: 'hosting', model: 'hostingaccount', id: accountId } : null, targetId: accountId, message,
        metadata: { event_id: event.payload.event_id ?? event.eventId, event_name: name, occurred_at: event.occurredAt.toISOString(), ...(event.payload.recovered ? { recovered: true } : {}) },
      })
    })
}
