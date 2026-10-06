import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@/lib/navigation'
import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-react'
import { CustomerHeader } from '../../components/CustomerHeader'
import { SiteFooter } from '../../components/SiteFooter'
import { setTokens } from '../../lib/api'

export function GitHubCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const access = params.get('access')
    const refresh = params.get('refresh')
    const next = params.get('next') || '/account'
    const oauthError = params.get('error')

    if (oauthError || !access || !refresh) {
      setError(oauthError ? decodeURIComponent(oauthError) : 'GitHub sign-in could not be completed.')
      return
    }

    setTokens(access, refresh)
    window.history.replaceState(null, '', `${window.location.pathname}`)
    navigate(next.startsWith('/') ? next : '/account', { replace: true })
  }, [navigate])

  return (
    <div className="min-h-screen bg-maven-paper">
      <CustomerHeader />
      <main className="container-shell flex min-h-[50vh] max-w-lg flex-col items-center justify-center py-20 text-center">
        {!error ? <><LoaderCircle className="size-9 animate-spin text-maven-signal" /><h1 className="mt-5 text-xl font-semibold text-maven-ink">Finishing GitHub sign-in…</h1><p className="mt-2 text-sm text-maven-muted">Your MavenHost session is being created.</p></> : <><XCircle className="size-10 text-maven-danger" /><h1 className="mt-5 text-xl font-semibold text-maven-ink">GitHub sign-in failed</h1><p className="mt-2 text-sm text-maven-muted">{error}</p><Link to="/login" className="btn btn-primary mt-6"><CheckCircle2 className="size-4" /> Return to sign in</Link></>}
      </main>
      <SiteFooter />
    </div>
  )
}
