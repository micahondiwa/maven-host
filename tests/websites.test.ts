import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { renderPageDocument, renderWebsiteFiles } from '../src/lib/website-renderer'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-website-test-secret'
process.env.FRONTEND_URL = 'http://localhost:3000'
delete process.env.OPENAI_API_KEY
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

const section = (type: string, extra: Record<string, unknown> = {}) => ({ type, heading: '', subheading: '', body: '', cta: '', cta_url: '', items: [], ...extra })
const SPEC = {
  website_name: 'Synthetic Bakery',
  pages: [
    {
      slug: 'home', title: 'Home', page_type: 'home', seo_title: 'Synthetic Bakery | Fresh bread in Nairobi', seo_description: 'Fresh bread, cakes and pastries baked every morning for homes and offices across Nairobi.',
      content: { sections: [section('hero', { heading: 'Fresh bread daily', subheading: 'Baked at dawn', body: 'Order online.', cta: 'Order now', cta_url: '/contact' }), section('services', { heading: 'What we bake', items: [{ title: 'Bread', description: 'Sourdough & rye', question: '', answer: '', image_url: 'https://example.test/bread.jpg', alt: '' }, { title: 'Cakes', description: 'Celebrations', question: '', answer: '', image_url: 'https://example.test/cake.jpg', alt: '' }] })] },
    },
    { slug: 'contact', title: 'Contact', page_type: 'contact', seo_title: 'Contact', seo_description: '', content: { sections: [section('contact', { heading: 'Visit us', body: 'Call <b>0700</b>' })] } },
  ],
}

describe('shared website renderer', () => {
  it('escapes content, keeps AI headings and only emits safe links', () => {
    const html = renderPageDocument({ name: 'A & B <Co>' }, { ...SPEC.pages[1], content: { sections: [section('contact', { heading: 'Reach <us>', cta: 'Go', cta_url: 'javascript:alert(1)' })] } }, SPEC.pages)
    expect(html).toContain('<h2>Reach &lt;us&gt;</h2>')
    expect(html).toContain('A &amp; B &lt;Co&gt;')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="#contact"')
    const files = renderWebsiteFiles({ name: 'Synthetic Bakery' }, SPEC.pages)
    expect(files.map((file) => file.name)).toEqual(['index.html', 'contact.html'])
    expect(files[0].content).toContain('<h1>Fresh bread daily</h1>')
    expect(renderPageDocument({ name: 'x' }, SPEC.pages[0], SPEC.pages, { mode: 'preview' })).not.toContain('href="/contact.html"')
  })
})

suite('AI builder, websites, SEO and trials', () => {
  let api: typeof import('../server/api')
  let resetThrottles: () => void
  let ip = 0

  async function call(method: string, path: string, options: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.1.${++ip % 250}.1`, ...options.headers }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function customer() {
    const email = `web-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
    return (await call('POST', '/auth/register/', { body: { email, password: 'Synthetic-pass-123', confirm_password: 'Synthetic-pass-123' } })).body.access as string
  }

  beforeAll(async () => {
    api = await import('../server/api')
    const { transaction } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
    resetThrottles = (await import('../server/http/throttle')).resetThrottles
  })

  beforeEach(async () => {
    resetThrottles()
    const { setAIProvider } = await import('../server/ai/provider')
    setAIProvider({ providerName: 'openai', model: 'synthetic-model', generateStructured: async ({ schemaName }) => ({ data: schemaName === 'maven_assistant_answer' ? { answer: 'Synthetic answer.' } : structuredClone(SPEC), inputTokens: 10, outputTokens: 20, model: 'synthetic-model', providerRequestId: 'req_1' }) })
  })

  afterAll(async () => {
    const { setAIProvider } = await import('../server/ai/provider')
    setAIProvider(null)
    await (await import('../server/db')).database().end()
  })

  it('reports an unconfigured OpenAI key instead of inventing output', async () => {
    const { setAIProvider } = await import('../server/ai/provider')
    setAIProvider(null)
    const result = await call('POST', '/ai/chat/', { body: { messages: [{ role: 'user', content: 'Hello' }] } })
    expect(result).toEqual({ status: 503, body: { detail: 'AI provider is not configured.' } })
  })

  it('validates chat requests and answers through the provider', async () => {
    expect((await call('POST', '/ai/chat/', { body: { messages: [] } })).body).toEqual({ messages: ['This list may not be empty.'] })
    expect((await call('POST', '/ai/chat/', { body: { messages: [{ role: 'robot', content: 'x' }] } })).body).toEqual({ messages: [{ role: ['"robot" is not a valid choice.'] }] })
    expect((await call('POST', '/ai/chat/', { body: { messages: [{ role: 'assistant', content: 'x' }] } })).body).toEqual({ messages: ['The latest message must be from the user.'] })
    expect((await call('POST', '/ai/chat/', { body: { messages: [{ role: 'user', content: 'Where are you?' }] } })).body).toEqual({ answer: 'Synthetic answer.' })
  })

  it('generates an anonymous draft once per visitor per day and lets the visitor claim it after sign-in', async () => {
    const tooShort = await call('POST', '/ai/public/website-generations/', { body: { brief: 'bakery' } })
    expect(tooShort.body).toEqual({ brief: ['Ensure this field has at least 20 characters.'] })
    const created = await call('POST', '/ai/public/website-generations/', { body: { brief: 'A Nairobi bakery selling bread and cakes to offices.' } })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ status: 'succeeded', website_name: 'Synthetic Bakery' })
    expect(created.body.pages).toHaveLength(2)
    const token = created.body.visitor_token as string
    expect((await call('POST', '/ai/public/website-generations/', { body: { brief: 'A second bakery brief that is long enough.', visitor_token: token } })).status).toBe(429)
    expect((await call('GET', `/ai/public/website-generations/${created.body.id}/`, { headers: { 'X-Maven-Visitor-Token': token } })).body.id).toBe(created.body.id)
    expect((await call('GET', `/ai/public/website-generations/${created.body.id}/`, { headers: { 'X-Maven-Visitor-Token': 'forged' } })).status).toBe(404)

    const access = await customer()
    const claimed = await call('POST', `/ai/public/website-generations/${created.body.id}/claim/`, { token: access, headers: { 'X-Maven-Visitor-Token': token } })
    expect(claimed.status).toBe(201)
    expect(claimed.body).toMatchObject({ name: 'Synthetic Bakery', slug: 'synthetic-bakery', status: 'draft' })
    expect(claimed.body.pages.map((page: { slug: string }) => page.slug)).toEqual(['home', 'contact'])
    expect((await call('POST', `/ai/public/website-generations/${created.body.id}/claim/`, { token: access, headers: { 'X-Maven-Visitor-Token': token } })).status).toBe(409)
    expect((await call('GET', '/websites/', { token: access })).body).toHaveLength(1)
  })

  it('edits pages safely, isolates owners and runs SEO checks without crashing on repeated findings', async () => {
    const access = await customer()
    const site = (await call('POST', '/websites/', { token: access, body: { name: 'Bakery Site' } })).body
    expect(site).toMatchObject({ slug: 'bakery-site', status: 'draft', pages: [] })
    const generated = await call('POST', `/websites/${site.id}/generate/`, { token: access, body: { brief: 'Bakery in Nairobi; api_key=secret-value' } })
    expect(generated.body).toMatchObject({ status: 'ready', generation_status: 'completed', name: 'Synthetic Bakery' })
    const pages = (await call('GET', `/websites/${site.id}/pages/`, { token: access })).body
    expect((await call('PATCH', `/websites/${site.id}/pages/${pages[1].id}/`, { token: access, body: { content: { sections: [{ type: 'cta', cta_url: 'javascript:alert(1)' }] } } })).body).toEqual({ detail: 'HTML and executable URL content are not allowed in website sections.' })
    expect((await call('PATCH', `/websites/${site.id}/pages/${pages[1].id}/`, { token: access, body: { slug: 'home' } })).body).toEqual({ detail: 'A page with this slug already exists for this website.' })
    expect((await call('PATCH', `/websites/${site.id}/pages/${pages[1].id}/`, { token: access, body: { seo_title: 'Contact Synthetic Bakery in Nairobi today' } })).body.seo_title).toBe('Contact Synthetic Bakery in Nairobi today')

    const stranger = await customer()
    expect((await call('GET', `/websites/${site.id}/`, { token: stranger })).status).toBe(404)
    expect((await call('POST', `/websites/${site.id}/seo/analyze/`, { token: stranger })).status).toBe(404)

    expect((await call('GET', `/websites/${site.id}/seo/`, { token: access })).status).toBe(404)
    const analysis = (await call('POST', `/websites/${site.id}/seo/analyze/`, { token: access })).body
    const codes = analysis.findings.map((finding: { code: string }) => finding.code)
    expect(codes.filter((code: string) => code === 'MISSING_IMAGE_ALT')).toHaveLength(1)
    expect(codes).toEqual(expect.arrayContaining(['MISSING_DESCRIPTION', 'THIN_CONTENT', 'MISSING_H1']))
    expect(analysis.findings.map((finding: { severity: string }) => finding.severity)).toEqual([...analysis.findings.map((finding: { severity: string }) => finding.severity)].sort())
    expect(analysis.score).toBe(Math.max(0, 100 - 15 * codes.filter((_: string, i: number) => analysis.findings[i].severity === 'error').length - 5 * codes.filter((_: string, i: number) => analysis.findings[i].severity === 'warning').length))
    expect((await call('GET', `/websites/${site.id}/seo/`, { token: access })).body.id).toBe(analysis.id)
  })

  it('starts a seven-day trial and deploys the rendered pages through the outbox', async () => {
    const access = await customer()
    const site = (await call('POST', '/websites/', { token: access, body: { name: 'Trial Site' } })).body
    expect((await call('POST', `/websites/${site.id}/trial/activate/`, { token: access })).body).toEqual({ detail: 'Generate website content before starting the free trial.' })
    await call('POST', `/websites/${site.id}/generate/`, { token: access, body: { brief: 'Bakery website for a trial run.' } })
    const trial = await call('POST', `/websites/${site.id}/trial/activate/`, { token: access })
    expect(trial.status).toBe(202)
    expect(trial.body.status).toBe('pending')
    expect(trial.body.public_url).toMatch(/^https:\/\/maven-trial-[0-9a-f]{32}\./)

    const { processOutbox } = await import('../server/jobs/outbox')
    const { OUTBOX_HANDLERS } = await import('../server/jobs/handlers')
    const { database } = await import('../server/db')
    await processOutbox(database(), OUTBOX_HANDLERS, 20)
    expect((await call('GET', `/websites/${site.id}/trial/`, { token: access })).body.status).toBe('active')
    const { FakeTrialProvider } = await import('../server/websites/trial-providers')
    const deployed = FakeTrialProvider.deployments.get(trial.body.id)!
    expect(deployed.files.map((file) => file.name)).toEqual(['index.html', 'contact.html'])
    expect((await call('POST', `/websites/${site.id}/trial/activate/`, { token: access })).body).toEqual({ detail: 'This website already has a MavenHost trial.' })
  })
})
