import 'server-only'
import { randomUUID } from 'node:crypto'
import { query, queryOne, transaction } from '../db'
import { websitePages, type PageRow } from '../websites/service'

/**
 * Deterministic SEO checks over MavenHost's structured website content (port of apps/seo/services/analyzer.py).
 * v1 findings and scoring are preserved; additional checks cover content depth, title/description length floors,
 * home page presence, slug hygiene, internal links and a conversion path. One finding per page and code, as the
 * schema requires (v1 crashed when one page had two images without alt text).
 */

type Severity = 'error' | 'warning' | 'info'
type Finding = { pageId: string | null; code: string; severity: Severity; title: string; description: string; recommendation: string }

type Section = Record<string, unknown> & { type?: string; items?: unknown }

function sectionsOf(page: PageRow): Section[] {
  const sections = page.content && typeof page.content === 'object' ? (page.content as { sections?: unknown }).sections : []
  return Array.isArray(sections) ? sections.filter((section): section is Section => Boolean(section) && typeof section === 'object' && !Array.isArray(section)) : []
}

function itemsOf(section: Section): Record<string, unknown>[] {
  return Array.isArray(section.items) ? section.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []
}

function wordCount(page: PageRow) {
  const text: string[] = []
  for (const section of sectionsOf(page)) {
    for (const key of ['heading', 'subheading', 'body', 'text']) if (typeof section[key] === 'string') text.push(section[key] as string)
    for (const item of itemsOf(section)) for (const key of ['title', 'description', 'question', 'answer']) if (typeof item[key] === 'string') text.push(item[key] as string)
  }
  return text.join(' ').split(/\s+/).filter(Boolean).length
}

export function analyzePages(pages: PageRow[]): { findings: Finding[]; score: number } {
  const findings: Finding[] = []
  const add = (page: PageRow | null, code: string, severity: Severity, title: string, description: string, recommendation: string) => {
    if (!findings.some((finding) => finding.pageId === (page?.id ?? null) && finding.code === code))
      findings.push({ pageId: page?.id ?? null, code, severity, title, description, recommendation })
  }
  if (!pages.length) add(null, 'NO_PAGES', 'error', 'No pages', 'The website has no pages to index.', 'Create at least a homepage.')
  else if (!pages.some((page) => page.slug === 'home' || page.slug === 'index'))
    add(null, 'MISSING_HOME_PAGE', 'warning', 'No home page', 'No page uses the "home" or "index" slug, so the site has no root page at "/".', 'Give the main page the slug "home".')

  const slugs = new Set(pages.map((page) => page.slug))
  const titles = new Map<string, string>()
  const descriptions = new Map<string, string>()
  let hasConversionPath = false

  for (const page of pages) {
    const title = (page.seo_title ?? '').trim()
    const description = (page.seo_description ?? '').trim()
    if (!title) add(page, 'MISSING_TITLE', 'error', 'Missing SEO title', 'This page has no SEO title.', 'Add a concise title describing the page.')
    else if (page.seo_title.length > 60) add(page, 'TITLE_TOO_LONG', 'warning', 'SEO title is too long', 'The title exceeds the recommended 60-character limit.', 'Shorten the SEO title.')
    else if (title.length < 20) add(page, 'TITLE_TOO_SHORT', 'info', 'SEO title is very short', 'Short titles give search engines little context.', 'Aim for 30–60 characters that name the page and the business.')
    if (!description) add(page, 'MISSING_DESCRIPTION', 'error', 'Missing meta description', 'This page has no meta description.', 'Add a useful description of the page.')
    else if (page.seo_description.length > 160) add(page, 'DESCRIPTION_TOO_LONG', 'warning', 'Meta description is too long', 'The description exceeds the recommended 160-character limit.', 'Shorten the meta description.')
    else if (description.length < 70) add(page, 'DESCRIPTION_TOO_SHORT', 'info', 'Meta description is short', 'Search results may replace a very short description with other page text.', 'Aim for 70–160 characters that summarise the page.')

    const sections = sectionsOf(page)
    const heroes = sections.filter((section) => section.type === 'hero')
    if (!heroes.length) add(page, 'MISSING_HERO', 'info', 'No hero section', 'The page has no hero section.', 'Consider adding a clear introductory section.')
    if (!heroes.some((section) => String(section.heading ?? '').trim()))
      add(page, 'MISSING_H1', 'error', 'Missing main heading', 'The page has no populated main heading.', 'Add a descriptive heading to one hero section.')
    else if (heroes.length > 1) add(page, 'MULTIPLE_H1', 'warning', 'Multiple main headings', 'Multiple hero sections render multiple H1 headings.', 'Keep one main hero heading per page.')

    for (const [value, seen, code, label] of [[title, titles, 'DUPLICATE_TITLE', 'SEO title'], [description, descriptions, 'DUPLICATE_DESCRIPTION', 'meta description']] as const) {
      const normalized = value.toLowerCase()
      if (normalized && seen.has(normalized)) add(page, code, 'warning', `Duplicate ${label}`, `This ${label} is also used by another page.`, `Write a unique ${label} for this page.`)
      if (normalized) seen.set(normalized, page.id)
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug))
      add(page, 'UNFRIENDLY_SLUG', 'warning', 'Page address is hard to read', 'The page slug uses capitals, underscores or repeated hyphens.', 'Use short lowercase words separated by single hyphens.')

    const words = wordCount(page)
    if (words < 150) add(page, 'THIN_CONTENT', 'warning', 'Thin page content', `The page has about ${words} words of visible text.`, 'Expand the page with useful detail for visitors (at least 150 words).')

    for (const section of sections) {
      if (section.type === 'contact' || String(section.cta ?? '').trim()) hasConversionPath = true
      const missingAlt = itemsOf(section).filter((item) => (item.image_url || item.url) && !String(item.alt ?? '').trim()).length
      if (missingAlt) add(page, 'MISSING_IMAGE_ALT', 'warning', 'Missing image description', `${missingAlt === 1 ? 'An image has' : `${missingAlt} images have`} no alternative text.`, 'Describe meaningful images with useful alt text.')
      const url = String(section.cta_url ?? section.url ?? '').trim()
      if (url && !/^(https:\/\/|http:\/\/|\/|#)/.test(url))
        add(page, 'INVALID_CTA_URL', 'warning', 'Unsupported action link', 'The renderer cannot use this action URL.', 'Use an HTTPS URL, relative path, or page anchor.')
      else if (url.startsWith('/') && !url.startsWith('//')) {
        const target = url.replace(/^\/+/, '').replace(/\.html$/, '').split(/[?#]/)[0]
        if (target && !slugs.has(target))
          add(page, 'BROKEN_INTERNAL_LINK', 'warning', 'Link to a missing page', `An action links to "${url}", which is not a page on this website.`, 'Point the link at an existing page or create that page.')
      }
    }
  }
  if (pages.length && !hasConversionPath)
    add(null, 'NO_CONVERSION_PATH', 'info', 'No call to action', 'No page has a contact section or action button.', 'Add a clear next step, such as a contact section or a call-to-action button.')

  const errors = findings.filter((finding) => finding.severity === 'error').length
  const warnings = findings.filter((finding) => finding.severity === 'warning').length
  return { findings, score: Math.max(0, 100 - errors * 15 - warnings * 5) }
}

export async function analyzeWebsite(websiteId: string) {
  return transaction(async (client) => {
    const analysisId = randomUUID()
    await client.query(
      `INSERT INTO seo_seoanalysis (id, status, score, started_at, completed_at, error_message, created_at, website_id)
       VALUES ($1, 'running', 0, CURRENT_TIMESTAMP, NULL, '', CURRENT_TIMESTAMP, $2)`,
      [analysisId, websiteId],
    )
    const { findings, score } = analyzePages(await websitePages(websiteId, client))
    for (const finding of findings)
      await client.query(
        `INSERT INTO seo_seofinding (id, code, severity, title, description, recommendation, analysis_id, page_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), finding.code, finding.severity, finding.title, finding.description, finding.recommendation, analysisId, finding.pageId],
      )
    await client.query(`UPDATE seo_seoanalysis SET score = $2, status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [analysisId, score])
    return analysisData(analysisId, client)
  })
}

export async function analysisData(analysisId: string, db?: Parameters<typeof query>[2]) {
  const analysis = (await queryOne<{ id: string; status: string; score: number; started_at: Date; completed_at: Date | null; created_at: Date }>(
    'SELECT id, status, score, started_at, completed_at, created_at FROM seo_seoanalysis WHERE id = $1',
    [analysisId],
    db,
  ))!
  const findings = await query<{ id: string; page_id: string | null; code: string; severity: Severity; title: string; description: string; recommendation: string }>(
    'SELECT id, page_id, code, severity, title, description, recommendation FROM seo_seofinding WHERE analysis_id = $1',
    [analysisId],
    db,
  )
  // Model ordering ("severity", "code") is alphabetical: error, info, warning.
  findings.sort((a, b) => (a.severity < b.severity ? -1 : a.severity > b.severity ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  return { id: analysis.id, status: analysis.status, score: analysis.score, findings, started_at: analysis.started_at, completed_at: analysis.completed_at, created_at: analysis.created_at }
}

export async function latestAnalysis(websiteId: string) {
  const latest = await queryOne<{ id: string }>('SELECT id FROM seo_seoanalysis WHERE website_id = $1 ORDER BY created_at DESC LIMIT 1', [websiteId])
  return latest ? analysisData(latest.id) : null
}
