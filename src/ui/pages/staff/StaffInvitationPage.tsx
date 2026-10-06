import { useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from '@/lib/navigation'
import { ApiError, acceptStaffInvitation } from '../../lib/api'
import { BrandLogo } from '../../components/BrandLogo'
import { CustomerHeader } from '../../components/CustomerHeader'
import { SiteFooter } from '../../components/SiteFooter'

function passwordRules(password: string) {
  return [
    ['At least 12 characters', password.length >= 12],
  ] as const
}

export function StaffInvitationPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const rules = useMemo(() => passwordRules(password), [password])
  const valid = Boolean(token) && Boolean(firstName.trim()) && rules.every(([, passes]) => passes) && password === confirmation

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!token) {
      setError('This invitation link is missing its activation token.')
      return
    }
    if (!valid) {
      setError(!firstName.trim() ? 'Enter your first name to set up your profile.' : password !== confirmation ? 'Passwords do not match.' : 'Choose a password that meets the requirements.')
      return
    }
    setLoading(true)
    try {
      await acceptStaffInvitation(token, password, confirmation, { first_name: firstName.trim(), last_name: lastName.trim() })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not activate this staff invitation.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-maven-surface">
      <CustomerHeader />
      <main className="flex-1 lg:grid lg:grid-cols-[1fr_0.9fr]">
      <section className="hidden bg-maven-navy p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <BrandLogo light />
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Staff account activation</p>
          <h1 className="mt-5 text-5xl font-black tracking-[-0.05em]">Your platform role starts here.</h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">Set up your profile and choose your own secure password to activate the staff account created for you by a MavenHost administrator.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><ShieldCheck className="size-5 text-cyan-300" /><p className="mt-3 font-bold">Role-based access</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><KeyRound className="size-5 text-cyan-300" /><p className="mt-3 font-bold">Secure credentials</p></div>
          </div>
        </div>
        <p className="text-xs text-slate-400">By MavenHost</p>
      </section>

      <section className="flex min-h-screen items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden"><BrandLogo /></div>
          <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-9">
            {success ? (
              <div className="text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-7" /></span>
                <h2 className="mt-6 text-3xl font-black tracking-[-0.04em] text-maven-navy">Account activated</h2>
                <p className="mt-3 text-sm leading-6 text-maven-muted">Your staff account is now active. Sign in to enter the MavenHost Staff Portal.</p>
                <button onClick={() => navigate('/staff/login', { replace: true })} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-maven-blue px-5 py-3.5 font-bold text-white hover:bg-blue-700">Continue to sign in <ArrowRight className="size-5" /></button>
              </div>
            ) : (
              <>
                <span className="inline-flex rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-maven-blue">Staff account activation</span>
                <h2 className="mt-5 text-3xl font-black tracking-[-0.04em] text-maven-navy">Set up your staff profile</h2>
                <p className="mt-2 text-sm leading-6 text-maven-muted">Add your name and choose your own password. Completing setup activates the staff role assigned by your MavenHost administrator.</p>
                <form onSubmit={submit} className="mt-8 space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">First name</span><input required maxLength={30} autoComplete="given-name" value={firstName} onChange={event => setFirstName(event.target.value)} className="field" /></label>
                    <label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">Last name</span><input maxLength={30} autoComplete="family-name" value={lastName} onChange={event => setLastName(event.target.value)} className="field" /></label>
                  </div>
                  <label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">Password</span><input required type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 outline-none transition focus:border-maven-cyan focus:bg-white focus:ring-4 focus:ring-cyan-100" /></label>
                  <label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">Confirm password</span><input required type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 outline-none transition focus:border-maven-cyan focus:bg-white focus:ring-4 focus:ring-cyan-100" /></label>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Password requirements</p><div className="mt-3 space-y-2">{rules.map(([label, passes]) => <p key={label} className={`text-sm font-semibold ${passes ? 'text-emerald-700' : 'text-slate-500'}`}>{passes ? '✓' : '•'} {label}</p>)}<p className={`text-sm font-semibold ${password === confirmation && confirmation ? 'text-emerald-700' : 'text-slate-500'}`}>{password === confirmation && confirmation ? '✓' : '•'} Passwords match</p></div></div>
                  {error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
                  <button disabled={loading || !token} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-maven-blue px-5 py-3.5 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{loading ? 'Saving your profile…' : 'Save profile and activate account'}{!loading && <ArrowRight className="size-5" />}</button>
                </form>
              </>
            )}
          </div>
          {!success && <Link to="/staff/login" className="mx-auto mt-6 block w-fit text-sm font-bold text-slate-500 hover:text-maven-blue">Already activated? Sign in</Link>}
        </div>
      </section>
      </main>
      <SiteFooter />
    </div>
  )
}
