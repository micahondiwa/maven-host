import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
process.env.SECRET_KEY = 'synthetic-admin-secret'
if (url) {
  process.env.DATABASE_URL = url
  process.env.LOCAL_DATABASE_ONLY = 'true'
}

suite('staff administration', () => {
  let api: typeof import('../server/api')
  let ip = 0
  const run = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`

  async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.4.${++ip % 250}` }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const response = await api.handleApi(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function staff(role: 'Platform Administrator' | 'Billing' | 'Support') {
    const { transaction } = await import('../server/db')
    const { createUser, addToGroup } = await import('../server/accounts/users')
    const email = `admin-${role.replace(' ', '')}-${run}-${++ip}@example.test`
    await transaction(async (client) => {
      const user = await createUser(client, { email, password: 'Synthetic-pass-123', is_staff: true, is_email_verified: true })
      await addToGroup(client, user.id, role)
    })
    return (await call('POST', '/auth/login/', { body: { email, password: 'Synthetic-pass-123' } })).body.access as string
  }

  beforeAll(async () => {
    api = await import('../server/api')
    const { transaction } = await import('../server/db')
    await transaction(async (client) => (await import('../server/auth/permissions')).syncPermissions(client))
  })
  beforeEach(async () => (await import('../server/http/throttle')).resetThrottles())
  afterAll(async () => (await import('../server/db')).database().end())

  it('shows each role only the resources its permissions allow', async () => {
    const admin = await staff('Platform Administrator')
    const billing = await staff('Billing')
    const support = await staff('Support')
    const keys = async (token: string) => ((await call('GET', '/staff/admin/', { token })).body as { key: string }[]).map((item) => item.key)
    expect(await keys(admin)).toEqual(expect.arrayContaining(['hosting-plans', 'payment-gateways', 'gateway-credentials', 'pricing-rules', 'audit-log', 'outbox-events']))
    const billingKeys = await keys(billing)
    expect(billingKeys).toContain('payment-gateways')
    expect(billingKeys).not.toContain('gateway-credentials')
    expect(billingKeys).not.toContain('hosting-plans')
    expect((await call('GET', '/staff/admin/gateway-credentials/', { token: support })).status).toBe(404)
    const gateways = await call('GET', '/staff/admin/payment-gateways/', { token: billing })
    expect(gateways.body.meta).toMatchObject({ can_manage: false, can_create: false })
    expect((await call('POST', '/staff/admin/payment-gateways/', { token: billing, body: { name: 'x', slug: 'x', provider: 'manual' } })).status).toBe(403)
  })

  it('creates gateways with write-only encrypted credentials and audits every change', async () => {
    const admin = await staff('Platform Administrator')
    expect((await call('POST', '/staff/admin/payment-gateways/', { token: admin, body: { name: 'Bad', slug: `bad-${run}`, provider: 'bitcoin' } })).body).toEqual({ provider: ['"bitcoin" is not a valid choice.'] })
    const gateway = await call('POST', '/staff/admin/payment-gateways/', { token: admin, body: { name: `Paystack ${run}`, slug: `paystack-${run}`, provider: 'paystack' } })
    expect(gateway).toMatchObject({ status: 201, body: { provider: 'paystack', is_active: false, sandbox: true } })
    const credential = await call('POST', '/staff/admin/gateway-credentials/', { token: admin, body: { gateway_id: gateway.body.id, key: 'secret_key', value: 'sk_test_synthetic_value' } })
    expect(credential.body).toMatchObject({ key: 'secret_key', value: '••••••••', gateway_id__label: `Paystack ${run}` })
    expect(JSON.stringify(credential.body)).not.toContain('sk_test_synthetic_value')

    const { queryOne, query } = await import('../server/db')
    const { decryptProviderSecret } = await import('../server/lib/fernet')
    const stored = (await queryOne<{ value: string }>('SELECT value FROM billing_payment_gateway_credential WHERE id = $1', [credential.body.id]))!.value
    expect(stored).not.toContain('sk_test')
    expect(decryptProviderSecret(stored)).toBe('sk_test_synthetic_value')

    const updated = await call('PATCH', `/staff/admin/payment-gateways/${gateway.body.id}/`, { token: admin, body: { is_active: true, is_default: true, provider: 'card' } })
    expect(updated.body).toMatchObject({ is_active: true, is_default: true, provider: 'card' })
    expect((await queryOne<{ n: number }>('SELECT count(*)::integer AS n FROM billing_payment_gateway WHERE is_default'))!.n).toBe(1)
    await call('PATCH', `/staff/admin/gateway-credentials/${credential.body.id}/`, { token: admin, body: { value: 'sk_test_rotated' } })
    const audits = await query<{ event: string; metadata: { changes?: Record<string, { from: unknown; to: unknown }> } }>(`SELECT event, metadata FROM audit_auditlog WHERE object_id = ANY($1) ORDER BY id`, [[gateway.body.id, credential.body.id]])
    expect(audits.map((row) => row.event)).toEqual(['admin_record_created', 'admin_record_created', 'admin_record_updated', 'admin_record_updated'])
    expect(audits[2].metadata.changes).toMatchObject({ provider: { from: 'paystack', to: 'card' }, is_active: { from: false, to: true } })
    expect(audits[3].metadata.changes).toEqual({ value: { from: '[hidden]', to: '[changed]' } })
    expect(JSON.stringify(audits)).not.toContain('sk_test')
  })

  it('stamps package verification, validates values and runs eligible actions only', async () => {
    const admin = await staff('Platform Administrator')
    const { queryOne, database } = await import('../server/db')
    const plan = await call('POST', '/staff/admin/hosting-plans/', { token: admin, body: { name: `Admin plan ${run}`, slug: `admin-plan-${run}`, plan_type: 'shared' } })
    expect(plan.body).toMatchObject({ is_active: false, requires_quote: true })
    expect((await call('PATCH', `/staff/admin/hosting-plans/${plan.body.id}/`, { token: admin, body: { slug: 'Bad Slug' } })).body).toEqual({ slug: ['Use lowercase letters, numbers and single hyphens.'] })
    const supplier = (await queryOne<{ id: number }>(`SELECT id FROM hosting_hostingprovider WHERE supplier_code = 'twentyi'`))!.id
    const pkg = await call('POST', '/staff/admin/hosting-packages/', { token: admin, body: { hosting_plan_id: plan.body.id, provider_id: supplier, package_name: '811' } })
    expect(pkg.body).toMatchObject({ is_provider_verified: false, last_verified_at: null, provider_id__label: '20i' })
    expect((await call('PATCH', `/staff/admin/hosting-packages/${pkg.body.id}/`, { token: admin, body: { wholesale_cost: '1.234' } })).body).toEqual({ wholesale_cost: ['Enter a number with at most 2 decimal places.'] })
    const verified = await call('PATCH', `/staff/admin/hosting-packages/${pkg.body.id}/`, { token: admin, body: { is_provider_verified: true, verified_entitlements: { websites: 1, storage_mb: 10240 } } })
    expect(verified.body).toMatchObject({ is_provider_verified: true, last_verified_at: expect.any(String), verified_entitlements: { websites: 1, storage_mb: 10240 } })

    const failed = randomUUID()
    await database().query(
      `INSERT INTO core_events_outbox (id, event_id, occurred_at, event_name, payload, dedupe_key, status, attempts, available_at, last_error, created_at, updated_at)
       VALUES ($1, $1, CURRENT_TIMESTAMP, $2, '{}', NULL, 'failed', 3, CURRENT_TIMESTAMP + INTERVAL '1 hour', 'handler_failed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [failed, `synthetic.admin.${run}`],
    )
    expect((await call('POST', `/staff/admin/outbox-events/${failed}/actions/retry-now/`, { token: admin })).status).toBe(200)
    await database().query(`UPDATE core_events_outbox SET status = 'completed' WHERE id = $1`, [failed])
    expect((await call('POST', `/staff/admin/outbox-events/${failed}/actions/retry-now/`, { token: admin })).body).toEqual({ detail: 'Retry now is not available for this record.' })
    expect((await call('GET', `/staff/admin/outbox-events/?filter_status=completed&search=synthetic.admin.${run}`, { token: admin })).body).toMatchObject({ count: 1 })
  })
})
