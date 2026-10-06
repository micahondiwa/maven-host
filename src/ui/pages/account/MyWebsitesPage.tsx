import { useEffect, useState } from 'react'
import { Link } from '@/lib/navigation'
import { ArrowRight, LoaderCircle, SearchCheck, WandSparkles } from 'lucide-react'
import { ApiError, analyzeWebsiteSEO, listMyWebsites, type CustomerWebsite, type SEOAnalysis } from '../../lib/api'
import { WebsiteDraftEditor } from '../../components/WebsiteDraftEditor'

export function MyWebsitesPage() {
  const [websites, setWebsites] = useState<CustomerWebsite[]>([])
  const [analyses, setAnalyses] = useState<Record<string, SEOAnalysis>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    listMyWebsites()
      .then(setWebsites)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'We could not load your websites.'))
      .finally(() => setLoading(false))
  }, [])

  async function runAnalysis(websiteId: string) {
    setRunning(websiteId)
    setError('')
    try {
      const analysis = await analyzeWebsiteSEO(websiteId)
      setAnalyses((current) => ({ ...current, [websiteId]: analysis }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not analyze this website.')
    } finally {
      setRunning(null)
    }
  }

  if (loading) return <div className="flex items-center gap-3 text-maven-muted"><LoaderCircle className="size-5 animate-spin" /> Loading your websites…</div>
  if (error && websites.length === 0) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-maven-ink">Your websites</h2>
          <p className="mt-1 text-sm text-maven-muted">Review saved website drafts and run technical SEO checks.</p>
        </div>
        <Link to="/ai-builder" className="btn btn-primary"><WandSparkles className="size-4" /> Create a website draft</Link>
      </div>

      {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
      {websites.length === 0 ? (
        <div className="panel mt-6 p-8 text-center">
          <h3 className="font-semibold text-maven-ink">No saved websites yet</h3>
          <p className="mt-2 text-sm text-maven-muted">Generate a draft with the AI website builder, then sign in to save it here.</p>
          <Link to="/ai-builder" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-maven-signal">Try the AI builder <ArrowRight className="size-4" /></Link>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {websites.map((website) => (
            <article key={website.id} className="panel p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-maven-ink">{website.name}</h3>
                  <p className="mt-1 text-sm text-maven-muted">{website.domain_name || 'No domain attached'} · {website.pages.length} {website.pages.length === 1 ? 'page' : 'pages'}</p>
                  <p className="mono mt-2 text-xs capitalize text-maven-muted">{website.status.replaceAll('_', ' ')} · generation {website.generation_status}</p>
                </div>
                <button disabled={running === website.id} onClick={() => runAnalysis(website.id)} className="btn btn-secondary">
                  {running === website.id ? <LoaderCircle className="size-4 animate-spin" /> : <SearchCheck className="size-4" />}
                  {analyses[website.id] ? 'Run SEO checks again' : 'Check SEO'}
                </button>
              </div>
              <button className="btn btn-secondary mt-4" onClick={() => setEditing(editing === website.id ? null : website.id)}>{editing === website.id ? 'Close editor' : 'Edit and preview pages'}</button>
              {editing === website.id && <WebsiteDraftEditor name={website.name} pages={[]} websiteId={website.id} onSaved={() => setAnalyses(current => { const next = { ...current }; delete next[website.id]; return next })} />}
              {analyses[website.id] && (
                <div className="mt-5 border-t border-maven-line pt-4">
                  <p className="text-sm font-semibold text-maven-ink">SEO score: {analyses[website.id].score}/100</p>
                  {analyses[website.id].findings.length ? <ul className="mt-3 space-y-3">{analyses[website.id].findings.map((finding) => <li key={finding.id} className="text-sm"><p className="font-semibold text-maven-ink">{finding.title} <span className="ml-1 text-xs font-medium capitalize text-maven-muted">{finding.severity}</span></p><p className="mt-0.5 text-maven-muted">{finding.recommendation}</p></li>)}</ul> : <p className="mt-2 text-sm text-maven-muted">No issues were found by these checks.</p>}
                  <p className="mt-3 text-xs text-maven-muted">These technical checks do not guarantee search rankings.</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
