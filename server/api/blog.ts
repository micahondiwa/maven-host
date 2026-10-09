import 'server-only'
import { AllowAny, json, Router, type Context } from '../http/router'
import { HttpError } from '../http/errors'
import { pageParams } from '../http/pagination'
import { f, invalid, validate } from '../http/validation'
import { hasPerm, staffPermission } from '../auth/permissions'
import * as blog from '../blog/service'

/** apps/blog/api/urls.py, mounted at /api/v1/blog/. */

const PUBLIC = { authenticate: false, permissions: [AllowAny] }
const STAFF = { permissions: [staffPermission('view_blog')], throttle: 'staff_management' }

/** `CanManageBlog`, checked inside write handlers after the view permission (as v1 did). */
async function requireManage(ctx: Context) {
  if (!(await hasPerm(ctx.authenticatedUser, 'manage_blog'))) throw new HttpError(403, { detail: 'You do not have permission to manage blog posts.' })
}

const slug = (value: string) => {
  if (value && !/^[-a-zA-Z0-9_]+$/.test(value)) invalid('Enter a valid "slug" consisting of letters, numbers, underscores or hyphens.')
}

const postSchema = {
  title: f.string({ maxLength: 220 }),
  slug: f.string({ maxLength: 240, allowBlank: true, default: '' }).check(slug),
  category_id: f.uuid().nullable().optional(),
  tag_names: f.list(f.string({ maxLength: 80 }), { default: () => [] }),
  excerpt: f.string({ maxLength: 320, allowBlank: true, default: '' }),
  content: f.string(),
  featured_image_url: f.url({ allowBlank: true, default: '' }),
  is_featured: f.boolean({ default: false }),
  status: f.choice(blog.BLOG_POST_STATUSES, { default: 'draft' }),
  seo_title: f.string({ maxLength: 220, allowBlank: true, default: '' }),
  seo_description: f.string({ maxLength: 320, allowBlank: true, default: '' }),
}

async function writePost(ctx: Context, postId: string | null) {
  await requireManage(ctx)
  const data = validate(postSchema, await ctx.body())
  return blog.savePost({ actorId: ctx.authenticatedUser.id, postId, data: { ...data, category_id: data.category_id ?? null } as blog.PostInput, ipAddress: ctx.ip })
}

export const blogRoutes = new Router()
  .get('staff/posts/', (ctx) => {
    const { page, size } = pageParams(ctx.url, { pageSize: 20, maxPageSize: 100 })
    return blog.listStaffPosts(ctx.url, page, size)
  }, STAFF)
  .post('staff/posts/', async (ctx) => json(await writePost(ctx, null), 201), STAFF)
  .post('staff/posts/bulk-status/', async (ctx) => {
    await requireManage(ctx)
    const data = validate({ ids: f.list(f.uuid(), { allowEmpty: false, maxLength: 200 }), status: f.choice(['published', 'archived'] as const) }, await ctx.body())
    return blog.bulkSetStatus(ctx.authenticatedUser.id, data.ids, data.status, ctx.ip)
  }, STAFF)
  .get('staff/posts/<uuid:pk>/', (ctx) => blog.staffPost(ctx.params.pk), STAFF)
  .patch('staff/posts/<uuid:pk>/', (ctx) => writePost(ctx, ctx.params.pk), STAFF)
  .delete('staff/posts/<uuid:pk>/', async (ctx) => {
    await requireManage(ctx)
    await blog.deletePost(ctx.authenticatedUser.id, ctx.params.pk, ctx.ip)
  }, STAFF)
  .get('staff/categories/', () => blog.staffCategories(), STAFF)
  .post('staff/categories/', async (ctx) => {
    await requireManage(ctx)
    const data = validate({ name: f.string({ maxLength: 100 }), description: f.string({ maxLength: 255, allowBlank: true, default: '' }) }, await ctx.body())
    return json(await blog.getOrCreateCategory(data.name, data.description), 201)
  }, STAFF)
  .get('staff/tags/', () => blog.staffTags(), STAFF)
  .post('staff/tags/', async (ctx) => {
    await requireManage(ctx)
    const data = validate({ name: f.string({ maxLength: 80 }) }, await ctx.body())
    return json(await blog.getOrCreateTag(data.name), 201)
  }, STAFF)
  .get('', (ctx) => {
    const { page, size } = pageParams(ctx.url, { pageSize: 10, maxPageSize: 30 })
    return blog.listPublicPosts(ctx.url, page, size)
  }, PUBLIC)
  .get('categories/', () => blog.publicCategories(), PUBLIC)
  .get('tags/', () => blog.publicTags(), PUBLIC)
  .get('<slug:slug>/', (ctx) => blog.publicPost(ctx.params.slug), PUBLIC)
