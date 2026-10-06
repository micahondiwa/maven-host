import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useLocation, useNavigate } from '@/lib/navigation'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { BrandLogo } from '../../components/BrandLogo'
import { CustomerHeader } from '../../components/CustomerHeader'
import { SiteFooter } from '../../components/SiteFooter'

export function StaffLoginPage() {
  const { user, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user?.account_type === 'staff' || user?.account_type === 'admin') navigate('/staff', { replace: true })
  }, [user, navigate])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const current = await signIn(email.trim(), password)
      if (current.account_type !== 'staff' && current.account_type !== 'admin') {
        await signOut()
        setError('This account does not have staff portal access.')
        return
      }
      const from = (location.state as { from?: string } | null)?.from
      navigate(from?.startsWith('/staff') ? from : '/staff', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not sign you in. Please try again.')
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
        <div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">MavenHost</p><h1 className="mt-5 text-5xl font-black tracking-[-0.05em]">Operate the platform with confidence.</h1><p className="mt-5 text-lg leading-8 text-slate-300">The staff portal reflects the backend authorization model. Your role and effective permissions determine what you can see and do.</p><div className="mt-8 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><ShieldCheck className="size-5 text-cyan-300" /><p className="mt-3 font-bold">Backend-enforced access</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><LockKeyhole className="size-5 text-cyan-300" /><p className="mt-3 font-bold">Secure staff session</p></div></div></div>
        <p className="text-xs text-slate-400">By MavenHost</p>
      </section>

      <section className="flex min-h-screen items-center justify-center p-5 sm:p-8"><div className="w-full max-w-md"><div className="mb-10 lg:hidden"><BrandLogo /></div><div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-9"><div><span className="inline-flex rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-maven-blue">Staff control plane</span><h2 className="mt-5 text-3xl font-black tracking-[-0.04em] text-maven-navy">Sign in</h2><p className="mt-2 text-sm leading-6 text-maven-muted">Use your MavenHost staff account. Access is determined by your backend roles and permissions.</p></div><form onSubmit={submit} className="mt-8 space-y-5"><label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">Email</span><input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 outline-none transition focus:border-maven-cyan focus:bg-white focus:ring-4 focus:ring-cyan-100" placeholder="you@company.com" /></label><label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">Password</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 outline-none transition focus:border-maven-cyan focus:bg-white focus:ring-4 focus:ring-cyan-100" /></label>{error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}<button disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-maven-blue px-5 py-3.5 font-bold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70">{loading ? 'Signing in…' : 'Enter staff portal'}{!loading && <ArrowRight className="size-5" />}</button></form></div><button onClick={() => navigate('/')} className="mx-auto mt-6 block text-sm font-bold text-slate-500 hover:text-maven-blue">Back to public website</button></div></section>
      </main>
      <SiteFooter />
    </div>
  )
}
