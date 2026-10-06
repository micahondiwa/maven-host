import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from '@/lib/navigation'
import { Github, LoaderCircle } from 'lucide-react'
import { AuthLayout } from '../../components/account/AuthLayout'
import { addDomainToCart, ApiError, register, startOAuth } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useCart } from '../../lib/cart'
import { clearPendingDomainSelection, getPendingDomainSelection } from '../../lib/pending-selection'

import { SEO } from '../../components/SEO'
export function RegisterPage() {
  const { refresh: refreshUser } = useAuth()
  const { refresh: refreshCart } = useCart()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/account'
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const pending = getPendingDomainSelection()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await register({ email, password, confirm_password: confirmPassword, first_name: firstName, last_name: lastName })
      await refreshUser()

      const selection = getPendingDomainSelection()
      if (selection) {
        try {
          await addDomainToCart(selection)
        } finally {
          clearPendingDomainSelection()
        }
      }
      await refreshCart()
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not create your account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <SEO title="Create your customer account | MavenHost" description="Create an account to save selections and manage purchased services. Domains, hosting and engineering services are separate." path="/register" indexable={false} />
      <div className="mx-auto max-w-[560px]">
        <div>
          <h1 className="text-[2rem] font-semibold tracking-tight text-maven-ink sm:text-[2.2rem]">Create an account</h1>
          <p className="mt-2 text-sm leading-6 text-maven-muted">
            {pending ? <>Sign up to continue registering <span className="mono font-semibold text-maven-ink">{pending.domain}</span>.</> : 'Save your selections and manage purchased domains, hosting and invoices. Creating an account does not activate a service.'}
          </p>
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
          <span>or create with email</span>
          <span className="h-px flex-1 bg-maven-line" />
        </div>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="first_name" className="label">First name</label>
              <input id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="field mt-1.5" />
            </div>
            <div>
              <label htmlFor="last_name" className="label">Last name</label>
              <input id="last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} className="field mt-1.5" />
            </div>
          </div>
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1.5" />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1.5" />
            <p className="mt-1.5 text-xs text-maven-muted">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="confirm_password" className="label">Confirm password</label>
            <input id="confirm_password" type="password" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="field mt-1.5" />
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
          <button disabled={loading} className="btn btn-primary w-full">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Create account
          </button>
        </form>
        <p className="mt-6 text-sm text-maven-muted">
          Already have an account?{' '}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-maven-signal">Sign in</Link>
        </p>
      </div>
    </AuthLayout>
  )
}
