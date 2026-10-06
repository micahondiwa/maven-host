import { useState } from 'react'
import { Link, useSearchParams } from '@/lib/navigation'
import { LoaderCircle, MailCheck } from 'lucide-react'
import { AuthLayout } from '../../components/account/AuthLayout'
import { SEO } from '../../components/SEO'
import { ApiError, verifyEmail } from '../../lib/api'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setLoading(true)
    setError('')
    try { await verifyEmail(token); setVerified(true) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'We could not verify your email. Please try again.') }
    finally { setLoading(false) }
  }
  return <AuthLayout>
    <SEO title="Verify email | MavenHost" description="Confirm your MavenHost email address." path="/verify-email/" indexable={false} />
    <div className="mx-auto max-w-md">
      <MailCheck className="mb-5 size-10 text-maven-signal" />
      <h1 className="text-2xl font-semibold text-maven-ink">{verified ? 'Email verified' : 'Verify your email address'}</h1>
      <p className="mt-3 text-sm leading-6 text-maven-muted">{verified ? 'Your email address is confirmed. You can now continue to your MavenHost account.' : token ? 'Confirm your email address to finish setting up your MavenHost account.' : 'Open the verification link from your MavenHost email to continue.'}</p>
      {error && <p role="alert" className="mt-4 text-sm text-maven-danger">{error}</p>}
      {verified ? <Link to="/login" className="btn btn-primary mt-6">Continue to sign in</Link> : token && <button type="button" onClick={() => { void confirm() }} disabled={loading} className="btn btn-primary mt-6">{loading && <LoaderCircle className="size-4 animate-spin" />}{loading ? 'Verifying…' : 'Verify email'}</button>}
    </div>
  </AuthLayout>
}
