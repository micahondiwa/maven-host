import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from '@/lib/navigation'
import { WebsiteDraftEditor } from '../components/WebsiteDraftEditor'
import { ArrowRight, Check, CircleAlert, LoaderCircle, WandSparkles } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { SEO } from '../components/SEO'
import { ApiError, analyzeWebsiteSEO, claimPublicWebsiteGeneration, generatePublicWebsite, type ClaimedWebsite, type PublicWebsiteGeneration, type SEOAnalysis } from '../lib/api'
import { useAuth } from '../lib/auth'
const TOKEN_KEY = 'maven_ai_visitor_token'
const GENERATION_KEY = 'maven_ai_generation'
const WEBSITE_KEY = 'maven_ai_claimed_website'
const ANALYSIS_KEY = 'maven_ai_seo_analysis'

function readSession<T>(key: string): T | null {
  try {
    const value = sessionStorage.getItem(key)
    return value ? JSON.parse(value) as T : null
  } catch {
    return null
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export function AIBuilderPage() {
  const { user } = useAuth()
  const location = useLocation()
  const [brief, setBrief] = useState<string>(() => location.state?.brief ?? '')
  const [generation, setGeneration] = useState<PublicWebsiteGeneration | null>(() => readSession(GENERATION_KEY))
  const [website, setWebsite] = useState<ClaimedWebsite | null>(() => readSession(WEBSITE_KEY))
  const [analysis, setAnalysis] = useState<SEOAnalysis | null>(() => readSession(ANALYSIS_KEY))
  const [busy, setBusy] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimRetry, setClaimRetry] = useState(0)
  const [error, setError] = useState('')
  const claimInProgress = useRef(false)

  useEffect(() => {
    const token = sessionStorage.getItem(TOKEN_KEY)
    if (!user || !generation || website || !token || claimInProgress.current) return

    claimInProgress.current = true
    setClaiming(true)
    setError('')
    claimPublicWebsiteGeneration(generation.id, token)
      .then((savedWebsite) => {
        sessionStorage.setItem(WEBSITE_KEY, JSON.stringify(savedWebsite))
        sessionStorage.removeItem(ANALYSIS_KEY)
        setWebsite(savedWebsite)
        setAnalysis(null)
      })
      .catch((err: unknown) => setError(errorMessage(err, 'We could not save this draft. Please try again.')))
      .finally(() => {
        claimInProgress.current = false
        setClaiming(false)
      })
  }, [user, generation, website, claimRetry])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (brief.trim().length < 20) {
      setError('Describe your business in at least 20 characters so the builder has enough detail.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await generatePublicWebsite(brief.trim(), sessionStorage.getItem(TOKEN_KEY) ?? undefined)
      sessionStorage.setItem(TOKEN_KEY, result.visitor_token)
      sessionStorage.setItem(GENERATION_KEY, JSON.stringify(result))
      sessionStorage.removeItem(WEBSITE_KEY)
      sessionStorage.removeItem(ANALYSIS_KEY)
      setGeneration(result)
      setWebsite(null)
      setAnalysis(null)
    } catch (err) {
      setError(errorMessage(err, 'We could not generate a draft. Please try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  async function runSEOAnalysis() {
    if (!website) return
    setBusy(true)
    setError('')
    try {
      const result = await analyzeWebsiteSEO(website.id)
      sessionStorage.setItem(ANALYSIS_KEY, JSON.stringify(result))
      setAnalysis(result)
    } catch (err) {
      setError(errorMessage(err, 'We could not analyze this draft. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader dark />
      <SEO title="AI Website Builder for Kenyan Businesses | MavenHost" description="Describe your business and generate a structured AI website draft with pages, copy and SEO metadata. Save your draft to a MavenHost account." path="/ai-builder" />

      <section className="hero-neutral py-16 text-maven-text sm:py-20">
        <div className="container-shell">
          <span className="chip">AI website builder</span>
          <h1 className="mt-5 max-w-3xl text-[2.5rem] font-semibold leading-tight tracking-tight sm:text-[3.25rem]">Draft your website before committing to a build.</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-7 text-maven-muted">Describe your business, audience and the action visitors should take. Review the generated pages, copy and metadata before saving. A draft is not a deployed website or a purchased hosting service.</p>
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-maven-muted">
            <span className="inline-flex items-center gap-2"><Check className="size-4 text-maven-signal" /> One free anonymous draft per day</span>
            <span className="inline-flex items-center gap-2"><Check className="size-4 text-maven-signal" /> Review pages and SEO fields</span>
            <span className="inline-flex items-center gap-2"><Check className="size-4 text-maven-signal" /> Sign in to save the draft</span>
          </div>
          <Link to="/contact?type=developer" className="btn btn-primary mt-7">Request help from our developers <ArrowRight className="size-4" /></Link>
        </div>
      </section>

      <main id="main-content" className="container-shell grid gap-8 py-12 lg:grid-cols-[0.85fr_1.15fr] lg:py-16">
        <section className="panel h-fit p-6 sm:p-8" aria-labelledby="builder-form-title">
          <p className="mono text-xs font-semibold uppercase tracking-wider text-maven-signal">Start with a clear brief</p>
          <h2 id="builder-form-title" className="mt-2 text-2xl font-semibold tracking-tight text-maven-ink">What should your website do?</h2>
          <p className="mt-2 text-sm leading-6 text-maven-muted">Include your business name, services, location, audience and preferred next step. Avoid adding passwords or private customer information.</p>
          <form onSubmit={submit} className="mt-6">
            <label htmlFor="ai-website-brief" className="label">Business brief</label>
            <textarea id="ai-website-brief" required minLength={20} maxLength={2000} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="We run a Nairobi-based accounting practice for small businesses. We help with bookkeeping, tax filing and payroll. Visitors should book a consultation." className="field mt-2 min-h-44 resize-y leading-6" />
            <p className="mt-1 text-right text-xs text-maven-muted">{brief.length}/2000</p>
            {error && <p role="alert" className="mt-4 flex gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-maven-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
            <button disabled={busy || claiming} className="btn btn-primary mt-5 w-full">
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
              {busy ? 'Generating your draft…' : 'Generate my website draft'}
            </button>
          </form>
          <p className="mt-4 text-xs leading-5 text-maven-muted">Anonymous drafts are limited to one per visitor per day and expire. Saving the draft requires a MavenHost account.</p>
          <div className="mt-6 border-t border-maven-line pt-5">
            <p className="text-sm font-semibold text-maven-ink">Need a complete, production-ready website?</p>
            <p className="mt-1 text-sm leading-6 text-maven-muted">Our developers can help refine the brief, design the site and prepare it for launch.</p>
            <Link to="/contact?type=developer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-maven-signal hover:underline">Request our professional developers <ArrowRight className="size-4" /></Link>
          </div>
        </section>

        <section aria-live="polite" aria-labelledby="draft-title">
          {!generation ? (
            <div className="panel flex min-h-80 flex-col items-center justify-center p-8 text-center">
              <div className="icon-tile on-light"><WandSparkles className="size-5" /></div>
              <h2 id="draft-title" className="mt-4 text-xl font-semibold text-maven-ink">Your draft will appear here</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-maven-muted">Generate a draft to review the suggested pages, copy and search metadata before deciding whether to save it.</p>
            </div>
          ) : (
            <div>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mono text-xs font-semibold uppercase tracking-wider text-maven-signal">Generated draft</p>
                  <h2 id="draft-title" className="mt-1 text-2xl font-semibold text-maven-ink">{generation.website_name || 'Your website draft'}</h2>
                </div>
                <span className="mono text-xs text-maven-muted">{generation.pages.length} {generation.pages.length === 1 ? 'page' : 'pages'}</span>
              </div>

              <div className="space-y-4">
                <WebsiteDraftEditor key={website?.id ?? generation.id} name={generation.website_name} pages={generation.pages} websiteId={user ? website?.id : undefined} onSaved={() => { setAnalysis(null); sessionStorage.removeItem(ANALYSIS_KEY) }} />
                {generation.pages.map((page) => (
                  <article key={page.slug} className="panel p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="mono text-[11px] uppercase tracking-wider text-maven-muted">/{page.slug}</p>
                        <h3 className="mt-1 text-lg font-semibold text-maven-ink">{page.title}</h3>
                      </div>
                      <span className="rounded-full bg-maven-surface px-2.5 py-1 text-xs font-medium text-maven-muted">{page.page_type}</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {(page.content.sections ?? []).map((section, index) => (
                        <div key={`${page.slug}-${index}`} className="border-l-2 border-maven-bright pl-3">
                          {section.heading && <h4 className="text-sm font-semibold text-maven-ink">{section.heading}</h4>}
                          {section.subheading && <p className="mt-1 text-sm font-medium text-maven-text">{section.subheading}</p>}
                          {section.body && <p className="mt-1 text-sm leading-6 text-maven-muted">{section.body}</p>}
                          {section.items?.length ? <ul className="mt-2 space-y-2 text-sm leading-6 text-maven-muted">{section.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{item.title && <span className="font-semibold text-maven-ink">{item.title}</span>}{item.question && <span className="font-semibold text-maven-ink">{item.question}</span>}{(item.description || item.answer) && <span className="block">{item.description || item.answer}</span>}</li>)}</ul> : null}
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 rounded-lg bg-maven-surface p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-maven-muted">Search preview fields</p>
                      <p className="mt-2 text-sm font-semibold text-maven-ink">{page.seo_title || 'No SEO title suggested'}</p>
                      <p className="mt-1 text-xs leading-5 text-maven-muted">{page.seo_description || 'No meta description suggested'}</p>
                    </div>
                  </article>
                ))}
              </div>

              {website ? (
                <div className="panel mt-5 p-5">
                  <p className="font-semibold text-maven-ink">Draft saved to your account</p>
                  <p className="mt-1 text-sm text-maven-muted">{website.name} is saved with {website.pages.length} {website.pages.length === 1 ? 'page' : 'pages'}. Run the SEO checks to review its titles, descriptions and page structure.</p>
                  <button disabled={busy} onClick={runSEOAnalysis} className="btn btn-secondary mt-4">
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {analysis ? 'Run SEO checks again' : 'Check this draft’s SEO'}
                  </button>
                  {analysis && (
                    <div className="mt-5 border-t border-maven-line pt-4">
                      <p className="text-sm font-semibold text-maven-ink">SEO score: {analysis.score}/100</p>
                      {analysis.findings.length ? (
                        <ul className="mt-3 space-y-3">
                          {analysis.findings.map((finding) => <li key={finding.id} className="text-sm"><p className="font-semibold text-maven-ink">{finding.title} <span className="ml-1 text-xs font-medium capitalize text-maven-muted">{finding.severity}</span></p><p className="mt-0.5 text-maven-muted">{finding.recommendation}</p></li>)}
                        </ul>
                      ) : <p className="mt-2 text-sm text-maven-muted">No issues were found by these checks.</p>}
                      <p className="mt-3 text-xs text-maven-muted">These checks cover technical page metadata and structure; they do not guarantee search rankings.</p>
                    </div>
                  )}
                </div>
              ) : user ? (
                <div className="panel mt-5 p-5">
                  <p className="font-semibold text-maven-ink">{claiming ? 'Saving your draft…' : 'Save this draft to your account'}</p>
                  <p className="mt-1 text-sm text-maven-muted">{claiming ? 'We are adding the generated pages to your MavenHost account.' : 'Your draft is ready to be saved to your MavenHost account.'}</p>
                  {error && <div className="mt-3"><p role="alert" className="text-sm text-maven-danger">{error}</p><button disabled={claiming} onClick={() => setClaimRetry((attempt) => attempt + 1)} className="mt-2 text-sm font-semibold text-maven-signal hover:underline">Try saving again</button></div>}
                </div>
              ) : (
                <div className="panel mt-5 flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <p className="font-semibold text-maven-ink">Want to keep this draft?</p>
                    <p className="mt-1 text-sm text-maven-muted">Sign in or create an account to save its pages.</p>
                  </div>
                  <Link to={`/login?next=${encodeURIComponent('/ai-builder')}`} className="btn btn-primary">Sign in to save <ArrowRight className="size-4" /></Link>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
