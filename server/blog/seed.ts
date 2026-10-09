import 'server-only'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { slugify } from '../websites/service'
import { getOrCreateCategory, sanitizeBlogHtml } from './service'
import editorial from './seed/editorial.json'
import expanded from './seed/expanded.json'

/** seed_blog, seed_expanded_blog and seed_domain_service_blog management commands. */

const SITE_ORIGIN = 'https://maven-host.com'
const SITEMAP = path.join(process.cwd(), 'public', 'sitemap-blog.xml')

type Article = [string, string, string, string[], string, string, string, string[]]
const ARTICLES = expanded.articles as unknown as Article[]
const SOURCES = expanded.sources as unknown as Record<string, [string, string]>

/** Python `html.escape` (quotes included). */
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

/** `article_html` (Python `html.escape` escapes quotes by default). */
export function articleHtml([title, , summary, steps, risk, verification, sourceKey]: Article) {
  const [label, url] = SOURCES[sourceKey]
  return `<p>${escapeHtml(summary)}</p><h2>Implementation guide</h2><ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol><h2>Common mistake to avoid</h2><p>${escapeHtml(risk)}</p><h2>How to verify the result</h2><p>${escapeHtml(verification)}</p><h2>Further reading</h2><p>Consult the <a href="${escapeHtml(url)}" title="Official documentation">${escapeHtml(label)}</a> for version-specific details while applying this guide to ${escapeHtml(title)}.</p>`
}

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

async function defaultAuthor(db: Queryable, createEditorial = false) {
  const existing = await queryOne<{ id: string }>('SELECT id FROM accounts_user ORDER BY is_superuser DESC, date_joined, id LIMIT 1', [], db)
  if (existing || !createEditorial) return existing?.id ?? null
  const id = randomUUID()
  await db.query(
    `INSERT INTO accounts_user (id, password, last_login, is_superuser, email, first_name, last_name, is_active, is_staff, is_email_verified, date_joined)
     VALUES ($1, $2, NULL, false, 'editorial@maven-host.com', 'MavenHost', '', false, false, false, CURRENT_TIMESTAMP)`,
    [id, `!${randomUUID().replace(/-/g, '')}`],
  )
  return id
}

async function tagBySlug(slug: string, name: string, db: Queryable) {
  const existing = await queryOne<{ id: string }>('SELECT id FROM blog_blogtag WHERE slug = $1', [slug], db)
  if (existing) return existing.id
  const id = randomUUID()
  await db.query(`INSERT INTO blog_blogtag (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [id, name, slug])
  return id
}

type SeedPost = { title: string; authorId: string; categoryId: string; excerpt: string; content: string; isFeatured: boolean; publishedAt: Date; seoTitle: string; seoDescription: string; tagIds: string[]; keepExisting?: boolean }

/** `update_or_create(title=...)` followed by `tags.set(...)`. */
async function upsertPost(post: SeedPost, db: Queryable): Promise<boolean> {
  const content = sanitizeBlogHtml(post.content)
  const excerpt = post.excerpt || plain(content).slice(0, 320)
  const existing = await queryOne<{ id: string; author_id: string; published_at: Date | null }>('SELECT id, author_id, published_at FROM blog_blogpost WHERE title = $1 ORDER BY created_at LIMIT 1', [post.title], db)
  let id = existing?.id
  if (existing) {
    await db.query(
      `UPDATE blog_blogpost SET author_id = $2, category_id = $3, excerpt = $4, content = $5, is_featured = $6, status = 'published', published_at = $7, seo_title = $8,
         seo_description = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [existing.id, post.keepExisting ? existing.author_id : post.authorId, post.categoryId, excerpt, content, post.isFeatured, post.keepExisting && existing.published_at ? existing.published_at : post.publishedAt, post.seoTitle, post.seoDescription],
    )
  } else {
    id = randomUUID()
    let slug = slugify(post.title).slice(0, 220) || 'post'
    for (let counter = 2; await queryOne('SELECT 1 FROM blog_blogpost WHERE slug = $1', [slug], db); counter++) slug = `${(slugify(post.title).slice(0, 220) || 'post').slice(0, 220 - `-${counter}`.length)}-${counter}`
    await db.query(
      `INSERT INTO blog_blogpost (id, title, slug, excerpt, content, featured_image_url, is_featured, status, published_at, seo_title, seo_description, category_id, author_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '', $6, 'published', $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, post.title, slug, excerpt, content, post.isFeatured, post.publishedAt, post.seoTitle, post.seoDescription, post.categoryId, post.authorId],
    )
  }
  await db.query('DELETE FROM blog_blogpost_tags WHERE blogpost_id = $1', [id])
  for (const tagId of new Set(post.tagIds)) await db.query('INSERT INTO blog_blogpost_tags (blogpost_id, blogtag_id) VALUES ($1, $2)', [id, tagId])
  return !existing
}

async function categoryBySlug(name: string, description: string, db: Queryable, update: boolean) {
  const slug = slugify(name)
  const existing = await queryOne<{ id: string }>('SELECT id FROM blog_blogcategory WHERE slug = $1 OR name = $2 ORDER BY (slug = $1) DESC LIMIT 1', [slug, name], db)
  if (existing) {
    if (update) await db.query('UPDATE blog_blogcategory SET name = $2, description = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [existing.id, name, description.slice(0, 255)])
    return existing.id
  }
  const id = randomUUID()
  await db.query(`INSERT INTO blog_blogcategory (id, name, slug, description, created_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [id, name, slug, description.slice(0, 255)])
  return id
}

/** Rewrites public/sitemap-blog.xml with existing URLs plus every published post. */
export async function writeBlogSitemap(db: Queryable = database(), file = SITEMAP) {
  const urls = new Set<string>()
  try {
    for (const match of (await readFile(file, 'utf8')).matchAll(/<(?:\w+:)?loc>([^<]+)<\/(?:\w+:)?loc>/g)) urls.add(match[1].trim())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const row of await query<{ slug: string }>(`SELECT slug FROM blog_blogpost WHERE status = 'published'`, [], db)) urls.add(`${SITE_ORIGIN}/blog/${row.slug}`)
  const body = [...urls].sort().map((url) => `  <url>\n    <loc>${url.replace(/&/g, '&amp;')}</loc>\n  </url>`).join('\n')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `<?xml version='1.0' encoding='utf-8'?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`, 'utf8')
  return urls.size
}

export async function seedExpandedBlog(options: { sitemap?: string | false } = {}) {
  if (ARTICLES.length < 200) throw new Error(`Expected at least 200 articles, found ${ARTICLES.length}.`)
  const result = await transaction(async (client) => {
    const authorId = await defaultAuthor(client)
    if (!authorId) throw new Error('Create the blog author account before seeding the articles.')
    const categories = new Map<string, string>()
    for (const [name, description] of Object.entries(expanded.categories as Record<string, string>)) categories.set(name, await categoryBySlug(name, description, client, true))
    const now = new Date()
    let created = 0
    for (const article of ARTICLES) {
      const [title, category, summary, , , , , tagNames] = article
      const tagIds = [] as string[]
      for (const tag of tagNames) tagIds.push(await tagBySlug(slugify(tag).slice(0, 100), tag.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80), client))
      if (await upsertPost({ title, authorId, categoryId: categories.get(category)!, excerpt: summary.slice(0, 320), content: articleHtml(article), isFeatured: false, publishedAt: now, seoTitle: title.slice(0, 220), seoDescription: summary.slice(0, 160), tagIds }, client)) created++
    }
    return { created, updated: ARTICLES.length - created }
  })
  const urls = options.sitemap === false ? null : await writeBlogSitemap(database(), options.sitemap)
  return `Expanded library ready: ${result.created} created, ${result.updated} updated, ${ARTICLES.length} additional posts${urls === null ? '' : `; sitemap has ${urls} URLs`}.`
}

export async function seedBlog(options: { createEditorialAuthor?: boolean; sitemap?: string | false } = {}) {
  const posts = editorial.posts as { title: string; seo_title: string; seo_description: string; category: string; tags: string[]; excerpt: string; content: string; is_featured: boolean; days_ago: number }[]
  const result = await transaction(async (client) => {
    const authorId = await defaultAuthor(client, options.createEditorialAuthor)
    if (!authorId) return null
    const categories = new Map<string, string>()
    for (const entry of editorial.categories) {
      const category = await getOrCreateCategory(entry.name, entry.description, client)
      await client.query('UPDATE blog_blogcategory SET description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [category.id, entry.description])
      categories.set(entry.name, category.id)
    }
    const tags = new Map<string, string>()
    for (const name of editorial.tags) {
      const existing = await queryOne<{ id: string }>('SELECT id FROM blog_blogtag WHERE name = $1', [name], client)
      tags.set(name, existing?.id ?? (await tagBySlug(name.replace(/_/g, '-'), name, client)))
    }
    const now = Date.now()
    let created = 0
    for (const entry of posts)
      if (await upsertPost({
        title: entry.title, authorId, categoryId: categories.get(entry.category)!, excerpt: entry.excerpt.trim(), content: entry.content.trim(), isFeatured: entry.is_featured,
        publishedAt: new Date(now - entry.days_ago * 86_400_000), seoTitle: entry.seo_title.trim(), seoDescription: entry.seo_description.trim(),
        tagIds: entry.tags.filter((tag) => tags.has(tag)).map((tag) => tags.get(tag)!),
      }, client)) created++
    return created
  })
  if (result === null) return 'No users exist yet - create a superuser first.'
  const summary = `Blog library ready: ${result} created, ${posts.length - result} updated, ${posts.length} published posts, ${editorial.categories.length} categories, ${editorial.tags.length} tags.`
  return `${summary}\n${await seedExpandedBlog(options)}`
}

export async function seedDomainServiceBlog(options: { sitemap?: string | false } = {}) {
  const titles = new Set(expanded.domain_service_titles)
  const articles = ARTICLES.filter((article) => titles.has(article[0]))
  if (articles.length !== titles.size) throw new Error('The focused domain and hosting article set is incomplete.')
  const result = await transaction(async (client) => {
    const authorId =
      (await queryOne<{ author_id: string }>(`SELECT author_id FROM blog_blogpost WHERE status = 'published' ORDER BY published_at DESC NULLS LAST LIMIT 1`, [], client))?.author_id ?? (await defaultAuthor(client))
    if (!authorId) throw new Error('Create the blog author account before seeding these articles.')
    let created = 0
    const now = new Date()
    for (const article of articles) {
      const [title, categoryName, summary, , , , , tagNames] = article
      const categoryId = await categoryBySlug(categoryName, `Practical guides about ${categoryName.toLowerCase()}.`, client, false)
      const tagIds = [] as string[]
      for (const tag of tagNames) tagIds.push(await tagBySlug(slugify(tag).slice(0, 100), tag.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80), client))
      if (await upsertPost({ title, authorId, categoryId, excerpt: summary.slice(0, 320), content: articleHtml(article), isFeatured: false, publishedAt: now, seoTitle: title.slice(0, 220), seoDescription: summary.slice(0, 160), tagIds, keepExisting: true }, client)) created++
    }
    return created
  })
  if (options.sitemap !== false) await writeBlogSitemap(database(), options.sitemap)
  return `Focused guides ready: ${result} created, ${articles.length - result} refreshed.`
}
