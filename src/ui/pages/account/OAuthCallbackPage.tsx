import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from '@/lib/navigation'
import { LoaderCircle } from 'lucide-react'
import { CustomerHeader } from '../../components/CustomerHeader'
import { SiteFooter } from '../../components/SiteFooter'
import { ApiError, setTokens } from '../../lib/api'
import { useAuth } from '../../lib/auth'

export function OAuthCallbackPage() {
  const { provider = 'social' } = useParams()
  const navigate = useNavigate()
  const { completeSocialSignIn } = useAuth()
  const [error, setError] = useState('')
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const access = fragment.get('access')
    const refreshToken = fragment.get('refresh')
    const next = fragment.get('next') || '/account'
    const message = fragment.get('error')

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

    if (message) {
      setError(message)
      return
    }
    if (!access || !refreshToken) {
      setError(`We could not complete ${provider} sign-in. Please try again.`)
      return
    }

    setTokens(access, refreshToken)
    completeSocialSignIn()
      .then(() => navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/account', { replace: true }))
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : `We could not complete ${provider} sign-in.`
        setError(message)
      })
  }, [navigate, provider, completeSocialSignIn])

  return (
    <div className="flex min-h-screen flex-col bg-maven-paper">
      <CustomerHeader />
      <main className="container-shell flex flex-1 items-center justify-center py-16">
        <div className="panel w-full max-w-md p-8 text-center">
          {error ? (
            <>
              <h1 className="mt-8 text-xl font-semibold text-maven-ink">Sign-in could not be completed</h1>
              <p className="mt-2 text-sm leading-6 text-maven-muted">{error}</p>
              <Link to="/login" className="btn btn-primary mt-6">Back to sign in</Link>
            </>
          ) : (
            <div className="mt-10">
              <LoaderCircle className="mx-auto size-7 animate-spin text-maven-signal" />
              <p className="mt-4 text-sm font-medium text-maven-ink">Finishing {provider} sign-in…</p>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
