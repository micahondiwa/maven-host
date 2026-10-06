import { useEffect, useState } from 'react'
import { Link, useSearchParams } from '@/lib/navigation'
import { ArrowRight, Clock, LoaderCircle } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { SectionHeading } from '../components/SectionHeading'
import { ApiError, listBlogCategories, listBlogPosts, type BlogCategory, type BlogPostSummary } from '../lib/api'

import { SEO } from '../components/SEO'
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function BlogListPage() {
  const [posts, setPosts] = useState<BlogPostSummary[]>([])
  const [categories, setCategories] = useState<BlogCategory[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeCategory = searchParams.get('category') || null
  const pageNumber = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = 24
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listBlogCategories().then(setCategories).catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError('')
    listBlogPosts({ category: activeCategory ?? undefined, page: pageNumber, page_size: pageSize })
      .then((page) => {
        setPosts(page.results)
        setTotalCount(page.count)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not load the blog right now.'))
      .finally(() => setLoading(false))
  }, [activeCategory, pageNumber])

  const selectCategory = (category: string | null) => {
    setSearchParams(category ? { category, page: '1' } : { page: '1' })
  }
  const pageUrl = (page: number) => `/blog?${new URLSearchParams({ ...(activeCategory ? { category: activeCategory } : {}), page: String(page) }).toString()}`
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))

  const featured = !activeCategory ? posts.find((p) => p.is_featured) : undefined
  const rest = featured ? posts.filter((p) => p.id !== featured.id) : posts

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader dark />
      <SEO title="Software Development, AI, Domains & Hosting Guides | MavenHost Blogs" description="Explore practical guides on web and mobile development, AI-assisted coding, programming stacks, domains, hosting, security and technical SEO." path="/blog" />

      <section className="border-b border-maven-line bg-white py-16">
        <div className="container-shell">
          <SectionHeading kicker="Blog & technical library" title="Blogs for choosing, building and operating your website." description="Browse published guides on domains, DNS, business email and application development. Filter by topic, and check each guide’s official documentation links for version-specific details." />
          <div className="mt-8 flex flex-wrap gap-2">
            <button
              aria-pressed={!activeCategory} onClick={() => selectCategory(null)}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition ${!activeCategory ? 'bg-maven-ink text-white' : 'border border-maven-line text-maven-muted hover:text-maven-ink'}`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.slug}
                aria-pressed={activeCategory === cat.slug} onClick={() => selectCategory(cat.slug)}
                className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition ${activeCategory === cat.slug ? 'bg-maven-ink text-white' : 'border border-maven-line text-maven-muted hover:text-maven-ink'}`}
              >
                {cat.name} <span className="mono text-[11px] opacity-60">{cat.post_count}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <main id="main-content" className="container-shell py-14">
        {loading && (
          <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading Blogs…</div>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}

        {!loading && !error && posts.length === 0 && (
          <div className="panel border-dashed p-12 text-center">
            <p className="mono text-sm text-maven-muted">blog / empty</p>
            <p className="mt-3 font-semibold text-maven-ink">No posts in this category yet.</p>
          </div>
        )}

        {featured && (
          <Link to={`/blog/${featured.slug}`} className="panel-raised mb-10 flex flex-col gap-4 p-7 transition hover:border-maven-signal/40 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="chip bg-black/5 text-maven-ink">{featured.category?.name ?? 'Featured'}</span>
              <h2 className="mt-3 text-[1.6rem] font-semibold tracking-tight text-maven-ink">{featured.title}</h2>
              <p className="mt-2 max-w-2xl text-[15px] leading-6 text-maven-muted">{featured.excerpt}</p>
              <p className="mono mt-3 flex items-center gap-3 text-[12px] text-maven-muted">
                By {featured.author} <span aria-hidden="true">·</span> {formatDate(featured.published_at)} <Clock className="size-3.5" /> {featured.reading_time_minutes} min read
              </p>
            </div>
            <ArrowRight className="size-5 shrink-0 text-maven-signal" />
          </Link>
        )}

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((post) => (
            <Link key={post.id} to={`/blog/${post.slug}`} className="panel flex flex-col p-6 transition hover:border-maven-signal/40">
              {post.category && <span className="mono text-[11px] font-medium text-maven-muted">{post.category.name.toLowerCase()}</span>}
              <h3 className="mt-2 text-[16px] font-semibold leading-snug text-maven-ink">{post.title}</h3>
              <p className="mt-2 flex-1 text-[13.5px] leading-6 text-maven-muted">{post.excerpt}</p>
              <p className="mono mt-4 flex items-center gap-3 text-[11.5px] text-maven-muted">
                By {post.author} <span aria-hidden="true">·</span> {formatDate(post.published_at)} <Clock className="size-3.5" /> {post.reading_time_minutes} min
              </p>
            </Link>
          ))}
        </div>

        {!loading && !error && pageCount > 1 && (
          <nav aria-label="Blog pages" className="mt-10 flex flex-wrap items-center justify-center gap-2">
            <button type="button" disabled={pageNumber <= 1} onClick={() => setSearchParams({ ...(activeCategory ? { category: activeCategory } : {}), page: String(pageNumber - 1) })} className="rounded-lg border border-maven-line px-3 py-2 text-sm font-semibold text-maven-ink disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <Link key={page} to={pageUrl(page)} aria-current={page === pageNumber ? 'page' : undefined} className={`rounded-lg px-3 py-2 text-sm font-semibold ${page === pageNumber ? 'bg-maven-ink text-white' : 'border border-maven-line text-maven-ink hover:border-maven-signal'}`}>{page}</Link>
            ))}
            <button type="button" disabled={pageNumber >= pageCount} onClick={() => setSearchParams({ ...(activeCategory ? { category: activeCategory } : {}), page: String(pageNumber + 1) })} className="rounded-lg border border-maven-line px-3 py-2 text-sm font-semibold text-maven-ink disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </nav>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
