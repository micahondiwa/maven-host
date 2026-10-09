import 'server-only'
import { database, queryOne, type Queryable } from '../db'

/** Port of apps/audit/services/audit.py. `target` names the Django model so content types stay identical. */
export type AuditEntry = {
  event: string
  category: 'hosting' | 'domain' | 'billing' | 'payment' | 'ssl' | 'dns' | 'email' | 'auth' | 'system' | 'support'
  status?: 'success' | 'failed' | 'pending' | string
  performedBy?: string | null
  target?: { appLabel: string; model: string; id: string | number } | null
  targetId?: string
  providerId?: number | null
  serverId?: number | null
  providerReference?: string
  message?: string
  ipAddress?: string | null
  requestPayload?: Record<string, unknown>
  responsePayload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export async function contentTypeId(appLabel: string, model: string, db: Queryable = database()): Promise<number> {
  await db.query('INSERT INTO django_content_type (app_label, model) VALUES ($1, $2) ON CONFLICT (app_label, model) DO NOTHING', [appLabel, model])
  return (await queryOne<{ id: number }>('SELECT id FROM django_content_type WHERE app_label = $1 AND model = $2', [appLabel, model], db))!.id
}

export async function audit(entry: AuditEntry, db: Queryable = database()) {
  const contentType = entry.target ? await contentTypeId(entry.target.appLabel, entry.target.model, db) : null
  const provider = entry.providerId ? (await queryOne<{ id: number }>('SELECT id FROM hosting_hostingprovider WHERE id = $1', [entry.providerId], db))?.id ?? null : null
  const server = entry.serverId ? (await queryOne<{ id: number }>('SELECT id FROM hosting_server WHERE id = $1', [entry.serverId], db))?.id ?? null : null
  await db.query(
    `INSERT INTO audit_auditlog (event, category, status, object_id, provider_reference, message, ip_address, request_payload,
       response_payload, metadata, created_at, content_type_id, performed_by_id, provider_id, server_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, $12, $13, $14)`,
    [
      entry.event,
      entry.category,
      entry.status ?? 'success',
      entry.target ? String(entry.target.id) : entry.targetId ?? '',
      entry.providerReference ?? '',
      entry.message ?? '',
      entry.ipAddress ?? null,
      JSON.stringify(entry.requestPayload ?? {}),
      JSON.stringify(entry.responsePayload ?? {}),
      JSON.stringify(entry.metadata ?? {}),
      contentType,
      entry.performedBy ?? null,
      provider,
      server,
    ],
  )
}
