import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { database, queryOne, transaction, type Queryable } from '../db'
import { DetailError } from '../http/errors'
import { pythonDumps } from '../lib/python-json'
import { aiProvider, AIProviderError, estimateCost, type AIProvider, type AIResult } from './provider'
import { createPage, ownedWebsite, validateContent, websiteData, type WebsiteRow } from '../websites/service'

/** Port of apps/ai/services/website.py. */

export class AIGenerationError extends DetailError {
  constructor(message: string, readonly code = 'generation_error') {
    super(message, 409)
  }
}

const SECRET_PATTERN = /(password|passwd|api[_ -]?key|access[_ -]?token|secret|private[_ -]?key)\s*[:=]\s*\S+/gi

const ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(['title', 'description', 'question', 'answer', 'image_url', 'alt'].map((key) => [key, { type: 'string' }])),
  required: ['title', 'description', 'question', 'answer', 'image_url', 'alt'],
}

export const WEBSITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    website_name: { type: 'string' },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          page_type: { type: 'string' },
          seo_title: { type: 'string' },
          seo_description: { type: 'string' },
          content: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { type: 'string', enum: ['hero', 'about', 'services', 'testimonials', 'contact', 'faq', 'gallery', 'cta', 'footer'] },
                    heading: { type: 'string' },
                    subheading: { type: 'string' },
                    body: { type: 'string' },
                    cta: { type: 'string' },
                    cta_url: { type: 'string' },
                    items: { type: 'array', items: ITEM },
                  },
                  required: ['type', 'heading', 'subheading', 'body', 'cta', 'cta_url', 'items'],
                },
              },
            },
            required: ['sections'],
          },
        },
        required: ['slug', 'title', 'page_type', 'seo_title', 'seo_description', 'content'],
      },
    },
  },
  required: ['website_name', 'pages'],
}

export type GeneratedPage = { slug: string; title: string; page_type: string; seo_title: string; seo_description: string; content: Record<string, unknown> }
export type GeneratedWebsite = { website_name: string; pages: GeneratedPage[] }

export function sanitizeBrief(brief: string) {
  const trimmed = brief.trim()
  if (!trimmed) throw new AIGenerationError('A website brief is required.')
  if (trimmed.length > 4000) throw new AIGenerationError('The website brief is too long.')
  return trimmed.replace(SECRET_PATTERN, (_match, label: string) => `${label}: [REDACTED]`)
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Python `json.dumps(data, sort_keys=True, separators=(",", ":"))` for output hashing. */
export const canonicalJson = (value: unknown) => pythonDumps(value, { sortKeys: true, compact: true })

function validateResult(data: Record<string, unknown>): GeneratedWebsite {
  const pages = data.pages
  if (!Array.isArray(pages) || !pages.length) throw new AIGenerationError('The AI returned an incomplete website specification.')
  if (pages.length > 12) throw new AIGenerationError('The AI returned too many pages.')
  for (const page of pages) validateContent((page as GeneratedPage).content)
  return data as GeneratedWebsite
}

export async function generateResult(sanitized: string, provider: AIProvider = aiProvider()): Promise<{ data: GeneratedWebsite; result: AIResult }> {
  const result = await provider.generateStructured({
    systemPrompt:
      'You generate a structured website specification for MavenHost. ' +
      'Return only the requested schema. Do not generate HTML, JavaScript, CSS, ' +
      'scripts, executable URLs, secrets, credentials, or unsupported section types. ' +
      'Use concise customer-facing copy.',
    userPrompt:
      `Create a complete small-business website specification from this customer brief:\n\n${sanitized}\n\n` +
      'Generate a practical homepage and the most useful supporting pages. Do not invent sensitive personal data.',
    schemaName: 'maven_website',
    schema: WEBSITE_SCHEMA,
  })
  return { data: validateResult(result.data), result }
}

export async function createAIRequest(db: Queryable, input: { userId: string | null; provider: AIProvider; inputHash: string }) {
  const id = randomUUID()
  await db.query(
    `INSERT INTO ai_airequest (id, request_id, capability, provider, model, status, input_hash, output_hash, input_tokens, output_tokens,
       estimated_cost, error_code, error_message, created_at, completed_at, user_id)
     VALUES ($1, $2, 'generate_website', $3, $4, 'running', $5, '', 0, 0, NULL, '', '', CURRENT_TIMESTAMP, NULL, $6)`,
    [id, randomUUID(), input.provider.providerName, input.provider.model || 'unknown', input.inputHash, input.userId],
  )
  return id
}

export async function completeAIRequest(db: Queryable, id: string, data: GeneratedWebsite, result: AIResult, model?: string) {
  await db.query(
    `UPDATE ai_airequest SET status = 'succeeded', model = $2, output_hash = $3, input_tokens = $4, output_tokens = $5, estimated_cost = $6, completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, model ?? result.model, sha256(canonicalJson(data)), result.inputTokens, result.outputTokens, estimateCost(result.inputTokens, result.outputTokens)],
  )
}

export async function failAIRequest(db: Queryable, id: string, code: string, message: string) {
  await db.query(
    `UPDATE ai_airequest SET status = 'failed', error_code = $2, error_message = $3, completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, code, message.slice(0, 500)],
  )
}

/** `WebsiteGenerationService.generate`: regenerate a customer's website pages from a brief. */
export async function generateWebsite(websiteId: string, userId: string, brief: string, provider: AIProvider = aiProvider()) {
  const sanitized = sanitizeBrief(brief)
  const requestId = await transaction(async (client) => {
    const locked = await ownedWebsite(websiteId, userId, client, true)
    if (locked.owner_id !== userId) throw new AIGenerationError('You do not have access to this website.')
    if (locked.status === 'archived' || locked.status === 'suspended') throw new AIGenerationError('This website cannot be generated in its current state.')
    if (locked.generation_status === 'running') throw new AIGenerationError('Website generation is already in progress.')
    await client.query(
      `UPDATE websites_website SET generation_status = 'running', status = 'generating', generation_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [websiteId],
    )
    return createAIRequest(client, { userId, provider, inputHash: sha256(sanitized) })
  })
  const db = database()
  try {
    const { data, result } = await generateResult(sanitized, provider)
    await transaction(async (client) => {
      await queryOne('SELECT id FROM websites_website WHERE id = $1 FOR UPDATE', [websiteId], client)
      await client.query('DELETE FROM websites_websitepage WHERE website_id = $1', [websiteId])
      for (const [index, page] of data.pages.entries())
        await createPage(websiteId, { slug: page.slug, title: page.title, page_type: page.page_type, seo_title: page.seo_title, seo_description: page.seo_description, sort_order: index, is_published: false, content: page.content }, client)
      await client.query(
        `UPDATE websites_website SET name = COALESCE(NULLIF(btrim($2), ''), name), status = 'ready', generation_status = 'completed', generation_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [websiteId, data.website_name],
      )
      await completeAIRequest(client, requestId, data, result, provider.model)
    })
    return websiteData((await queryOne<WebsiteRow>('SELECT * FROM websites_website WHERE id = $1', [websiteId]))!)
  } catch (error) {
    const known = error instanceof AIProviderError || error instanceof DetailError
    const message = known ? (error as Error).message : 'AI generation failed unexpectedly.'
    await failAIRequest(db, requestId, known ? ((error as { code?: string }).code ?? 'generation_error') : 'unexpected_error', message)
    await db.query(
      `UPDATE websites_website SET status = 'draft', generation_status = 'failed', generation_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [websiteId, message.slice(0, 500)],
    )
    if (known) throw error
    console.error('AI generation failed unexpectedly', error)
    throw new AIGenerationError('AI generation failed unexpectedly.')
  }
}
