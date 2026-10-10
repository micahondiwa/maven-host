import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from '@/lib/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Loader2, Plus, Search } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import {
  bulkPostStatus, createStaffCategory, createStaffPost, deleteStaffPost, getStaffPost, listStaffCategories, listStaffPosts, updateStaffPost,
  type StaffBlogCategory, type StaffBlogPost, type StaffBlogPostInput, type StaffBlogStatus,
} from '../../lib/blog-admin-api'

/** Staff blog editor (replaces the v1 Django admin for blog posts). Content is sanitised by the server on save. */

const card = 'rounded-2xl bg-white ring-1 ring-slate-200'
const errorMessage = (error: unknown, fallback: string) => (error instanceof ApiError ? Object.values(error.fieldErrors ?? {}).flat()[0] || error.message : fallback)
const STATUS_TONE: Record<StaffBlogStatus, string> = { draft: 'bg-amber-50 text-amber-700', published: 'bg-emerald-50 text-emerald-700', archived: 'bg-slate-100 text-slate-600' }
const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

export function StaffBlogListPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_blog')
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<Awaited<ReturnType<typeof listStaffPosts>> | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState(params.get('search') ?? '')
  const query = params.toString()

  const load = useCallback(() => {
    setError('')
    listStaffPosts(Object.fromEntries(new URLSearchParams(query))).then((result) => { setData(result); setSelected([]) }).catch((err) => setError(errorMessage(err, 'Unable to load posts.')))
  }, [query])
  useEffect(load, [load])

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }
  async function bulk(status: 'published' | 'archived') {
    setError(''); setNotice('')
    try { const result = await bulkPostStatus(selected, status); setNotice(`${result.updated} post${result.updated === 1 ? '' : 's'} ${status}.`); load() }
    catch (err) { setError(errorMessage(err, 'The update could not be applied.')) }
  }
  const page = Number(params.get('page') ?? '1')
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maven-blue">Content</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Blog</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-maven-muted">Write, publish and archive articles. Publishing sets the publication date; changes are audit-logged.</p></div>
      {canManage && <Link to="/staff/blog/new" className="btn btn-primary"><Plus className="size-4" /> New post</Link>}
    </div>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); update({ search }) }} className={`${card} grid gap-4 p-4 sm:grid-cols-[1fr_12rem]`}>
      <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Search titles<div className="mt-1 flex gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} className="field normal-case" /><button type="submit" className="btn btn-secondary" aria-label="Search"><Search className="size-4" /></button></div></label>
      <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Status<select value={params.get('status') ?? ''} onChange={(event) => update({ status: event.target.value })} className="field mt-1 normal-case"><option value="">All</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
    </form>
    {error && <div role="alert" className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">{notice}</div>}
    {canManage && selected.length > 0 && <div className="flex flex-wrap items-center gap-3 text-sm"><span className="font-semibold">{selected.length} selected</span><button type="button" onClick={() => bulk('published')} className="btn btn-secondary">Publish</button><button type="button" onClick={() => bulk('archived')} className="btn btn-secondary">Archive</button></div>}
    {!data && !error ? <Loader2 className="size-6 animate-spin text-maven-blue" /> : data && <>
      <div className={`${card} overflow-hidden`}><div className="overflow-x-auto"><table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr>{canManage && <th className="px-4 py-4"><span className="sr-only">Select</span></th>}<th className="px-5 py-4">Title</th><th className="px-5 py-4">Category</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Published</th><th className="px-5 py-4">Updated</th><th className="px-5 py-4" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.results.map((post: StaffBlogPost) => <tr key={post.id} className="hover:bg-slate-50/80">
          {canManage && <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${post.title}`} checked={selected.includes(post.id)} onChange={() => toggle(post.id)} className="size-4 accent-maven-signal" /></td>}
          <td className="px-5 py-3"><p className="font-bold text-maven-navy">{post.title}</p><p className="text-xs text-slate-500">/{post.slug}</p></td>
          <td className="px-5 py-3 text-slate-600">{post.category?.name ?? '—'}</td>
          <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${STATUS_TONE[post.status]}`}>{post.status}</span>{post.is_featured && <span className="ml-2 text-xs font-semibold text-maven-blue">Featured</span>}</td>
          <td className="px-5 py-3 text-slate-600">{date(post.published_at)}</td>
          <td className="px-5 py-3 text-slate-600">{date(post.updated_at)}</td>
          <td className="px-5 py-3 text-right"><Link to={`/staff/blog/${post.id}`} className="font-bold text-maven-blue hover:underline">{canManage ? 'Edit' : 'View'}</Link></td>
        </tr>)}</tbody>
      </table></div>{data.results.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No posts match.</p>}</div>
      <div className="flex items-center justify-between text-sm text-slate-500"><span>{data.count} post{data.count === 1 ? '' : 's'}</span><div className="flex gap-2"><button type="button" disabled={!data.previous} onClick={() => update({ page: String(page - 1) })} className="btn btn-secondary disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="size-4" /></button><button type="button" disabled={!data.next} onClick={() => update({ page: String(page + 1) })} className="btn btn-secondary disabled:opacity-40" aria-label="Next page"><ChevronRight className="size-4" /></button></div></div>
    </>}
  </div>
}

const EMPTY: StaffBlogPostInput = { title: '', slug: '', category_id: null, tag_names: [], excerpt: '', content: '', featured_image_url: '', is_featured: false, status: 'draft', seo_title: '', seo_description: '' }

function Counter({ value, limit }: { value: string; limit: number }) {
  return <span className={`text-xs ${value.length > limit ? 'font-bold text-red-700' : 'text-slate-500'}`}>{value.length}/{limit}</span>
}

export function StaffBlogEditorPage() {
  const { id = '' } = useParams<{ id: string }>()
  const creating = id === 'new'
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_blog')
  const [form, setForm] = useState<StaffBlogPostInput>(EMPTY)
  const [tags, setTags] = useState('')
  const [meta, setMeta] = useState<{ slug: string; published_at: string | null; status: StaffBlogStatus } | null>(null)
  const [categories, setCategories] = useState<StaffBlogCategory[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [loading, setLoading] = useState(!creating)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { listStaffCategories().then(setCategories).catch(() => setCategories([])) }, [])
  useEffect(() => {
    if (creating) return
    getStaffPost(id).then((post) => {
      setForm({ title: post.title, slug: post.slug, category_id: post.category?.id ?? null, tag_names: post.tags.map((tag) => tag.name), excerpt: post.excerpt, content: post.content, featured_image_url: post.featured_image_url, is_featured: post.is_featured, status: post.status, seo_title: post.seo_title, seo_description: post.seo_description })
      setTags(post.tags.map((tag) => tag.name).join(', '))
      setMeta({ slug: post.slug, published_at: post.published_at, status: post.status })
    }).catch((err) => setError(errorMessage(err, 'Unable to load this post.'))).finally(() => setLoading(false))
  }, [id, creating])

  const set = <K extends keyof StaffBlogPostInput>(key: K, value: StaffBlogPostInput[K]) => setForm((current) => ({ ...current, [key]: value }))

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setErrors({}); setError(''); setNotice('')
    const input = { ...form, tag_names: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }
    try {
      const saved = creating ? await createStaffPost(input) : await updateStaffPost(id, input)
      if (creating) { navigate(`/staff/blog/${saved.id}`, { replace: true }); return }
      setForm((current) => ({ ...current, slug: saved.slug, content: saved.content, excerpt: saved.excerpt }))
      setMeta({ slug: saved.slug, published_at: saved.published_at, status: saved.status })
      setNotice(saved.status === 'published' ? 'Saved and published.' : 'Saved.')
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors)
      setError(errorMessage(err, 'The post could not be saved.'))
    } finally { setSaving(false) }
  }

  async function addCategory() {
    if (!newCategory.trim()) return
    try { const category = await createStaffCategory(newCategory.trim()); setCategories((current) => [...current.filter((item) => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name))); set('category_id', category.id); setNewCategory('') }
    catch (err) { setError(errorMessage(err, 'The category could not be created.')) }
  }

  async function remove() {
    if (!window.confirm('Delete this post permanently? Archive it instead to keep it.')) return
    try { await deleteStaffPost(id); navigate('/staff/blog', { replace: true }) } catch (err) { setError(errorMessage(err, 'The post could not be deleted.')) }
  }

  if (loading) return <Loader2 className="size-6 animate-spin text-maven-blue" />
  const fieldError = (name: string) => errors[name] && <p role="alert" className="mt-1 text-xs font-semibold text-red-700">{errors[name].join(' ')}</p>
  const disabled = !canManage

  return <form onSubmit={save} className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><Link to="/staff/blog" className="inline-flex items-center gap-2 text-sm font-bold text-maven-blue"><ArrowLeft className="size-4" /> Blog</Link><h1 className="mt-3 text-2xl font-black tracking-[-0.03em]">{creating ? 'New post' : form.title || 'Untitled post'}</h1>{meta && <p className="mt-1 text-sm text-slate-500">Status: <span className="font-semibold capitalize">{meta.status}</span>{meta.published_at ? ` · published ${date(meta.published_at)}` : ''}</p>}</div>
      <div className="flex flex-wrap gap-2">
        {meta?.status === 'published' && <a href={`/blog/${meta.slug}`} target="_blank" rel="noreferrer" className="btn btn-secondary"><ExternalLink className="size-4" /> View live</a>}
        {!creating && canManage && <button type="button" onClick={remove} className="btn btn-secondary text-red-700">Delete</button>}
        {canManage && <button type="submit" disabled={saving} className="btn btn-primary">{saving ? <Loader2 className="size-4 animate-spin" /> : null}{creating ? 'Create post' : 'Save'}</button>}
      </div>
    </div>
    {error && <div role="alert" className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">{notice}</div>}
    <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
      <section className={`${card} space-y-5 p-6`}>
        <label className="block text-sm font-semibold text-slate-700">Title<input required maxLength={220} disabled={disabled} value={form.title} onChange={(event) => set('title', event.target.value)} className="field mt-1.5" />{fieldError('title')}</label>
        <label className="block text-sm font-semibold text-slate-700">Slug<input maxLength={240} disabled={disabled} value={form.slug} onChange={(event) => set('slug', event.target.value)} className="field mt-1.5" placeholder="Generated from the title when empty" />{fieldError('slug')}</label>
        <label className="block text-sm font-semibold text-slate-700"><span className="flex justify-between">Excerpt <Counter value={form.excerpt} limit={320} /></span><textarea rows={2} disabled={disabled} value={form.excerpt} onChange={(event) => set('excerpt', event.target.value)} className="field mt-1.5" placeholder="Taken from the content when empty" />{fieldError('excerpt')}</label>
        <div>
          <div className="flex items-center justify-between"><label htmlFor="blog-content" className="text-sm font-semibold text-slate-700">Content (HTML)</label><button type="button" onClick={() => setPreview((value) => !value)} className="text-xs font-bold text-maven-blue">{preview ? 'Edit' : 'Preview'}</button></div>
          {preview
            // Unsaved content has not been sanitised yet, so it renders in a sandbox where scripts cannot run.
            ? <iframe title="Content preview" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:15px/1.6 system-ui,sans-serif;color:#0f172a;margin:16px;max-width:72ch}img{max-width:100%}pre{background:#f1f5f9;padding:12px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}</style>${form.content}`} className="mt-1.5 h-[32rem] w-full rounded-xl border border-slate-200 bg-white" />
            : <textarea id="blog-content" required rows={18} disabled={disabled} spellCheck value={form.content} onChange={(event) => set('content', event.target.value)} className="field mt-1.5 font-mono text-xs" />}
          <p className="mt-1 text-xs text-slate-500">Allowed: headings (h2–h4), paragraphs, lists, links, images, quotes, code, tables. Scripts, styles and embeds are removed when saved; the preview shows the saved version after saving.</p>
          {fieldError('content')}
        </div>
      </section>
      <aside className="space-y-6">
        <section className={`${card} space-y-4 p-5`}>
          <label className="block text-sm font-semibold text-slate-700">Status<select disabled={disabled} value={form.status} onChange={(event) => set('status', event.target.value as StaffBlogStatus)} className="field mt-1.5"><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" disabled={disabled} checked={form.is_featured} onChange={(event) => set('is_featured', event.target.checked)} className="size-4 accent-maven-signal" /> Featured</label>
          <label className="block text-sm font-semibold text-slate-700">Category<select disabled={disabled} value={form.category_id ?? ''} onChange={(event) => set('category_id', event.target.value || null)} className="field mt-1.5"><option value="">None</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{fieldError('category_id')}</label>
          {canManage && <div className="flex gap-2"><input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={100} className="field" placeholder="New category" aria-label="New category name" /><button type="button" onClick={addCategory} className="btn btn-secondary">Add</button></div>}
          <label className="block text-sm font-semibold text-slate-700">Tags<input disabled={disabled} value={tags} onChange={(event) => setTags(event.target.value)} className="field mt-1.5" placeholder="dns, hosting, kenya" /><span className="mt-1 block text-xs font-normal text-slate-500">Comma-separated; new tags are created automatically.</span>{fieldError('tag_names')}</label>
          <label className="block text-sm font-semibold text-slate-700">Featured image URL<input type="url" disabled={disabled} value={form.featured_image_url} onChange={(event) => set('featured_image_url', event.target.value)} className="field mt-1.5" />{fieldError('featured_image_url')}</label>
        </section>
        <section className={`${card} space-y-4 p-5`}>
          <h2 className="text-sm font-black text-maven-navy">Search engines</h2>
          <label className="block text-sm font-semibold text-slate-700"><span className="flex justify-between">SEO title <Counter value={form.seo_title} limit={60} /></span><input maxLength={220} disabled={disabled} value={form.seo_title} onChange={(event) => set('seo_title', event.target.value)} className="field mt-1.5" placeholder="Defaults to the title" /></label>
          <label className="block text-sm font-semibold text-slate-700"><span className="flex justify-between">Meta description <Counter value={form.seo_description} limit={160} /></span><textarea rows={3} maxLength={320} disabled={disabled} value={form.seo_description} onChange={(event) => set('seo_description', event.target.value)} className="field mt-1.5" /></label>
          <p className="text-xs text-slate-500">Counters show the length most search results display.</p>
        </section>
      </aside>
    </div>
  </form>
}
