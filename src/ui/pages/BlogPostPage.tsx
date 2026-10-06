import { useEffect, useState } from 'react'
import { Link, useParams } from '@/lib/navigation'
import { ArrowLeft, Clock, LoaderCircle } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SEO } from '../components/SEO'
import { SiteFooter } from '../components/SiteFooter'
import { ApiError, getBlogPost, type BlogPostDetail } from '../lib/api'
import { getBlogAuthor } from '../lib/author'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export function BlogPostPage() {
  const { slug = '' } = useParams()
  const [post, setPost] = useState<BlogPostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    getBlogPost(slug)
      .then(setPost)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'We could not find this post.'))
      .finally(() => setLoading(false))
  }, [slug])

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader />
      <main id="main-content" className="container-shell max-w-3xl section-space">
        <Link to="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-maven-signal"><ArrowLeft className="size-4" /> Back to Blogs</Link>

        {loading && <div className="mt-10 flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading article…</div>}
        {error && <p role="alert" className="mt-8 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}

        {post && (() => {
          const author = getBlogAuthor(post.category?.slug)
          return (
          <>
            <SEO title={`${post.seo_title || post.title} | MavenHost`} description={post.seo_description || post.excerpt} path={`/blog/${post.slug}`} type="article" publishedAt={post.published_at} modifiedAt={post.updated_at} author={{ name: author.name, sameAs: author.profiles.map((profile) => profile.href), type: author.type }} />
            <article>
            {post.category && <span className="chip bg-black/5 text-maven-ink mt-6">{post.category.name}</span>}
            <h1 className="mt-4 text-[2rem] font-semibold leading-snug tracking-tight text-maven-ink">{post.title}</h1>
            <p className="mono mt-3 flex items-center gap-3 text-[13px] text-maven-muted">
              By {author.name} · {formatDate(post.published_at)} <Clock className="size-3.5" /> {post.reading_time_minutes} min read
            </p>

            <div
              className="prose-content mt-8 text-[15.5px] leading-7 text-maven-ink"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            <section aria-labelledby="blog-author-title" className="panel mt-10 p-5 sm:p-6">
              <p className="mono text-[11px] font-semibold uppercase tracking-wider text-maven-muted">About the {author.type === 'Person' ? 'author' : 'publisher'}</p>
              <h2 id="blog-author-title" className="mt-1 text-lg font-semibold text-maven-ink">{author.name}</h2>
              <p className="mt-1 text-sm leading-6 text-maven-muted">{author.description}</p>
              {author.profiles.length > 0 && <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
                {author.profiles.map((profile) => <li key={profile.label}><a href={profile.href} target="_blank" rel="noreferrer" className="text-maven-signal hover:underline">{profile.label}<span className="sr-only"> (opens in a new tab)</span></a></li>)}
              </ul>}
            </section>

            {post.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-2 border-t border-maven-line pt-6">
                {post.tags.map((tag) => (
                  <span key={tag.slug} className="mono rounded-md bg-black/5 px-2.5 py-1 text-[11.5px] text-maven-muted">#{tag.slug}</span>
                ))}
              </div>
            )}
            </article>
          </>
          )
        })()}
      </main>
      <SiteFooter />
    </div>
  )
}
