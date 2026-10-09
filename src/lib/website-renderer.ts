/**
 * Deterministic HTML rendering of structured MavenHost website content. The same function produces the editor's
 * live preview and the files deployed for trials and hosting publication, so customers publish what they preview.
 * All text is HTML-escaped; only http(s), relative and in-page links are emitted; no scripts are generated.
 */

export type RenderSectionItem = { title?: string; description?: string; question?: string; answer?: string; image_url?: string; alt?: string; name?: string; quote?: string; author?: string; url?: string; caption?: string }
export type RenderSection = { type: string; heading?: string; subheading?: string; body?: string; cta?: string; cta_url?: string; items?: RenderSectionItem[]; text?: string; label?: string; url?: string }
export type RenderPage = { slug: string; title: string; seo_title?: string; seo_description?: string; content?: { sections?: RenderSection[] } | null }
export type RenderWebsite = { name: string }

export const SECTION_TYPES = ['hero', 'about', 'services', 'testimonials', 'contact', 'faq', 'gallery', 'cta', 'footer'] as const

const DEFAULT_HEADINGS: Record<string, string> = { about: 'About', services: 'Services', testimonials: 'Testimonials', contact: 'Contact', faq: 'FAQ', gallery: 'Gallery' }

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

export function safeHref(value: unknown, fallback = '#contact'): string {
  const url = String(value ?? '').trim()
  return /^(https?:\/\/|\/(?!\/)|#)/i.test(url) ? url : fallback
}

const isImageUrl = (value: unknown) => /^(https?:\/\/|\/(?!\/))/i.test(String(value ?? '').trim())

export function pageFilename(slug: string) {
  return slug === 'home' || slug === 'index' ? 'index.html' : `${slug}.html`
}

const paragraph = (value: unknown) => {
  const text = String(value ?? '').trim()
  return text ? `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` : ''
}

function button(section: RenderSection, className = 'button') {
  const label = section.cta ?? section.label
  if (!label?.trim()) return ''
  return `<a class="${className}" href="${escapeHtml(safeHref(section.cta_url ?? section.url))}">${escapeHtml(label)}</a>`
}

function heading(section: RenderSection, level: 'h1' | 'h2') {
  const text = section.heading?.trim() || DEFAULT_HEADINGS[section.type] || ''
  return text ? `<${level}>${escapeHtml(text)}</${level}>` : ''
}

function intro(section: RenderSection) {
  return `${heading(section, 'h2')}${section.subheading?.trim() ? `<p class="lead">${escapeHtml(section.subheading)}</p>` : ''}${paragraph(section.body ?? section.text)}`
}

function items(section: RenderSection) {
  return (section.items ?? []).filter((item) => item && typeof item === 'object')
}

function image(item: RenderSectionItem) {
  const src = item.image_url ?? item.url
  return isImageUrl(src) ? `<img src="${escapeHtml(String(src).trim())}" alt="${escapeHtml(item.alt ?? '')}" loading="lazy">` : ''
}

export function renderSection(section: RenderSection): string {
  switch (section.type) {
    case 'hero':
      return `<section class="hero">${heading(section, 'h1')}${section.subheading?.trim() ? `<p class="lead">${escapeHtml(section.subheading)}</p>` : ''}${paragraph(section.body ?? section.text)}${button(section)}</section>`
    case 'about':
    case 'contact':
      return `<section id="${section.type}">${intro(section)}${button(section, 'button secondary')}</section>`
    case 'services':
      return `<section id="services">${intro(section)}<div class="cards">${items(section).map((item) => `<article class="card">${image(item)}<h3>${escapeHtml(item.title ?? item.name ?? '')}</h3>${paragraph(item.description)}</article>`).join('')}</div>${button(section, 'button secondary')}</section>`
    case 'testimonials':
      return `<section id="testimonials">${intro(section)}<div class="cards">${items(section).map((item) => `<blockquote class="card">${paragraph(item.quote ?? item.description)}<footer>${escapeHtml(item.author ?? item.title ?? '')}</footer></blockquote>`).join('')}</div></section>`
    case 'faq':
      return `<section id="faq">${intro(section)}${items(section).map((item) => `<details><summary>${escapeHtml(item.question ?? item.title ?? '')}</summary>${paragraph(item.answer ?? item.description)}</details>`).join('')}</section>`
    case 'gallery':
      return `<section id="gallery">${intro(section)}<div class="gallery">${items(section).filter((item) => isImageUrl(item.image_url ?? item.url)).map((item) => `<figure>${image(item)}<figcaption>${escapeHtml(item.caption ?? item.title ?? '')}</figcaption></figure>`).join('')}</div></section>`
    case 'cta':
      return `<section class="cta">${intro(section)}${button(section)}</section>`
    case 'footer':
      return `<footer class="site-footer">${paragraph(section.body ?? section.text)}</footer>`
    default:
      throw new Error(`Unsupported website section type: ${JSON.stringify(section.type)}`)
  }
}

const STYLES = `*{box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6;margin:0;color:#172033;background:#fff}
header.site-header{border-bottom:1px solid #e5e9f0;background:#fff}header .inner,main,footer.site-footer{max-width:1040px;margin:auto;padding:0 1.25rem}
header .inner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;padding-top:1rem;padding-bottom:1rem}
.brand{font-weight:700;font-size:1.15rem;color:#0b4c72;text-decoration:none}nav{display:flex;gap:1rem;flex-wrap:wrap}nav a,nav span{color:#33465c;text-decoration:none;font-size:.95rem}nav [aria-current]{color:#0b4c72;font-weight:600}
section{padding:3rem 0;border-bottom:1px solid #f0f2f6}.hero{padding:5rem 0}.hero h1{font-size:clamp(2rem,5vw,3.2rem);line-height:1.15;margin:0 0 1rem;color:#0b2338}
h2{font-size:1.7rem;margin:0 0 .75rem;color:#0b2338}h3{margin:.5rem 0 .25rem}.lead{font-size:1.15rem;color:#4a5b70}
.button{display:inline-block;margin-top:1rem;padding:.8rem 1.3rem;border-radius:.5rem;background:#0c6898;color:#fff;text-decoration:none;font-weight:600}.button.secondary{background:#e8f2f8;color:#0c6898}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;margin-top:1.5rem}.card{border:1px solid #e5e9f0;border-radius:.75rem;padding:1.25rem;margin:0}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem}figure{margin:0}img{max-width:100%;height:auto;border-radius:.5rem}
details{border:1px solid #e5e9f0;border-radius:.5rem;padding:.75rem 1rem;margin:.5rem 0}summary{font-weight:600;cursor:pointer}.cta{text-align:center;background:#f4f8fb;border-radius:1rem;padding:3rem 1.5rem;margin:2rem 0}
footer.site-footer{padding-top:2rem;padding-bottom:2rem;color:#66758a;font-size:.9rem}blockquote footer{font-weight:600;color:#33465c}`

/**
 * Renders a full HTML document. `mode: 'preview'` renders navigation without live links so a sandboxed preview frame
 * never navigates away from the editor.
 */
export function renderPageDocument(website: RenderWebsite, page: RenderPage, pages: RenderPage[], options: { mode?: 'static' | 'preview' } = {}): string {
  const sections = (page.content?.sections ?? []).map(renderSection).join('')
  const navigation = pages
    .map((candidate) => {
      const current = candidate.slug === page.slug ? ' aria-current="page"' : ''
      if (options.mode === 'preview') return `<span${current}>${escapeHtml(candidate.title)}</span>`
      const href = pageFilename(candidate.slug) === 'index.html' ? '/' : `/${pageFilename(candidate.slug)}`
      return `<a href="${escapeHtml(href)}"${current}>${escapeHtml(candidate.title)}</a>`
    })
    .join('')
  const title = page.seo_title || page.title || website.name
  const description = page.seo_description || `${website.name} — powered by MavenHost.`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<style>${STYLES}</style>
</head><body><header class="site-header"><div class="inner"><a class="brand" href="${options.mode === 'preview' ? '#' : '/'}">${escapeHtml(website.name)}</a><nav aria-label="Main navigation">${navigation}</nav></div></header><main>${sections}</main></body></html>`
}

export type RenderedFile = { name: string; content: string; contentType: string }

/** Renders every page into static files (`index.html` for the home page). */
export function renderWebsiteFiles(website: RenderWebsite, pages: RenderPage[]): RenderedFile[] {
  if (!pages.length) throw new Error('At least one published website page is required before publication.')
  return pages.map((page) => ({ name: pageFilename(page.slug), content: renderPageDocument(website, page, pages), contentType: 'text/html; charset=utf-8' }))
}
