import 'server-only'
import { randomUUID } from 'node:crypto'
import { queryOne, transaction } from '../db'
import { DetailError } from '../http/errors'
import { enqueueOutbox } from '../jobs/outbox'
import type { WebsiteRow } from './service'

/** `WebsitePublishService.request`: validates ownership and readiness, then queues publication. */
export async function requestPublication(websiteId: string) {
  return transaction(async (client) => {
    const website = (await queryOne<WebsiteRow>('SELECT * FROM websites_website WHERE id = $1 FOR UPDATE', [websiteId], client))!
    const conflict = (message: string) => new DetailError(message, 409)
    if (website.status === 'archived' || website.status === 'suspended') throw conflict('This website cannot be published in its current state.')
    if (!website.domain_id || !website.hosting_account_id) throw conflict('A domain and hosting account are required before publication.')
    const domain = await queryOne<{ owner_id: string; status: string }>('SELECT owner_id, status FROM domains_domain WHERE id = $1', [website.domain_id], client)
    const hosting = await queryOne<{ owner_id: string; domain_id: string | null; status: string; is_suspended: boolean }>(
      'SELECT owner_id, domain_id, status, is_suspended FROM hosting_hostingaccount WHERE id = $1',
      [website.hosting_account_id],
      client,
    )
    if (!domain || !hosting || domain.owner_id !== website.owner_id || hosting.owner_id !== website.owner_id) throw conflict('The website infrastructure is not owned by this customer.')
    if (hosting.domain_id !== website.domain_id) throw conflict('The hosting account must belong to the website domain.')
    if (domain.status !== 'active') throw conflict('The website domain must be active before publication.')
    if (hosting.status !== 'active' || hosting.is_suspended) throw conflict('The website hosting account must be active and unsuspended before publication.')
    if (website.status === 'publishing' || website.publication_status === 'pending' || website.publication_status === 'running') return website
    const updated = (await queryOne<WebsiteRow>(
      `UPDATE websites_website SET status = 'publishing', publication_status = 'pending', publication_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [websiteId],
      client,
    ))!
    await enqueueOutbox(
      client,
      { eventId: randomUUID(), name: 'websites.publish.requested', payload: { website_id: websiteId }, occurredAt: new Date() },
      `website-publish:${websiteId}:${updated.updated_at.toISOString()}`,
    )
    return updated
  })
}
