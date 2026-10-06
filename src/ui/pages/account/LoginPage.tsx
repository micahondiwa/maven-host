import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from '@/lib/navigation'
import { Github, LoaderCircle } from 'lucide-react'
import { AuthLayout } from '../../components/account/AuthLayout'
import { ApiError, startOAuth } from '../../lib/api'
import { useAuth } from '../../lib/auth'

import { SEO } from '../../components/SEO'
export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/account'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not sign you in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <SEO title="Sign in to your account | MavenHost" description="Sign in to review your MavenHost services, selections, orders and invoices." path="/login" indexable={false} />
      <div className="mx-auto max-w-[500px]">
        <div className="border-b border-maven-line pb-6">
          <span className="chip chip-bright">Customer account</span>
          <h1 className="text-[2rem] font-semibold tracking-tight text-maven-ink sm:text-[2.2rem]">Sign in</h1>
          <p className="mt-3 text-sm leading-6 text-maven-muted">Manage your domains, hosting, orders and invoices from one place.</p>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => startOAuth('google', next)} className="btn btn-secondary w-full">
            <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-white text-sm font-bold text-[#4285F4]">G</span>
            Continue with Google
          </button>
          <button type="button" onClick={() => startOAuth('github', next)} className="btn btn-secondary w-full">
            <Github className="size-5" />
            Continue with GitHub
          </button>
        </div>
        <div className="my-7 flex items-center gap-3 text-xs text-maven-muted">
          <span className="h-px flex-1 bg-maven-line" />
          <span>or use your email</span>
          <span className="h-px flex-1 bg-maven-line" />
        </div>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1.5" />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1.5" />
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
          <button disabled={loading} className="btn btn-primary w-full">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>
        <p className="mt-6 text-sm text-maven-muted">
          Don't have an account?{' '}
          <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-maven-signal">Get started</Link>
        </p>
        <p className="mt-3 text-sm text-maven-muted"><Link to="/contact?type=support&subject=Account%20access" className="font-medium text-maven-signal">Need help accessing your account?</Link></p>
        <p className="mt-2 text-sm text-maven-muted">
          <Link to="/staff/login" className="font-medium text-maven-muted hover:text-maven-signal">Staff sign in</Link>
        </p>
      </div>
    </AuthLayout>
  )
}
