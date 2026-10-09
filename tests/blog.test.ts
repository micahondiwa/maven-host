import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-blog-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

describe('blog HTML sanitising', () => {
  it('keeps the v1 allow-list, drops active content and unsafe links', async () => {
    const { sanitizeBlogHtml } = await import('../server/blog/service')
    expect(sanitizeBlogHtml('<p onclick="x()">Hi <script>alert(1)</script><b>bold</b></p><iframe src="https://x">frame</iframe>')).toBe('<p>Hi bold</p>')
    expect(sanitizeBlogHtml('<a href="javascript:alert(1)" target="_blank">x</a><a href="https://maven-host.com" title="t">y</a>')).toBe('<a>x</a><a href="https://maven-host.com" title="t">y</a>')
    expect(sanitizeBlogHtml('<img src="data:image/png;base64,AA" alt="a"><img src="/logo.png" alt="b">')).toBe('<img alt="a" /><img src="/logo.png" alt="b" />')
  })

  it('renders expanded articles like the v1 article_html', async () => {
    const { articleHtml } = await import('../server/blog/seed')
    expect(articleHtml(['A & B', 'Domains', 'Sum "q"', ['one', 'two<'], 'risk', 'verify', Object.keys((await import('../server/blog/seed/expanded.json')).default.sources)[0], []])).toMatch(
      /^<p>Sum &quot;q&quot;<\/p><h2>Implementation guide<\/h2><ol><li>one<\/li><li>two&lt;<\/li><\/ol>.*applying this guide to A &amp; B\.<\/p>$/,
    )
  })
})

suite('blog API', () => {
  let api: typeof import('../server/api')
  const run = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  let ip = 0

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.7.${++ip % 250}` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function account(role: 'Customer' | 'Sales' | 'Support') {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `blog-${role}-${run}-${++ip}@example.test`
    await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: role !== 'Customer', is_email_verified: true })
      await addToGroup(client, user.id, role)
    })
    return (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body.access as string
  }

  beforeAll(async () => {
    api = await import('../server/api')
    const { transaction } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
  })
  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())
  afterAll(async () => (await import('../server/db')).database().end())

  it('lets editors write, publish and bulk-archive posts that the public then sees', async () => {
    const editor = await account('Sales')
    const support = await account('Support')
    const customer = await account('Customer')
    expect((await call('GET', '/blog/staff/posts/', { token: customer })).status).toBe(403)
    expect((await call('POST', '/blog/staff/posts/', { token: support, body: { title: 't', content: 'c' } })).status).toBe(403)

    const category = await call('POST', '/blog/staff/categories/', { token: editor, body: { name: `Hosting ${run}` } })
    expect(category).toMatchObject({ status: 201, body: { name: `Hosting ${run}`, slug: `hosting-${run}`, description: '' } })
    expect((await call('POST', '/blog/staff/posts/', { token: editor, body: { title: 'x', content: 'y', slug: 'bad slug', category_id: '00000000-0000-4000-8000-000000000000' } })).body).toEqual({
      slug: ['Enter a valid "slug" consisting of letters, numbers, underscores or hyphens.'],
    })
    expect((await call('POST', '/blog/staff/posts/', { token: editor, body: { title: 'x', content: 'y', category_id: '00000000-0000-4000-8000-000000000000' } })).body).toEqual({ category_id: ['That category does not exist.'] })

    const title = `Speed up WordPress ${run}`
    const draft = await call('POST', '/blog/staff/posts/', {
      token: editor,
      body: { title, content: '<p>Cache <em>everything</em>.</p><script>bad()</script>', category_id: category.body.id, tag_names: [`perf-${run}`, `perf-${run}`] },
    })
    expect(draft).toMatchObject({ status: 201, body: { slug: `speed-up-wordpress-${run}`, status: 'draft', published_at: null, excerpt: 'Cache everything.', content: '<p>Cache <em>everything</em>.</p>', tags: [{ name: `perf-${run}` }] } })
    const second = await call('POST', '/blog/staff/posts/', { token: editor, body: { title, content: 'Again', slug: draft.body.slug } })
    expect(second.body).toEqual({ slug: ['Blog Post with this Slug already exists.'] })
    expect((await call('GET', `/blog/${draft.body.slug}/`)).status).toBe(404)

    const published = await call('PATCH', `/blog/staff/posts/${draft.body.id}/`, { token: editor, body: { title, content: draft.body.content, category_id: category.body.id, tag_names: [`perf-${run}`], status: 'published' } })
    expect(published.body).toMatchObject({ status: 'published', published_at: expect.stringMatching(/\+03:00$/) })
    const publicPost = (await call('GET', `/blog/${draft.body.slug}/`)).body
    expect(publicPost).toMatchObject({ title, author: 'MavenHost', reading_time_minutes: 1, category: { slug: `hosting-${run}`, post_count: 1 }, tags: [{ slug: `perf-${run}`, post_count: 1 }] })
    expect(publicPost).not.toHaveProperty('status')
    const listed = (await call('GET', `/blog/?category=hosting-${run}&search=everything`)).body
    expect(listed).toMatchObject({ count: 1, next: null, results: [{ slug: draft.body.slug }] })
    expect(listed.results[0]).not.toHaveProperty('content')
    expect((await call('GET', '/blog/categories/')).body).toContainEqual({ name: `Hosting ${run}`, slug: `hosting-${run}`, description: '', post_count: 1 })

    expect((await call('POST', '/blog/staff/posts/bulk-status/', { token: editor, body: { ids: [draft.body.id], status: 'archived' } })).body).toEqual({ updated: 1 })
    expect((await call('GET', `/blog/${draft.body.slug}/`)).status).toBe(404)
    expect((await call('DELETE', `/blog/staff/posts/${draft.body.id}/`, { token: support })).status).toBe(403)
    expect((await call('DELETE', `/blog/staff/posts/${draft.body.id}/`, { token: editor })).status).toBe(204)
    const { query } = await import('../server/db')
    expect((await query(`SELECT event FROM audit_auditlog WHERE object_id = $1 ORDER BY id`, [draft.body.id])).map((row) => row.event)).toEqual([
      'blog.post.created', 'blog.post.updated', 'blog.post.archived', 'blog.post.deleted',
    ])
  }, 120_000)

  it('seeds the editorial library idempotently and writes the sitemap', async () => {
    const { seedBlog } = await import('../server/blog/seed')
    const sitemap = path.join(mkdtempSync(path.join(tmpdir(), 'blog-sitemap-')), 'sitemap-blog.xml')
    const first = await seedBlog({ createEditorialAuthor: true, sitemap })
    expect(first).toMatch(/Blog library ready: \d+ created, \d+ updated, 120 published posts, \d+ categories, 15 tags\.\nExpanded library ready: \d+ created, \d+ updated, 247 additional posts; sitemap has \d+ URLs\./)
    expect(await seedBlog({ sitemap })).toMatch(/^Blog library ready: 0 created, 120 updated/)
    expect(readFileSync(sitemap, 'utf8')).toContain('<loc>https://maven-host.com/blog/how-to-choose-a-domain-name-for-a-small-business</loc>')
    const page = (await call('GET', '/blog/?page_size=50')).body
    expect(page.results).toHaveLength(30)
  }, 300_000)
})
