import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-adjustments-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

suite('refunds and credit notes', () => {
  let api: typeof import('../server/api')
  let ip = 0
  const run = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.6.${++ip % 250}` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function account(role: 'Customer' | 'Billing' | 'Support') {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `adjust-${role}-${run}-${++ip}@example.test`
    const id = await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: role !== 'Customer', is_email_verified: true })
      await addToGroup(client, user.id, role)
      return user.id as string
    })
    if (role === 'Customer') return { id, access: '' }
    return { id, access: (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body.access as string }
  }

  /** A synthetic issued invoice for `total` USD on a draft order (no fulfilment is triggered by paying it). */
  async function invoice(customerId: string, total: string) {
    const { database, queryOne } = await import('../server/db')
    const db = database()
    const usd = (await queryOne<{ id: number }>(`SELECT id FROM currencies_currency WHERE code = 'USD'`))!.id
    const orderId = randomUUID()
    await db.query(
      `INSERT INTO orders_order (id, number, status, subtotal, discount, tax, total, currency, notes, placed_at, completed_at, created_at, updated_at, cart_id, customer_id)
       VALUES ($1, $2, 'draft', $3, 0, 0, $3, 'USD', '', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, $4)`,
      [orderId, `ADJ-${run}-${++ip}`.slice(0, 30), total, customerId],
    )
    const id = randomUUID()
    await db.query(
      `INSERT INTO billing_invoice (id, number, status, subtotal, discount, tax, total, paid_amount, credited_amount, payment_terms, notes, issued_at, due_date, paid_at, cancelled_at,
         created_at, updated_at, currency_id, customer_id, issued_by_id, order_id)
       VALUES ($1, $2, 'issued', $3, 0, 0, $3, 0, 0, 7, '', CURRENT_TIMESTAMP, CURRENT_DATE, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5, NULL, $6)`,
      [id, `INV-ADJ-${run}-${ip}`.slice(0, 30), total, usd, customerId, orderId],
    )
    return id
  }

  beforeAll(async () => {
    api = await import('../server/api')
    const { transaction } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
    await (await import('../server/pricing/engine')).seedCurrencies()
  })
  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())
  afterAll(async () => (await import('../server/db')).database().end())

  it('refunds a payment only within its amount, settling the invoice when the payout is recorded', async () => {
    const customer = await account('Customer')
    const billing = await account('Billing')
    const support = await account('Support')
    const invoiceId = await invoice(customer.id, '100.00')
    const base = `/staff/customers/${customer.id}`
    const paid = await call('POST', `${base}/invoices/${invoiceId}/payments/`, { token: billing.access, body: { amount: '100.00', method: 'bank_transfer', customer_reference: 'BANK-1' } })
    expect(paid.status).toBe(201)
    const paymentId = paid.body.payment_id

    expect((await call('POST', `${base}/payments/${paymentId}/refunds/`, { token: support.access, body: { amount: '10.00', reason: 'x' } })).status).toBe(403)
    const first = await call('POST', `${base}/payments/${paymentId}/refunds/`, { token: billing.access, body: { amount: '60.00', reason: 'Service not delivered' } })
    expect(first).toMatchObject({ status: 201, body: { status: 'pending', amount: '60.00' } })
    expect((await call('POST', `${base}/payments/${paymentId}/refunds/`, { token: billing.access, body: { amount: '50.00', reason: 'Too much' } })).body).toEqual({ detail: 'Refund amount exceeds the remaining refundable amount.' })

    const refundPath = `${base}/refunds/${first.body.refund_id}`
    expect((await call('POST', `${refundPath}/complete/`, { token: billing.access, body: {} })).body).toEqual({ provider_reference: ['Record the payout reference (bank or M-Pesa transaction) to complete a refund.'] })
    expect((await call('POST', `${refundPath}/complete/`, { token: billing.access, body: { provider_reference: 'MPESA-RF-1' } })).body).toMatchObject({ status: 'completed', provider_reference: 'MPESA-RF-1', processed_at: expect.any(String) })
    expect((await call('POST', `${refundPath}/cancel/`, { token: billing.access, body: {} })).body).toEqual({ detail: 'Invalid refund transition: completed -> cancelled' })
    const view = (await call('GET', `${base}/invoices/${invoiceId}/`, { token: billing.access })).body.invoice
    expect(view).toMatchObject({ paid_amount: '40.00', balance: '60.00', status: 'partially_paid' })

    const rest = await call('POST', `${base}/payments/${paymentId}/refunds/`, { token: billing.access, body: { amount: '40.00', reason: 'Full refund' } })
    await call('POST', `${base}/refunds/${rest.body.refund_id}/complete/`, { token: billing.access, body: { provider_reference: 'MPESA-RF-2' } })
    expect((await call('GET', `${base}/invoices/${invoiceId}/`, { token: billing.access })).body.invoice).toMatchObject({ paid_amount: '0.00', status: 'refunded' })
    expect((await call('GET', `${base}/invoices/${invoiceId}/adjustments/`, { token: billing.access })).body.refunds.map((refund: { status: string }) => refund.status)).toEqual(['completed', 'completed'])

    const { query } = await import('../server/db')
    expect((await query(`SELECT event FROM audit_auditlog WHERE object_id = $1 ORDER BY id`, [first.body.refund_id])).map((row) => row.event)).toEqual(['refund_requested', 'payment_refunded'])
  })

  it('drafts, issues and applies credit notes without exceeding the invoice balance', async () => {
    const customer = await account('Customer')
    const billing = await account('Billing')
    const invoiceId = await invoice(customer.id, '80.00')
    const base = `/staff/customers/${customer.id}`
    const note = await call('POST', `${base}/invoices/${invoiceId}/credit-notes/`, { token: billing.access, body: { amount: '30.00', reason: 'Goodwill credit' } })
    expect(note).toMatchObject({ status: 201, body: { status: 'draft', amount: '30.00' } })
    // The draft already reserves 30.00, so only 50.00 more can be credited.
    expect((await call('POST', `${base}/invoices/${invoiceId}/credit-notes/`, { token: billing.access, body: { amount: '50.01', reason: 'Too much' } })).body).toEqual({ detail: 'Credit note amount exceeds the invoice balance.' })

    const notePath = `${base}/credit-notes/${note.body.credit_note_id}`
    expect((await call('POST', `${notePath}/apply/`, { token: billing.access, body: {} })).body).toEqual({ detail: 'Invalid credit note transition: draft -> applied' })
    expect((await call('POST', `${notePath}/issue/`, { token: billing.access, body: {} })).body).toMatchObject({ status: 'issued', issued_at: expect.any(String) })
    expect((await call('POST', `${notePath}/apply/`, { token: billing.access, body: {} })).body).toMatchObject({ status: 'applied', applied_at: expect.any(String) })
    expect((await call('GET', `${base}/invoices/${invoiceId}/`, { token: billing.access })).body.invoice).toMatchObject({ credited_amount: '30.00', balance: '50.00', status: 'issued' })

    const rest = await call('POST', `${base}/invoices/${invoiceId}/credit-notes/`, { token: billing.access, body: { amount: '50.00', reason: 'Write-off' } })
    await call('POST', `${base}/credit-notes/${rest.body.credit_note_id}/issue/`, { token: billing.access, body: {} })
    await call('POST', `${base}/credit-notes/${rest.body.credit_note_id}/apply/`, { token: billing.access, body: {} })
    expect((await call('GET', `${base}/invoices/${invoiceId}/`, { token: billing.access })).body.invoice).toMatchObject({ credited_amount: '80.00', balance: '0.00', status: 'paid' })
    expect((await call('POST', `${base}/credit-notes/${rest.body.credit_note_id}/nonsense/`, { token: billing.access, body: {} })).status).toBe(404)
  })
})
