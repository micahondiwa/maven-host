import 'server-only'
import { randomUUID } from 'node:crypto'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { DetailError, notFound } from '../http/errors'
import { SECTION_TYPES } from '../../src/lib/website-renderer'

/** Port of apps/websites/services/website.py and api/serializers/websites.py. */

export class WebsiteValidationError extends DetailError {
  constructor(message: string) {
    super(message, 400)
  }
}

/** django.utils.text.slugify */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[-\s]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

export type WebsiteRow = {
  id: string; owner_id: string; domain_id: string | null; hosting_account_id: number | null; template_id: number | null
  name: string; slug: string; status: string; generation_status: string; generation_error: string
  publication_status: string; publication_error: string; publication_hash: string; publication_attempts: number
  publication_started_at: Date | null; published_at: Date | null; created_at: Date; updated_at: Date
}

export type PageRow = {
  id: string; website_id: string; slug: string; title: string; page_type: string; content: Record<string, unknown>
  seo_title: string; seo_description: string; sort_order: number; is_published: boolean; created_at: Date; updated_at: Date
}

const UNSAFE_CONTENT = /javascript\s*:/i

/** `WebsitePageService.validate_content` */
export function validateContent(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new WebsiteValidationError('Page content must be an object.')
  const record = content as Record<string, unknown>
  const sections = record.sections ?? []
  if (!Array.isArray(sections)) throw new WebsiteValidationError('Page sections must be a list.')
  for (const section of sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) throw new WebsiteValidationError('Each section must be an object.')
    const type = (section as Record<string, unknown>).type
    if (!(SECTION_TYPES as readonly unknown[]).includes(type)) throw new WebsiteValidationError(`Unsupported website section type: ${pythonRepr(type)}.`)
    for (const [key, value] of Object.entries(section)) {
      if (key.toLowerCase().startsWith('on')) throw new WebsiteValidationError('Executable event-handler fields are not allowed.')
      if (typeof value === 'string' && UNSAFE_CONTENT.test(value)) throw new WebsiteValidationError('HTML and executable URL content are not allowed in website sections.')
      if (Array.isArray(value))
        for (const item of value)
          if (item && typeof item === 'object')
            for (const nested of Object.values(item)) if (typeof nested === 'string' && UNSAFE_CONTENT.test(nested)) throw new WebsiteValidationError('HTML and executable URL content are not allowed in website sections.')
    }
  }
  return record
}

function pythonRepr(value: unknown) {
  if (value === undefined || value === null) return 'None'
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value)
}

const TEMPLATE_FIELDS = 'id, name, slug, category, version, configuration, preview_asset'

export function pageData(page: PageRow) {
  return {
    id: page.id, slug: page.slug, title: page.title, page_type: page.page_type, content: page.content,
    seo_title: page.seo_title, seo_description: page.seo_description, sort_order: page.sort_order,
    is_published: page.is_published, created_at: page.created_at, updated_at: page.updated_at,
  }
}

export async function websitePages(websiteId: string, db: Queryable = database()) {
  return query<PageRow>('SELECT * FROM websites_websitepage WHERE website_id = $1 ORDER BY sort_order, slug', [websiteId], db)
}

/** WebsiteSerializer */
export async function websiteData(website: WebsiteRow, db: Queryable = database()) {
  const [pages, assets, template, domain] = await Promise.all([
    websitePages(website.id, db),
    query(
      `SELECT id, asset_type, storage_key, url, mime_type, size, width, height, alt_text, metadata, created_at, updated_at
         FROM websites_websiteasset WHERE website_id = $1 ORDER BY asset_type, created_at`,
      [website.id],
      db,
    ),
    website.template_id ? queryOne(`SELECT ${TEMPLATE_FIELDS} FROM websites_websitetemplate WHERE id = $1`, [website.template_id], db) : undefined,
    website.domain_id ? queryOne<{ domain_name: string }>('SELECT domain_name FROM domains_domain WHERE id = $1', [website.domain_id], db) : undefined,
  ])
  return {
    id: website.id,
    name: website.name,
    slug: website.slug,
    status: website.status,
    generation_status: website.generation_status,
    generation_error: website.generation_error && website.generation_status === 'failed' ? 'Website generation could not be completed. Please try again.' : '',
    publication_status: website.publication_status,
    publication_error: !website.publication_error
      ? ''
      : website.publication_status === 'ambiguous'
        ? 'Publication status could not be confirmed. Please retry or contact support.'
        : website.publication_status === 'failed'
          ? 'Website publication could not be completed. Please try again.'
          : '',
    publication_hash: website.publication_hash,
    publication_attempts: website.publication_attempts,
    publication_started_at: website.publication_started_at,
    domain_name: domain?.domain_name ?? null,
    hosting_account_id: website.hosting_account_id,
    template: template ?? null,
    pages: pages.map(pageData),
    assets,
    published_at: website.published_at,
    created_at: website.created_at,
    updated_at: website.updated_at,
  }
}

export async function listTemplates() {
  return query(`SELECT ${TEMPLATE_FIELDS} FROM websites_websitetemplate WHERE is_active ORDER BY category, name, version DESC`)
}

export async function ownedWebsite(websiteId: string, ownerId: string, db: Queryable = database(), lock = false) {
  const website = await queryOne<WebsiteRow>(`SELECT * FROM websites_website WHERE id = $1 AND owner_id = $2${lock ? ' FOR UPDATE' : ''}`, [websiteId, ownerId], db)
  if (!website) throw notFound('No Website matches the given query.')
  return website
}

export async function listWebsites(ownerId: string) {
  const websites = await query<WebsiteRow>('SELECT * FROM websites_website WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId])
  return Promise.all(websites.map((website) => websiteData(website)))
}

async function ownedInfrastructure(db: Queryable, ownerId: string, domainId: string | null | undefined, hostingAccountId: number | null | undefined) {
  const domain = domainId ? await queryOne<{ id: string }>('SELECT id FROM domains_domain WHERE id = $1 AND owner_id = $2', [domainId, ownerId], db) : null
  const hosting = hostingAccountId ? await queryOne<{ id: number; domain_id: string | null }>('SELECT id, domain_id FROM hosting_hostingaccount WHERE id = $1 AND owner_id = $2', [hostingAccountId, ownerId], db) : null
  if ((domainId && !domain) || (hostingAccountId && !hosting)) throw new WebsiteValidationError('The selected domain or hosting account was not found for this customer.')
  if (domain && hosting && hosting.domain_id !== domain.id) throw new WebsiteValidationError('The selected hosting account does not belong to the selected domain.')
  return { domainId: domain?.id ?? null, hostingAccountId: hosting?.id ?? null }
}

async function uniqueViolation<T>(run: () => Promise<T>, message: string): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new WebsiteValidationError(message)
    throw error
  }
}

export async function createWebsite(ownerId: string, input: { name: string; slug?: string; domain_id?: string | null; hosting_account_id?: number | null }, db?: Queryable) {
  return transaction(async (client) => {
    const name = input.name.trim()
    if (!name) throw new WebsiteValidationError('Website name is required.')
    const infrastructure = await ownedInfrastructure(client, ownerId, input.domain_id, input.hosting_account_id)
    const slug = slugify(input.slug || name)
    if (!slug) throw new WebsiteValidationError('A valid website slug could not be generated.')
    return uniqueViolation(
      async () =>
        (await queryOne<WebsiteRow>(
          `INSERT INTO websites_website (id, name, slug, status, generation_status, generation_error, publication_status, publication_error,
             publication_hash, publication_attempts, publication_started_at, published_at, created_at, updated_at, domain_id, hosting_account_id, owner_id, template_id)
           VALUES ($1, $2, $3, 'draft', 'not_started', '', 'not_started', '', '', 0, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5, $6, NULL)
           RETURNING *`,
          [randomUUID(), name, slug, infrastructure.domainId, infrastructure.hostingAccountId, ownerId],
          client,
        ))!,
      'A website with this slug or domain already exists.',
    )
  }, db)
}

export async function updateWebsite(website: WebsiteRow, data: { name?: string; slug?: string; domain_id?: string | null; hosting_account_id?: number | null }) {
  return transaction(async (client) => {
    if (website.status === 'archived' || website.status === 'suspended') throw new WebsiteValidationError(`A ${website.status} website cannot be edited.`)
    const changes: Record<string, unknown> = {}
    if (data.name !== undefined) {
      const name = data.name.trim()
      if (!name) throw new WebsiteValidationError('Website name is required.')
      changes.name = name
    }
    if (data.slug !== undefined) {
      changes.slug = slugify(data.slug)
      if (!changes.slug) throw new WebsiteValidationError('A valid website slug is required.')
    }
    const infrastructure = await ownedInfrastructure(
      client,
      website.owner_id,
      'domain_id' in data ? data.domain_id : website.domain_id,
      'hosting_account_id' in data ? data.hosting_account_id : website.hosting_account_id,
    )
    changes.domain_id = infrastructure.domainId
    changes.hosting_account_id = infrastructure.hostingAccountId
    const entries = Object.entries(changes)
    return uniqueViolation(
      async () =>
        (await queryOne<WebsiteRow>(
          `UPDATE websites_website SET ${entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
          [website.id, ...entries.map(([, value]) => value)],
          client,
        ))!,
      'A website with this slug or domain already exists.',
    )
  })
}

export async function archiveWebsite(website: WebsiteRow) {
  if (website.status === 'published') throw new DetailError('A published website must be unpublished before archiving.', 409)
  await database().query(`UPDATE websites_website SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [website.id])
}

export type PageInput = { slug: string; title: string; page_type?: string; content?: unknown; seo_title?: string; seo_description?: string; sort_order?: number; is_published?: boolean }

async function unpublishOnEdit(db: Queryable, websiteId: string) {
  await db.query(
    `UPDATE websites_website SET status = 'ready', published_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'published'`,
    [websiteId],
  )
}

export async function createPage(websiteId: string, input: PageInput, db?: Queryable) {
  return transaction(async (client) => {
    const content = validateContent(input.content ?? {})
    const page = await uniqueViolation(
      async () =>
        (await queryOne<PageRow>(
          `INSERT INTO websites_websitepage (id, slug, title, page_type, content, seo_title, seo_description, sort_order, is_published, created_at, updated_at, website_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $10) RETURNING *`,
          [randomUUID(), input.slug, input.title, input.page_type ?? 'standard', JSON.stringify(content), input.seo_title ?? '', input.seo_description ?? '', input.sort_order ?? 0, input.is_published ?? false, websiteId],
          client,
        ))!,
      'A page with this slug already exists for this website.',
    )
    await unpublishOnEdit(client, websiteId)
    return page
  }, db)
}

export async function updatePage(page: PageRow, input: Partial<PageInput>) {
  return transaction(async (client) => {
    const changes: Record<string, unknown> = { ...input }
    if ('content' in input) changes.content = JSON.stringify(validateContent(input.content))
    const entries = Object.entries(changes)
    const updated = await uniqueViolation(
      async () =>
        (await queryOne<PageRow>(
          `UPDATE websites_websitepage SET ${entries.map(([key], index) => `${key} = $${index + 2}`).concat('updated_at = CURRENT_TIMESTAMP').join(', ')} WHERE id = $1 RETURNING *`,
          [page.id, ...entries.map(([, value]) => value)],
          client,
        ))!,
      'A page with this slug already exists for this website.',
    )
    await unpublishOnEdit(client, page.website_id)
    return updated
  })
}

export async function ownedPage(websiteId: string, pageId: string) {
  const page = await queryOne<PageRow>('SELECT * FROM websites_websitepage WHERE id = $1 AND website_id = $2', [pageId, websiteId])
  if (!page) throw notFound('No WebsitePage matches the given query.')
  return page
}

export async function deletePage(page: PageRow) {
  await database().query('DELETE FROM websites_websitepage WHERE id = $1', [page.id])
}
