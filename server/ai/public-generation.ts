import 'server-only'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { settings } from '../config'
import { database, query, queryOne, transaction } from '../db'
import { DetailError } from '../http/errors'
import { BadSignature, dumps, loads } from '../auth/signing'
import { AIProviderError, aiProvider, type AIProvider } from './provider'
import { AIGenerationError, completeAIRequest, createAIRequest, failAIRequest, generateResult, sanitizeBrief, sha256 } from './website-generation'
import { createPage, createWebsite, slugify, websiteData } from '../websites/service'

/** Port of apps/ai/services/public_website.py and api/public.py. */

const TOKEN_SALT = 'maven-host-public-website-generation'
const TOKEN_MAX_AGE_SECONDS = 365 * 24 * 3600
const RESULT_TTL_MS = 48 * 3600_000
const IP_GENERATIONS_PER_DAY = 3

export class PublicGenerationError extends Error {
  constructor(message: string, readonly code = 'generation_error') {
    super(message)
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  rate_limited: 429, timeout: 504, provider_rejected: 502, invalid_response: 502, invalid_structured_output: 502,
  empty_response: 502, refused: 502, auth_failed: 503, quota_exhausted: 503, not_configured: 503, transport_error: 503, provider_unavailable: 503, generation_error: 409, unexpected_error: 503,
}

export const publicErrorStatus = (error: PublicGenerationError) => STATUS_BY_CODE[error.code] ?? 503

export const issueVisitorToken = () => dumps({ visitor_id: randomUUID() }, TOKEN_SALT)

export function validateVisitorToken(token: string) {
  try {
    return loads<{ visitor_id: string }>(token, TOKEN_SALT, TOKEN_MAX_AGE_SECONDS)
  } catch (error) {
    if (error instanceof BadSignature) throw new PublicGenerationError('The anonymous visitor token is invalid or expired.')
    throw error
  }
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** `timezone.localdate()` in Africa/Nairobi. */
const localDate = (now = Date.now()) => new Date(now + 3 * 3600_000).toISOString().slice(0, 10)

const ipDayHash = (ip: string, day: string) => createHmac('sha256', settings.secretKey).update(`${ip}|${day}`).digest('hex')

// v1 used a process-local cache counter in addition to the database count; keep the same atomic reservation.
const ipReservations = new Map<string, number>()
function reserveIpQuota(hash: string) {
  const used = (ipReservations.get(hash) ?? 0) + 1
  ipReservations.set(hash, used)
  if (ipReservations.size > 10_000) ipReservations.clear()
  return used <= IP_GENERATIONS_PER_DAY
}

export async function expireStale() {
  await database().query(`UPDATE ai_publicwebsitegeneration SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'succeeded' AND expires_at <= CURRENT_TIMESTAMP`)
}

type GenerationRow = { id: string; visitor_token_hash: string; status: string; website_spec: { website_name?: string; pages?: unknown[] }; expires_at: Date; created_at: Date }

export function generationData(generation: GenerationRow, visitorToken: string) {
  return {
    id: generation.id,
    status: generation.status,
    visitor_token: visitorToken,
    website_name: generation.website_spec?.website_name ?? '',
    pages: generation.website_spec?.pages ?? [],
    expires_at: generation.expires_at,
    created_at: generation.created_at,
  }
}

export async function generatePublicWebsite(brief: string, visitorToken: string, ip: string, provider: AIProvider = aiProvider()) {
  validateVisitorToken(visitorToken)
  const quotaDay = localDate()
  const visitorHash = tokenHash(visitorToken)
  const networkHash = ipDayHash(ip, quotaDay)
  await expireStale()
  let sanitized: string
  try {
    sanitized = sanitizeBrief(brief)
  } catch (error) {
    if (error instanceof AIGenerationError) throw new PublicGenerationError(error.message)
    throw error
  }
  if (await queryOne('SELECT 1 FROM ai_publicwebsitegeneration WHERE visitor_token_hash = $1 AND quota_day = $2', [visitorHash, quotaDay]))
    throw new PublicGenerationError("You have already used today's free AI website generation.", 'rate_limited')
  const networkCount = (await queryOne<{ n: number }>('SELECT count(*)::integer AS n FROM ai_publicwebsitegeneration WHERE ip_day_hash = $1 AND quota_day = $2', [networkHash, quotaDay]))!.n
  if (networkCount >= IP_GENERATIONS_PER_DAY || !reserveIpQuota(networkHash))
    throw new PublicGenerationError("Today's anonymous AI generation limit has been reached for this network.", 'rate_limited')

  let created: { id: string; requestId: string }
  try {
    created = await transaction(async (client) => {
      if (await queryOne('SELECT 1 FROM ai_publicwebsitegeneration WHERE visitor_token_hash = $1 AND quota_day = $2 FOR UPDATE', [visitorHash, quotaDay], client))
        throw new PublicGenerationError("You have already used today's free AI website generation.")
      const requestId = await createAIRequest(client, { userId: null, provider, inputHash: sha256(sanitized) })
      const id = randomUUID()
      await client.query(
        `INSERT INTO ai_publicwebsitegeneration (id, visitor_token_hash, ip_day_hash, quota_day, status, website_spec, expires_at, claimed_at, created_at, updated_at, ai_request_id, claimed_by_id)
         VALUES ($1, $2, $3, $4, 'running', '{}', $5, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6, NULL)`,
        [id, visitorHash, networkHash, quotaDay, new Date(Date.now() + RESULT_TTL_MS), requestId],
      )
      return { id, requestId }
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new PublicGenerationError("You have already used today's free AI website generation.")
    throw error
  }

  const db = database()
  try {
    const { data, result } = await generateResult(sanitized, provider)
    await completeAIRequest(db, created.requestId, data, result)
    const generation = (await queryOne<GenerationRow>(
      `UPDATE ai_publicwebsitegeneration SET website_spec = $2, status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [created.id, JSON.stringify(data)],
    ))!
    return generation
  } catch (error) {
    const known = error instanceof AIProviderError || error instanceof DetailError || error instanceof PublicGenerationError
    const code = known ? ((error as { code?: string }).code ?? 'generation_error') : 'unexpected_error'
    await failAIRequest(db, created.requestId, code, known ? (error as Error).message : 'Public AI generation failed unexpectedly.')
    await db.query(`UPDATE ai_publicwebsitegeneration SET status = 'failed', expires_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [created.id])
    if (!known) console.error('Public AI generation failed unexpectedly', error)
    throw new PublicGenerationError(known ? (error as Error).message : 'The public AI website generation failed unexpectedly.', code)
  }
}

export async function retrievePublicGeneration(id: string, visitorToken: string) {
  validateVisitorToken(visitorToken)
  const generation = await queryOne<GenerationRow>('SELECT * FROM ai_publicwebsitegeneration WHERE id = $1', [id])
  if (!generation) throw new PublicGenerationError('PublicWebsiteGeneration matching query does not exist.')
  if (generation.visitor_token_hash !== tokenHash(visitorToken)) throw new PublicGenerationError('You do not have access to this generated website.')
  if (generation.status !== 'succeeded') throw new PublicGenerationError('This generated website is no longer available.')
  if (generation.expires_at.getTime() <= Date.now()) {
    await database().query(`UPDATE ai_publicwebsitegeneration SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id])
    throw new PublicGenerationError('This generated website has expired.')
  }
  return generation
}

/** Claims an anonymous draft into a customer website, then clears the retained anonymous copy. */
export async function claimPublicGeneration(id: string, visitorToken: string, userId: string) {
  validateVisitorToken(visitorToken)
  const websiteId = await transaction(async (client) => {
    const generation = await queryOne<GenerationRow>('SELECT * FROM ai_publicwebsitegeneration WHERE id = $1 FOR UPDATE', [id], client)
    if (!generation) throw new PublicGenerationError('PublicWebsiteGeneration matching query does not exist.')
    if (generation.visitor_token_hash !== tokenHash(visitorToken)) throw new PublicGenerationError('You do not have access to this generated website.')
    if (generation.status !== 'succeeded') throw new PublicGenerationError('This generated website is no longer available to claim.')
    if (generation.expires_at.getTime() <= Date.now()) {
      await client.query(`UPDATE ai_publicwebsitegeneration SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id])
      return null
    }
    const data = generation.website_spec as { website_name?: string; pages?: { slug: string; title: string; page_type: string; seo_title: string; seo_description: string; content: Record<string, unknown> }[] }
    const baseSlug = slugify(data.website_name || 'maven-website').slice(0, 120) || 'maven-website'
    const taken = (await query('SELECT 1 FROM websites_website WHERE owner_id = $1 AND slug = $2', [userId, baseSlug], client)).length > 0
    const slug = taken ? `${baseSlug}-${id.slice(0, 8)}`.slice(0, 160) : baseSlug
    const website = await createWebsite(userId, { name: (data.website_name || 'Maven Website').trim().slice(0, 150) || 'Maven Website', slug }, client)
    for (const [index, page] of (data.pages ?? []).entries())
      await createPage(website.id, { slug: page.slug, title: page.title, page_type: page.page_type, seo_title: page.seo_title, seo_description: page.seo_description, sort_order: index, is_published: false, content: page.content }, client)
    await client.query(
      `UPDATE ai_publicwebsitegeneration SET status = 'claimed', claimed_by_id = $2, claimed_at = CURRENT_TIMESTAMP, website_spec = '{}', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, userId],
    )
    return website.id
  })
  if (!websiteId) throw new PublicGenerationError('This generated website has expired. Please generate a new website.')
  return websiteData((await queryOne('SELECT * FROM websites_website WHERE id = $1', [websiteId]))! as never)
}

/** `cleanup_public_generations` management command. */
export async function cleanupPublicGenerations() {
  return (
    await database().query(
      `UPDATE ai_publicwebsitegeneration SET status = 'expired', website_spec = '{}', updated_at = CURRENT_TIMESTAMP
        WHERE status IN ('running', 'succeeded', 'failed') AND expires_at <= CURRENT_TIMESTAMP`,
    )
  ).rowCount
}
