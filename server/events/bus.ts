import 'server-only'
import { randomUUID } from 'node:crypto'
import { onCommit, type Queryable } from '../db'

/**
 * Synchronous platform events (apps/core/events/dispatcher.py). v1 dispatched these after commit and logged
 * listener failures without affecting the business transaction; durable work goes through the outbox instead.
 */
export type PlatformEvent = { eventId: string; name: string; payload: Record<string, unknown>; occurredAt: Date }
type Listener = (event: PlatformEvent) => Promise<void> | void

const listeners = new Map<string, Listener[]>()

export function listen(name: string, listener: Listener) {
  const current = listeners.get(name) ?? []
  if (!current.includes(listener)) listeners.set(name, [...current, listener])
}

export async function dispatch(name: string, payload: Record<string, unknown>) {
  const event = { eventId: randomUUID(), name, payload, occurredAt: new Date() }
  for (const listener of listeners.get(name) ?? []) {
    try {
      await listener(event)
    } catch (error) {
      console.error(`Event listener failed processing '${name}'`, error)
    }
  }
  return event
}

/** `transaction.on_commit(lambda: EventDispatcher().dispatch(...))` */
export function dispatchOnCommit(db: Queryable, name: string, payload: Record<string, unknown>) {
  onCommit(db, () => dispatch(name, payload))
}
