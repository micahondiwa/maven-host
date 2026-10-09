import 'server-only'
import { randomUUID } from 'node:crypto'
import sanitizeHtml from 'sanitize-html'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { DetailError, notFound, ValidationError } from '../http/errors'
import { paginate, pageWindow } from '../http/pagination'
import { audit } from '../audit/audit'
import { slugify } from '../websites/service'

/** Port of apps/blog (models.py, api/views, api/serializers). */

export const BLOG_POST_STATUSES = ['draft', 'published', 'archived'] as const
export type BlogPostStatus = (typeof BLOG_POST_STATUSES)[number]

const SOFTWARE_DEVELOPMENT_CATEGORIES = new Set([
  'ai-assisted-development', 'django-python', 'react-frontend', 'mern-stack', 'frontend-web-design', 'vue-angular-svelte', 'next-js', 'node-js', 'php-laravel',
  'fastapi-flask', 'java-spring', 'net-development', 'go-rust-rails', 'flutter-cross-platform', 'android-development', 'ios-development', 'databases-data',
  'devops-ci-cd', 'security-performance',
])

const ALLOWED_TAGS = ['a', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure', 'h2', 'h3', 'h4', 'hr', 'img', 'li', 'ol', 'p', 'pre', 's', 'strong', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']

/** `sanitize_blog_html`: bleach with strip=True; script/style/iframe/object/embed are dropped with their content. */
export function sanitizeBlogHtml(value: string): string {
  return sanitizeHtml(value ?? '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'textarea', 'noscript'],
  }).trim()
}

/** Django `strip_tags` followed by whitespace collapsing. */
const plainText = (html: string) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()

type SlugTable = 'blog_blogpost' | 'blog_blogcategory' | 'blog_blogtag'

/** `_make_unique_slug`. */
async function uniqueSlug(table: SlugTable, value: string, instanceId: string | null, db: Queryable) {
  const base = slugify(value).slice(0, 220) || 'post'
  let candidate = base
  for (let counter = 2; ; counter++) {
    const taken = await queryOne(`SELECT 1 FROM ${table} WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`, [candidate, instanceId], db)
    if (!taken) return candidate
    const suffix = `-${counter}`
    candidate = `${base.slice(0, 220 - suffix.length)}${suffix}`
  }
}

type PostRow = {
  id: string; title: string; slug: string; excerpt: string; content: string; featured_image_url: string; is_featured: boolean; status: BlogPostStatus
  published_at: Date | null; seo_title: string; seo_description: string; created_at: Date; updated_at: Date; author_id: string; category_id: string | null
}
type CategoryRow = { id: string; name: string; slug: string; description: string }
type TagRow = { id: string; name: string; slug: string }
type AuthorRow = { id: string; email: string; first_name: string; last_name: string }

const PUBLIC = `p.status = 'published' AND p.published_at <= CURRENT_TIMESTAMP`

/** Words split on whitespace, 200 per minute, rounded up, at least one. */
const readingTime = (content: string) => Math.max(1, Math.floor((content.split(/\s+/).filter(Boolean).length + 199) / 200))

async function relations(posts: PostRow[], db: Queryable = database()) {
  const ids = posts.map((post) => post.id)
  const categoryIds = [...new Set(posts.map((post) => post.category_id).filter((id): id is string => Boolean(id)))]
  const authorIds = [...new Set(posts.map((post) => post.author_id))]
  const [categories, tags, authors] = await Promise.all([
    query<CategoryRow>('SELECT id, name, slug, description FROM blog_blogcategory WHERE id = ANY($1::uuid[])', [categoryIds], db),
    query<TagRow & { blogpost_id: string }>('SELECT t.id, t.name, t.slug, pt.blogpost_id FROM blog_blogpost_tags pt JOIN blog_blogtag t ON t.id = pt.blogtag_id WHERE pt.blogpost_id = ANY($1::uuid[]) ORDER BY t.name', [ids], db),
    query<AuthorRow>('SELECT id, email, first_name, last_name FROM accounts_user WHERE id = ANY($1::uuid[])', [authorIds], db),
  ])
  return {
    category: new Map(categories.map((row) => [row.id, row])),
    author: new Map(authors.map((row) => [row.id, row])),
    tags: (postId: string) => tags.filter((tag) => tag.blogpost_id === postId),
  }
}

async function publicCounts(column: 'category_id' | 'tag', ids: string[], db: Queryable = database()) {
  const rows =
    column === 'category_id'
      ? await query<{ id: string; n: number }>(`SELECT p.category_id AS id, count(*)::integer AS n FROM blog_blogpost p WHERE ${PUBLIC} AND p.category_id = ANY($1::uuid[]) GROUP BY p.category_id`, [ids], db)
      : await query<{ id: string; n: number }>(`SELECT pt.blogtag_id AS id, count(DISTINCT p.id)::integer AS n FROM blog_blogpost_tags pt JOIN blog_blogpost p ON p.id = pt.blogpost_id WHERE ${PUBLIC} AND pt.blogtag_id = ANY($1::uuid[]) GROUP BY pt.blogtag_id`, [ids], db)
  return new Map(rows.map((row) => [row.id, row.n]))
}

function authorName(post: PostRow, category: CategoryRow | undefined, author: AuthorRow | undefined) {
  if (category && SOFTWARE_DEVELOPMENT_CATEGORIES.has(category.slug)) return 'Micah Ondiwa'
  if (category) return 'MavenHost'
  const full = `${author?.first_name ?? ''} ${author?.last_name ?? ''}`.trim()
  return full === 'Maven Host' ? 'MavenHost' : full || 'MavenHost'
}

async function publicPostData(posts: PostRow[], detail: boolean) {
  const related = await relations(posts)
  const categoryCounts = await publicCounts('category_id', [...related.category.keys()])
  const tagIds = [...new Set(posts.flatMap((post) => related.tags(post.id).map((tag) => tag.id)))]
  const tagCounts = await publicCounts('tag', tagIds)
  return posts.map((post) => {
    const category = post.category_id ? related.category.get(post.category_id) : undefined
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      author: authorName(post, category, related.author.get(post.author_id)),
      category: category ? { name: category.name, slug: category.slug, description: category.description, post_count: categoryCounts.get(category.id) ?? 0 } : null,
      tags: related.tags(post.id).map((tag) => ({ name: tag.name, slug: tag.slug, post_count: tagCounts.get(tag.id) ?? 0 })),
      excerpt: post.excerpt,
      featured_image_url: post.featured_image_url,
      is_featured: post.is_featured,
      published_at: post.published_at,
      reading_time_minutes: readingTime(post.content),
      seo_title: post.seo_title,
      seo_description: post.seo_description,
      ...(detail ? { content: post.content, created_at: post.created_at, updated_at: post.updated_at } : {}),
    }
  })
}

export async function listPublicPosts(url: URL, page: number, size: number) {
  const where = [PUBLIC]
  const params: unknown[] = []
  const search = (url.searchParams.get('search') ?? '').trim()
  const category = (url.searchParams.get('category') ?? '').trim()
  const tag = (url.searchParams.get('tag') ?? '').trim()
  const featured = url.searchParams.get('featured')?.toLowerCase()
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
    where.push(`(p.title ILIKE $${params.length} OR p.excerpt ILIKE $${params.length} OR p.content ILIKE $${params.length})`)
  }
  if (category) {
    params.push(category)
    where.push(`p.category_id IN (SELECT id FROM blog_blogcategory WHERE slug = $${params.length})`)
  }
  if (tag) {
    params.push(tag)
    where.push(`p.id IN (SELECT pt.blogpost_id FROM blog_blogpost_tags pt JOIN blog_blogtag t ON t.id = pt.blogtag_id WHERE t.slug = $${params.length})`)
  }
  if (featured === 'true' || featured === '1') where.push('p.is_featured')
  else if (featured === 'false' || featured === '0') where.push('NOT p.is_featured')
  const clause = where.join(' AND ')
  const count = (await queryOne<{ n: number }>(`SELECT count(*)::integer AS n FROM blog_blogpost p WHERE ${clause}`, params))!.n
  const { current, offset } = pageWindow(count, page, size)
  const posts = await query<PostRow>(
    `SELECT p.* FROM blog_blogpost p WHERE ${clause} ORDER BY p.published_at DESC, p.created_at DESC, p.id LIMIT ${size} OFFSET ${offset}`,
    params,
  )
  return paginate(url, count, current, size, await publicPostData(posts, false))
}

export async function publicPost(slug: string) {
  const post = await queryOne<PostRow>(`SELECT p.* FROM blog_blogpost p WHERE p.slug = $1 AND ${PUBLIC}`, [slug])
  if (!post) throw notFound()
  return (await publicPostData([post], true))[0]
}

export async function publicCategories() {
  return query(
    `SELECT c.name, c.slug, c.description, count(p.id)::integer AS post_count FROM blog_blogcategory c JOIN blog_blogpost p ON p.category_id = c.id AND ${PUBLIC}
      GROUP BY c.id ORDER BY c.name`,
  )
}

export async function publicTags() {
  return query(
    `SELECT t.name, t.slug, count(DISTINCT p.id)::integer AS post_count FROM blog_blogtag t
       JOIN blog_blogpost_tags pt ON pt.blogtag_id = t.id JOIN blog_blogpost p ON p.id = pt.blogpost_id AND ${PUBLIC}
      GROUP BY t.id ORDER BY t.name`,
  )
}

// ---- Staff ----

async function staffPostData(posts: PostRow[], detail: boolean, db: Queryable = database()) {
  const related = await relations(posts, db)
  return posts.map((post) => {
    const author = related.author.get(post.author_id)
    const category = post.category_id ? related.category.get(post.category_id) : undefined
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      author: author ? { id: author.id, email: author.email, name: `${author.first_name} ${author.last_name}`.trim() || author.email } : null,
      category: category ? { id: category.id, name: category.name, slug: category.slug, description: category.description } : null,
      tags: related.tags(post.id).map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug })),
      excerpt: post.excerpt,
      is_featured: post.is_featured,
      status: post.status,
      published_at: post.published_at,
      seo_title: post.seo_title,
      seo_description: post.seo_description,
      created_at: post.created_at,
      updated_at: post.updated_at,
      ...(detail ? { content: post.content, featured_image_url: post.featured_image_url } : {}),
    }
  })
}

export async function listStaffPosts(url: URL, page: number, size: number) {
  const where: string[] = ['TRUE']
  const params: unknown[] = []
  const status = (url.searchParams.get('status') ?? '').trim()
  const search = (url.searchParams.get('search') ?? '').trim()
  if (status) {
    params.push(status)
    where.push(`p.status = $${params.length}`)
  }
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
    where.push(`p.title ILIKE $${params.length}`)
  }
  const clause = where.join(' AND ')
  const count = (await queryOne<{ n: number }>(`SELECT count(*)::integer AS n FROM blog_blogpost p WHERE ${clause}`, params))!.n
  const { current, offset } = pageWindow(count, page, size)
  const posts = await query<PostRow>(`SELECT p.* FROM blog_blogpost p WHERE ${clause} ORDER BY p.updated_at DESC, p.id LIMIT ${size} OFFSET ${offset}`, params)
  return paginate(url, count, current, size, await staffPostData(posts, false))
}

export async function staffPost(id: string, db: Queryable = database()) {
  const post = await queryOne<PostRow>('SELECT * FROM blog_blogpost WHERE id = $1', [id], db)
  if (!post) throw notFound('No BlogPost matches the given query.')
  return (await staffPostData([post], true, db))[0]
}

export type PostInput = {
  title: string; slug: string; category_id: string | null; tag_names: string[]; excerpt: string; content: string; featured_image_url: string
  is_featured: boolean; status: BlogPostStatus; seo_title: string; seo_description: string
}

async function tagFor(name: string, db: Queryable) {
  const existing = await queryOne<{ id: string }>('SELECT id FROM blog_blogtag WHERE name = $1', [name], db)
  if (existing) return existing.id
  const id = randomUUID()
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO blog_blogtag (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (name) DO NOTHING RETURNING id`,
    [id, name, await uniqueSlug('blog_blogtag', name, null, db)],
    db,
  )
  return inserted?.id ?? (await queryOne<{ id: string }>('SELECT id FROM blog_blogtag WHERE name = $1', [name], db))!.id
}

async function setTags(postId: string, names: string[], db: Queryable) {
  const tagIds = [...new Set(await Promise.all(names.map((name) => tagFor(name, db))))]
  await db.query('DELETE FROM blog_blogpost_tags WHERE blogpost_id = $1 AND NOT (blogtag_id = ANY($2::uuid[]))', [postId, tagIds])
  for (const tagId of tagIds)
    await db.query(
      'INSERT INTO blog_blogpost_tags (blogpost_id, blogtag_id) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM blog_blogpost_tags WHERE blogpost_id = $1 AND blogtag_id = $2)',
      [postId, tagId],
    )
}

/** Create or replace a post (v1 PATCH also requires the complete payload). */
export async function savePost(input: { actorId: string; postId: string | null; data: PostInput; ipAddress: string | null }) {
  const { data } = input
  if (data.category_id && !(await queryOne('SELECT 1 FROM blog_blogcategory WHERE id = $1', [data.category_id])))
    throw new ValidationError({ category_id: ['That category does not exist.'] })
  if (data.featured_image_url.length > 200)
    throw new ValidationError({ featured_image_url: [`Ensure this value has at most 200 characters (it has ${data.featured_image_url.length}).`] })
  return transaction(async (client) => {
    const existing = input.postId ? await queryOne<PostRow>('SELECT * FROM blog_blogpost WHERE id = $1 FOR UPDATE', [input.postId], client) : null
    if (input.postId && !existing) throw notFound('No BlogPost matches the given query.')
    const id = existing?.id ?? randomUUID()
    if (data.slug && (await queryOne('SELECT 1 FROM blog_blogpost WHERE slug = $1 AND id <> $2', [data.slug, id], client)))
      throw new ValidationError({ slug: ['Blog Post with this Slug already exists.'] })
    const content = sanitizeBlogHtml(data.content)
    const slug = data.slug || existing?.slug || (await uniqueSlug('blog_blogpost', data.title, id, client))
    const excerpt = data.excerpt || plainText(content).slice(0, 320)
    const becamePublished = data.status === 'published' && existing?.status !== 'published'
    const publishedAt = becamePublished && !existing?.published_at ? new Date() : existing?.published_at ?? null
    const values = [id, data.title, slug, excerpt, content, data.featured_image_url, data.is_featured, data.status, publishedAt, data.seo_title, data.seo_description, data.category_id]
    if (existing)
      await client.query(
        `UPDATE blog_blogpost SET title = $2, slug = $3, excerpt = $4, content = $5, featured_image_url = $6, is_featured = $7, status = $8, published_at = $9,
           seo_title = $10, seo_description = $11, category_id = $12, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        values,
      )
    else
      await client.query(
        `INSERT INTO blog_blogpost (id, title, slug, excerpt, content, featured_image_url, is_featured, status, published_at, seo_title, seo_description, category_id, author_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [...values, input.actorId],
      )
    await setTags(id, data.tag_names, client)
    await audit(
      {
        event: existing ? 'blog.post.updated' : 'blog.post.created', category: 'system', performedBy: input.actorId, target: { appLabel: 'blog', model: 'blogpost', id },
        message: `${existing ? 'Updated' : 'Created'} blog post "${data.title}".`, ipAddress: input.ipAddress,
        metadata: { status: data.status, previous_status: existing?.status ?? null, slug },
      },
      client,
    )
    return staffPost(id, client)
  })
}

export async function deletePost(actorId: string, postId: string, ipAddress: string | null) {
  await transaction(async (client) => {
    // Django deletes many-to-many rows itself; the schema has no ON DELETE CASCADE.
    await client.query('DELETE FROM blog_blogpost_tags WHERE blogpost_id = $1', [postId])
    const post = await queryOne<PostRow>('DELETE FROM blog_blogpost WHERE id = $1 RETURNING *', [postId], client)
    if (!post) throw notFound('No BlogPost matches the given query.')
    await audit({ event: 'blog.post.deleted', category: 'system', performedBy: actorId, target: { appLabel: 'blog', model: 'blogpost', id: postId }, message: `Deleted blog post "${post.title}".`, ipAddress, metadata: { slug: post.slug, status: post.status } }, client)
  })
}

/** Admin bulk actions `publish_posts` and `archive_posts`. */
export async function bulkSetStatus(actorId: string, ids: string[], status: 'published' | 'archived', ipAddress: string | null) {
  if (!ids.length) throw new DetailError('Select at least one post.', 400)
  return transaction(async (client) => {
    const rows = await query<{ id: string }>(
      status === 'published'
        ? `UPDATE blog_blogpost SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[]) RETURNING id`
        : `UPDATE blog_blogpost SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[]) RETURNING id`,
      [ids],
      client,
    )
    for (const row of rows)
      await audit({ event: `blog.post.${status}`, category: 'system', performedBy: actorId, target: { appLabel: 'blog', model: 'blogpost', id: row.id }, message: `Bulk ${status === 'published' ? 'published' : 'archived'} blog post.`, ipAddress }, client)
    return { updated: rows.length }
  })
}

export const staffCategories = () => query<CategoryRow>('SELECT id, name, slug, description FROM blog_blogcategory ORDER BY name')
export const staffTags = () => query<TagRow>('SELECT id, name, slug FROM blog_blogtag ORDER BY name')

/** `get_or_create(name=...)`; the description is used only when the category is new. */
export async function getOrCreateCategory(name: string, description: string, db: Queryable = database()) {
  const existing = await queryOne<CategoryRow>('SELECT id, name, slug, description FROM blog_blogcategory WHERE name = $1', [name], db)
  if (existing) return existing
  await db.query(
    `INSERT INTO blog_blogcategory (id, name, slug, description, created_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (name) DO NOTHING`,
    [randomUUID(), name, await uniqueSlug('blog_blogcategory', name, null, db), description],
  )
  return (await queryOne<CategoryRow>('SELECT id, name, slug, description FROM blog_blogcategory WHERE name = $1', [name], db))!
}

export async function getOrCreateTag(name: string) {
  const id = await tagFor(name, database())
  return (await queryOne<TagRow>('SELECT id, name, slug FROM blog_blogtag WHERE id = $1', [id]))!
}
