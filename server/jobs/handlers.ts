import 'server-only'
import type { OutboxEvent } from './outbox'
import { executeTrialActivation, executeTrialExpiry } from '../websites/trials'

/**
 * Durable event handlers by event name (apps/core/events registrations). Events without a handler fail and retry with
 * backoff, so work queued before its domain is ported is preserved rather than dropped.
 */
type Payload = Record<string, unknown>
const generation = (payload: Payload) => (payload.deployment_generation === undefined ? undefined : Number(payload.deployment_generation))

export const OUTBOX_HANDLERS = new Map<string, (event: OutboxEvent) => Promise<void>>([
  ['websites.trial.deploy.requested', (event) => executeTrialActivation(String(event.payload.trial_id), generation(event.payload))],
  ['websites.trial.expiry.requested', (event) => executeTrialExpiry(String(event.payload.trial_id), generation(event.payload))],
])
