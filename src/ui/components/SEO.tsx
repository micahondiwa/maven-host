import { useEffect } from 'react'
import { SOCIAL_LINKS } from '../lib/site'

type SEOProps = {
  title: string
  description: string
  path?: string
  type?: 'website' | 'article'
  image?: string
  publishedAt?: string
  modifiedAt?: string
  author?: { name: string; sameAs: string[]; type?: 'Person' | 'Organization' }
  indexable?: boolean
}

const SITE = 'https://maven-host.com'
const DEFAULT_IMAGE = `${SITE}/brand/mavenhost-logo-reversed-on-dark.png?v=inara-20261004`

function upsertMeta(selector: string, attrs: Record<string, string>, content: string) {
  let el = document.head.querySelector(selector) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    Object.entries(attrs).forEach(([key, value]) => el!.setAttribute(key, value))
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

export function SEO({ title, description, path = '/', type = 'website', image = DEFAULT_IMAGE, publishedAt, modifiedAt, author, indexable = true }: SEOProps) {
  useEffect(() => {
    const canonical = `${SITE}${path === '/' ? '/' : path.replace(/\/$/, '')}`
    document.title = 'MavenHost'
    upsertMeta('meta[name="description"]', { name: 'description' }, description)
    upsertMeta('meta[name="robots"]', { name: 'robots' }, indexable ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' : 'noindex,nofollow,noarchive')
    upsertMeta('meta[property="og:title"]', { property: 'og:title' }, title)
    upsertMeta('meta[property="og:description"]', { property: 'og:description' }, description)
    upsertMeta('meta[property="og:type"]', { property: 'og:type' }, type)
    upsertMeta('meta[property="og:url"]', { property: 'og:url' }, canonical)
    upsertMeta('meta[property="og:image"]', { property: 'og:image' }, image)
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image')
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, title)
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, description)
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, image)
    upsertLink('canonical', canonical)

    const existing = document.getElementById('maven-seo-jsonld')
    existing?.remove()
    const script = document.createElement('script')
    script.id = 'maven-seo-jsonld'
    script.type = 'application/ld+json'
    const base: Record<string, unknown> = type === 'article'
      ? {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: title,
          description,
          url: canonical,
          image: [image],
          publisher: { '@type': 'Organization', name: 'MavenHost', url: SITE, logo: { '@type': 'ImageObject', url: DEFAULT_IMAGE } },
          ...(author ? { author: { '@type': author.type ?? 'Person', name: author.name, ...(author.sameAs.length ? { sameAs: author.sameAs } : {}) } } : {}),
          ...(publishedAt ? { datePublished: publishedAt } : {}),
          ...(modifiedAt ? { dateModified: modifiedAt } : {}),
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'MavenHost',
          url: SITE,
          logo: DEFAULT_IMAGE,
          email: 'info@maven-host.com',
          sameAs: SOCIAL_LINKS.map((link) => link.href),
        }
    script.textContent = JSON.stringify(base)
    document.head.appendChild(script)
    return () => { document.getElementById('maven-seo-jsonld')?.remove() }
  }, [title, description, path, type, image, publishedAt, modifiedAt, author, indexable])

  return null
}
