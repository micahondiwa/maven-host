import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { database, query, queryOne, transaction } from '../db'
import { DetailError, notFound } from '../http/errors'
import { enqueueOutbox } from '../jobs/outbox'
import { renderWebsiteFiles } from '../../src/lib/website-renderer'
import { TrialDeploymentError, trialProvider } from './trial-providers'
import { websitePages } from './service'

/** Port of apps/websites/services/trial.py and api/trials.py. */

const DURATION_MS = 7 * 24 * 3600_000

type TrialRow = {
  id: string; website_id: string; status: string; trial_hostname: string; deployment_id: string; deployment_hash: string
  activated_at: Date; expires_at: Date; expired_at: Date | null; deployment_attempts: number; deployment_generation: number; deployment_error: string
}

const hostname = (trialId: string) => `maven-trial-${trialId.replace(/-/g, '')}.${(process.env.TRIAL_BASE_DOMAIN?.trim() || 'maven-trial.localhost').replace(/^\.+|\.+$/g, '')}`

export function trialData(trial: TrialRow) {
  return {
    id: trial.id,
    status: trial.status,
    trial_hostname: trial.trial_hostname,
    public_url: `${process.env.TRIAL_PUBLIC_SCHEME?.trim() || 'https'}://${trial.trial_hostname}`,
    activated_at: trial.activated_at,
    expires_at: trial.expires_at,
    expired_at: trial.expired_at,
    deployment_id: trial.deployment_id,
  }
}

function enqueueEvent(client: Parameters<typeof enqueueOutbox>[0], name: string, payload: Record<string, unknown>, dedupeKey: string) {
  return enqueueOutbox(client, { eventId: randomUUID(), name, payload, occurredAt: new Date() }, dedupeKey)
}

export async function activateTrial(websiteId: string) {
  return transaction(async (client) => {
    const website = (await queryOne<{ id: string; owner_id: string | null; status: string; generation_status: string }>('SELECT id, owner_id, status, generation_status FROM websites_website WHERE id = $1 FOR UPDATE', [websiteId], client))!
    if (!website.owner_id) throw new DetailError('A trial website must belong to a customer account.', 409)
    if (website.status === 'archived' || website.status === 'suspended') throw new DetailError('This website cannot be placed on a trial.', 409)
    const hasPages = (await query('SELECT 1 FROM websites_websitepage WHERE website_id = $1 LIMIT 1', [websiteId], client)).length > 0
    if (website.generation_status !== 'completed' || !hasPages) throw new DetailError('Generate website content before starting the free trial.', 409)
    const existing = await queryOne<TrialRow>('SELECT * FROM websites_websitetrial WHERE website_id = $1 FOR UPDATE', [websiteId], client)
    let trial: TrialRow
    if (existing) {
      if (existing.status !== 'failed') throw new DetailError('This website already has a MavenHost trial.', 409)
      trial = (await queryOne<TrialRow>(
        `UPDATE websites_websitetrial SET status = 'pending', activated_at = CURRENT_TIMESTAMP, expires_at = $2, expired_at = NULL, deployment_id = '',
           deployment_hash = '', deployment_error = '', deployment_generation = deployment_generation + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [existing.id, new Date(Date.now() + DURATION_MS)],
        client,
      ))!
    } else {
      const id = randomUUID()
      trial = (await queryOne<TrialRow>(
        `INSERT INTO websites_websitetrial (id, status, trial_hostname, deployment_id, deployment_hash, activated_at, expires_at, expired_at,
           deployment_attempts, deployment_generation, deployment_error, created_at, updated_at, website_id)
         VALUES ($1, 'pending', $2, '', '', CURRENT_TIMESTAMP, $3, NULL, 0, 1, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4) RETURNING *`,
        [id, hostname(id), new Date(Date.now() + DURATION_MS), websiteId],
        client,
      ))!
    }
    await enqueueEvent(client, 'websites.trial.deploy.requested', { trial_id: trial.id, deployment_generation: trial.deployment_generation }, `website-trial-deploy:${trial.id}:${trial.deployment_generation}`)
    return trialData(trial)
  })
}

export async function trialForWebsite(websiteId: string) {
  const trial = await queryOne<TrialRow>('SELECT * FROM websites_websitetrial WHERE website_id = $1', [websiteId])
  if (!trial) throw notFound('No WebsiteTrial matches the given query.')
  return trialData(trial)
}

/** Outbox handler for `websites.trial.deploy.requested`. */
export async function executeTrialActivation(trialId: string, deploymentGeneration?: number) {
  const claimed = await transaction(async (client) => {
    const trial = await queryOne<TrialRow>('SELECT * FROM websites_websitetrial WHERE id = $1 FOR UPDATE', [trialId], client)
    if (!trial) throw new Error('WebsiteTrial matching query does not exist.')
    if (deploymentGeneration !== undefined && trial.deployment_generation !== deploymentGeneration) return null
    if (['active', 'expired', 'expiring', 'deploying'].includes(trial.status)) return null
    if (trial.expires_at.getTime() <= Date.now()) {
      await client.query(`UPDATE websites_websitetrial SET status = 'expired', expired_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [trialId])
      return null
    }
    if (!['pending', 'failed'].includes(trial.status)) return null
    await client.query(`UPDATE websites_websitetrial SET status = 'deploying', deployment_attempts = deployment_attempts + 1, deployment_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [trialId])
    return trial
  })
  if (!claimed) return
  const generation = claimed.deployment_generation
  let result: Awaited<ReturnType<ReturnType<typeof trialProvider>['deploy']>>
  let sha: string
  try {
    const website = (await queryOne<{ name: string }>('SELECT name FROM websites_website WHERE id = $1', [claimed.website_id]))!
    const files = renderWebsiteFiles(website, await websitePages(claimed.website_id))
    const digest = createHash('sha256')
    for (const file of files) digest.update(file.name).update(file.content)
    sha = digest.digest('hex')
    result = await trialProvider().deploy({ trialId: claimed.id, hostname: claimed.trial_hostname, files, idempotencyKey: `website-trial:${claimed.id}:${generation}:${sha}` })
  } catch (error) {
    // v1 only reset TrialDeploymentError/ValueError; any other failure left the trial stuck in "deploying".
    await database().query(
      `UPDATE websites_websitetrial SET status = 'failed', deployment_error = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deployment_generation = $2 AND status = 'deploying'`,
      [claimed.id, generation, error instanceof TrialDeploymentError ? error.message : 'The trial website could not be published.'],
    )
    throw error
  }
  await transaction(async (client) => {
    const current = (await queryOne<TrialRow>('SELECT * FROM websites_websitetrial WHERE id = $1 FOR UPDATE', [claimed.id], client))!
    if (current.deployment_generation !== generation || current.status !== 'deploying') return
    if (current.expires_at.getTime() <= Date.now()) {
      await client.query(
        `UPDATE websites_websitetrial SET status = 'expiring', deployment_id = $2, deployment_hash = $3, deployment_error = 'Trial expired before deployment completed.', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [current.id, result.deploymentId, sha],
      )
      await enqueueEvent(client, 'websites.trial.expiry.requested', { trial_id: current.id, deployment_generation: generation }, `website-trial-expiry:${current.id}:${generation}`)
      return
    }
    await client.query(
      `UPDATE websites_websitetrial SET status = 'active', deployment_id = $2, deployment_hash = $3, deployment_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [current.id, result.deploymentId, sha],
    )
  })
}

/** `enqueue_expired_trials` management command. */
export async function enqueueExpiredTrials() {
  return transaction(async (client) => {
    const trials = await query<{ id: string; deployment_generation: number }>(
      `SELECT id, deployment_generation FROM websites_websitetrial WHERE status IN ('pending', 'active', 'failed', 'expiring') AND expires_at <= CURRENT_TIMESTAMP`,
      [],
      client,
    )
    for (const trial of trials)
      await enqueueEvent(client, 'websites.trial.expiry.requested', { trial_id: trial.id, deployment_generation: trial.deployment_generation }, `website-trial-expiry:${trial.id}:${trial.deployment_generation}`)
    return trials.length
  })
}

/** Outbox handler for `websites.trial.expiry.requested`. */
export async function executeTrialExpiry(trialId: string, deploymentGeneration?: number) {
  const trial = await transaction(async (client) => {
    const current = await queryOne<TrialRow>('SELECT * FROM websites_websitetrial WHERE id = $1 FOR UPDATE', [trialId], client)
    if (!current) throw new Error('WebsiteTrial matching query does not exist.')
    if (deploymentGeneration !== undefined && current.deployment_generation !== deploymentGeneration) return null
    if (current.status === 'expired' || current.expires_at.getTime() > Date.now() || current.status === 'deploying') return null
    if (current.status !== 'expiring') await client.query(`UPDATE websites_websitetrial SET status = 'expiring', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [trialId])
    return current
  })
  if (!trial) return
  await trialProvider().delete(trial.id)
  await database().query(
    `UPDATE websites_websitetrial SET status = 'expired', expired_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deployment_generation = $2 AND status = 'expiring'`,
    [trial.id, trial.deployment_generation],
  )
}
