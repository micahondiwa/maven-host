import { CONTACT, INARA_CREST, OFFICE, whatsappUrl } from '../lib/site'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from '@/lib/navigation'
import { ArrowRight, BriefcaseBusiness, LifeBuoy, Mail, MessageSquareText } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SEO } from '../components/SEO'
import { SiteFooter } from '../components/SiteFooter'
import { ApiError, submitContactRequest, type ContactRequestType } from '../lib/api'

const REQUESTS: { type: ContactRequestType; title: string; description: string; icon: typeof Mail; subject: string; prompt: string }[] = [
  { type: 'general', title: 'General inquiry', description: 'Questions about MavenHost, domains, hosting, or partnerships.', icon: Mail, subject: 'General inquiry', prompt: 'How can we help?' },
  { type: 'support', title: 'Customer support', description: 'Help with an existing account, domain, hosting plan, order, or payment.', icon: LifeBuoy, subject: 'Customer support request', prompt: 'Describe the issue and include the domain or order reference if relevant.' },
  { type: 'developer', title: 'Developer services', description: 'Tell us about a website, application, or custom development project.', icon: BriefcaseBusiness, subject: 'Developer services request', prompt: 'What would you like our developers to build or improve?' },
]

export function ContactPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedType = searchParams.get('type')
  const initialType: ContactRequestType = REQUESTS.some((item) => item.type === requestedType) ? requestedType as ContactRequestType : 'general'
  const requestedSubject = searchParams.get('subject')
  const [activeType, setActiveType] = useState<ContactRequestType>(initialType)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [subject, setSubject] = useState(requestedSubject ?? REQUESTS.find((item) => item.type === initialType)!.subject)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function selectRequest(type: ContactRequestType) {
    setActiveType(type)
    setSearchParams({ type }, { replace: true })
    setSubject(REQUESTS.find((item) => item.type === type)!.subject)
    setError('')
    setSuccess('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setError('')
    setSuccess('')
    try {
      const result = await submitContactRequest({
        request_type: activeType,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        subject: subject.trim(),
        message: message.trim(),
      })
      setSuccess(`${result.message} Reference: ${result.id.slice(0, 8).toUpperCase()}.`)
      setMessage('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not submit your request. Please try again or email info@maven-host.com.')
    } finally {
      setSending(false)
    }
  }

  const current = REQUESTS.find((item) => item.type === activeType)!
  const Icon = current.icon

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <CustomerHeader dark />
      <SEO title="Contact MavenHost | Sales, Support and Developer Services" description="Contact MavenHost for general inquiries, customer support, or professional website and software development services." path="/contact" />
      <section className="hero-neutral py-14 text-maven-text sm:py-18">
        <div className="container-shell">
          <span className="chip">Get in touch</span>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">How can we help?</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-maven-muted">Choose the team you need. Your message will be routed to the right MavenHost inbox, and our team can follow up by email.</p>
        </div>
      </section>

      <main id="main-content" className="container-shell py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
          <div>
            <h2 className="text-lg font-semibold text-maven-ink">Choose a request type</h2>
            <div className="mt-4 space-y-3">
              {REQUESTS.map(({ type, title, description, icon: RequestIcon }) => (
                <button key={type} type="button" onClick={() => selectRequest(type)} aria-pressed={activeType === type}
                  className={`flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition ${activeType === type ? 'border-maven-signal bg-white shadow-sm ring-1 ring-maven-signal/20' : 'border-maven-line bg-white/60 hover:border-maven-signal/50'}`}>
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${activeType === type ? 'bg-maven-ink text-maven-bright' : 'bg-maven-surface text-maven-signal'}`}><RequestIcon className="size-5" /></span>
                  <span><span className="block text-sm font-semibold text-maven-ink">{title}</span><span className="mt-1 block text-sm leading-5 text-maven-muted">{description}</span></span>
                </button>
              ))}
            </div>
            <div className="mt-6 rounded-2xl bg-maven-ink p-5 text-white">
              <MessageSquareText className="size-5 text-maven-bright" />
              <p className="mt-3 text-sm font-semibold">Prefer a direct conversation?</p>
              <p className="mt-1 text-sm leading-6 text-white/75">Contact the MavenHost team directly for account, domain and hosting questions.</p><a href={CONTACT.emailHref} className="mt-3 block text-sm font-semibold text-white">{CONTACT.email}</a><a href={whatsappUrl()} target="_blank" rel="noreferrer" className="mt-2 block text-sm font-semibold text-maven-bright">Message on WhatsApp<span className="sr-only"> (opens in a new tab)</span></a>
              <address className="mt-4 text-sm not-italic leading-6 text-white/75"><span className="block text-xs font-semibold uppercase tracking-wider text-white/60">Head office</span>{OFFICE.headOffice.map((line) => <span key={line} className="block">{line}</span>)}<span className="mt-2 block text-xs font-semibold uppercase tracking-wider text-white/60">Liaison office</span><span className="block">{OFFICE.liaisonOffice}</span></address>
            </div>
          </div>

          <section className="rounded-2xl border border-maven-line bg-white p-5 shadow-sm sm:p-8" aria-labelledby="contact-form-title">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-maven-signal/10 text-maven-signal"><Icon className="size-5" /></span>
              <div><p className="text-xs font-bold uppercase tracking-wider text-maven-signal">{current.title}</p><h2 id="contact-form-title" className="mt-1 text-xl font-semibold text-maven-ink">Send us a message</h2></div>
            </div>
            {activeType === 'developer' && <p className="mt-4 text-sm leading-6 text-maven-muted">Code changes, development and application maintenance are separate Inara Crest Devs engagements. <a href={INARA_CREST.developers} target="_blank" rel="noreferrer" className="font-semibold text-maven-signal">Discuss development with Inara Crest<span className="sr-only"> (opens in a new tab)</span></a>. You can also send this form to route your inquiry.</p>}
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-maven-ink">Your name<input required maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="field mt-1.5 w-full" /></label>
                <label className="block text-sm font-medium text-maven-ink">Email address<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="field mt-1.5 w-full" /></label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-maven-ink">Phone <span className="font-normal text-maven-muted">(optional)</span><input type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="field mt-1.5 w-full" /></label>
                <label className="block text-sm font-medium text-maven-ink">Subject<input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} className="field mt-1.5 w-full" /></label>
              </div>
              <label className="block text-sm font-medium text-maven-ink">Message<textarea required minLength={10} maxLength={10000} rows={6} placeholder={current.prompt} value={message} onChange={(event) => setMessage(event.target.value)} className="field mt-1.5 w-full resize-y" /></label>
              {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              {success && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800">{success}</p>}
              <button type="submit" disabled={sending} className="btn btn-primary w-full justify-center sm:w-auto">{sending ? 'Sending…' : 'Send request'} <ArrowRight className="size-4" /></button>
              <p className="text-xs leading-5 text-maven-muted">Use the email associated with your service where possible. Do not send passwords, private keys or payment-card details.</p>
            </form>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
