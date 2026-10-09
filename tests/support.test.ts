import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-support-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

suite('contact form and support tickets', () => {
  let api: typeof import('../server/api')
  let ip = 0

  async function call(method: string, path: string, options: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.9.${++ip % 250}`, ...options.headers }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function account(role: 'Customer' | 'Support' | 'Billing') {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `support-${role}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
    await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: role !== 'Customer', is_email_verified: true })
      await addToGroup(client, user.id, role)
    })
    const login = (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body
    return { access: login.access as string, id: login.user.id as string }
  }

  beforeAll(async () => {
    api = await import('../server/api')
    const { transaction } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
  })
  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())
  afterAll(async () => (await import('../server/db')).database().end())

  it('accepts public contact requests, emails the routed team and acknowledges the sender', async () => {
    const { sentEmails } = await import('../server/communications/email')
    const before = sentEmails().length
    const email = `visitor-${Date.now()}@example.test`
    expect((await call('POST', '/contact/', { body: { request_type: 'sales', name: 'V', email, subject: 's', message: 'm' } })).body).toEqual({ request_type: ['"sales" is not a valid choice.'] })
    const created = await call('POST', '/contact/', { body: { request_type: 'developer', name: 'Visitor', email, subject: 'New website', message: 'Please build a site.' } })
    expect(created).toMatchObject({ status: 201, body: { message: 'Your request has been received. Our team will follow up by email.' } })
    const messages = sentEmails().slice(before)
    expect(messages.map((message) => message.to[0])).toEqual(['developers@maven-host.com', email])
    expect(messages[0].replyTo).toEqual([email])
  })

  it('runs the customer and staff ticket lifecycle with idempotent staff actions and private notes', async () => {
    const customer = await account('Customer')
    const other = await account('Customer')
    const agent = await account('Support')
    const billing = await account('Billing')
    const opened = await call('POST', '/support/tickets/', { token: customer.access, body: { subject: 'DNS not resolving', description: 'My A record is not live.', category: 'domains' } })
    expect(opened.body).toMatchObject({ status: 'open', number: expect.stringMatching(/^MWH-[0-9A-F]{10}$/), messages: [] })
    const ticketId = opened.body.id
    expect((await call('GET', `/support/tickets/${ticketId}/`, { token: other.access })).status).toBe(404)

    const base = `/staff/customers/${customer.id}/support/tickets/${ticketId}`
    expect((await call('GET', `/staff/customers/${customer.id}/support/tickets/`, { token: billing.access })).status).toBe(403)
    expect((await call('POST', `${base}/reply/`, { token: agent.access, body: { body: 'Looking now.' } })).body).toEqual({ 'Idempotency-Key': ['A unique Idempotency-Key header is required (max 255 characters).'] })
    await call('POST', `${base}/assign/`, { token: agent.access, body: { staff_id: agent.id }, headers: { 'Idempotency-Key': 'assign-1' } })
    const reply = await call('POST', `${base}/reply/`, { token: agent.access, body: { body: 'Please check the TTL.' }, headers: { 'Idempotency-Key': 'reply-1' } })
    expect(reply.status).toBe(201)
    await call('POST', `${base}/reply/`, { token: agent.access, body: { body: 'Please check the TTL.' }, headers: { 'Idempotency-Key': 'reply-1' } })
    await call('POST', `${base}/internal-note/`, { token: agent.access, body: { body: 'Customer zone uses external DNS.' }, headers: { 'Idempotency-Key': 'note-1' } })
    const staffView = (await call('GET', `${base}/`, { token: agent.access })).body
    expect(staffView).toMatchObject({ status: 'waiting_customer', assigned_to_email: expect.stringContaining('support-Support') })
    expect(staffView.messages.map((message: { internal_note: boolean }) => message.internal_note)).toEqual([false, true])

    const customerView = (await call('GET', `/support/tickets/${ticketId}/`, { token: customer.access })).body
    expect(customerView.messages).toHaveLength(1)
    expect((await call('POST', `/support/tickets/${ticketId}/reply/`, { token: customer.access, body: { body: 'Fixed, thanks!' } })).body.status).toBe('in_progress')

    expect((await call('POST', `${base}/close/`, { token: agent.access, body: {}, headers: { 'Idempotency-Key': 'close-early' } })).body).toEqual({ detail: 'Only resolved tickets can be closed.' })
    await call('POST', `${base}/resolve/`, { token: agent.access, body: {}, headers: { 'Idempotency-Key': 'resolve-1' } })
    expect((await call('POST', `${base}/close/`, { token: agent.access, body: {}, headers: { 'Idempotency-Key': 'close-1' } })).body.status).toBe('closed')
    expect((await call('POST', `/support/tickets/${ticketId}/reply/`, { token: customer.access, body: { body: 'One more thing' } })).status).toBe(409)
  }, 90_000)
})
