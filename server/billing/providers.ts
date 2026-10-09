import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import Decimal from 'decimal.js'
import { query } from '../db'
import { decryptProviderSecret } from '../lib/fernet'
import { pythonDumps } from '../lib/python-json'

/** Port of apps/billing/providers (Paystack, card via Paystack, M-Pesa Daraja STK push, manual). */

export type TransactionStatus = 'pending' | 'authorized' | 'completed' | 'failed' | 'cancelled' | 'expired'

export type ProviderResult = {
  status: TransactionStatus
  successful: boolean
  providerReference: string
  rawResponse: Record<string, unknown>
  amount?: string | null
  currency?: string | null
  providerEventId?: string | null
  providerReceipt?: string | null
}

export class PaymentProviderError extends Error {
  readonly ambiguous: boolean = false
}
export class PaymentProviderConfigurationError extends PaymentProviderError {}
export class PaymentProviderAuthenticationError extends PaymentProviderError {}
export class PaymentProviderRequestError extends PaymentProviderError {}
export class PaymentProviderResponseError extends PaymentProviderError {
  readonly ambiguous = true
}
export class PaymentProviderUnavailableError extends PaymentProviderError {
  readonly ambiguous = true
}
export class PaymentProviderWebhookError extends PaymentProviderError {}

export type Gateway = {
  id: string; name: string; slug: string; provider: string; sandbox: boolean; is_active: boolean; is_default: boolean
  callback_url: string; webhook_url: string; reconciliation_url: string; paybill_number: string; manual_payment_instructions: string
}

export type AuthorizationData = { transaction_id: string; provider_reference: string; amount: string; currency: string; gateway_slug: string; phone_number?: string; email?: string; transaction_description?: string }

export interface PaymentProvider {
  authorize(data: AuthorizationData): Promise<ProviderResult>
  verify(providerReference: string): Promise<ProviderResult>
  webhook(request: { payload: unknown; headers: Record<string, string>; rawBody: Buffer }): Promise<ProviderResult>
}

async function credentials(gateway: Gateway) {
  const rows = await query<{ key: string; value: string }>('SELECT key, value FROM billing_payment_gateway_credential WHERE gateway_id = $1', [gateway.id])
  return Object.fromEntries(rows.map((row) => [row.key, row.value ? decryptProviderSecret(row.value) : row.value])) as Record<string, string>
}

const subunits = (amount: Decimal.Value) => {
  const value = new Decimal(amount)
  if (value.lte(0)) throw new PaymentProviderConfigurationError('Payment amount must be greater than zero.')
  return value.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
}
const majorUnits = (value: unknown) => {
  if (value === undefined || value === null) return null
  try {
    return new Decimal(String(value)).div(100).toFixed(2)
  } catch {
    throw new PaymentProviderResponseError('Paystack returned an invalid transaction amount.')
  }
}

// --- Paystack ---

class PaystackProvider implements PaymentProvider {
  private config?: { secretKey: string; callbackUrl: string }

  /** `card` gateways use Paystack restricted to card channels and stay pending until verified. */
  constructor(private readonly gateway: Gateway, private readonly cardOnly = false) {}

  private async settings() {
    if (!this.config) {
      const values = await credentials(this.gateway)
      const missing = [...(values.secret_key ? [] : ['secret_key']), ...(this.gateway.callback_url ? [] : ['callback_url'])]
      if (missing.length) throw new PaymentProviderConfigurationError(`Missing Paystack configuration: ${missing.join(', ')}`)
      this.config = { secretKey: values.secret_key, callbackUrl: this.gateway.callback_url }
    }
    return this.config
  }

  private async request(method: string, path: string, payload?: unknown) {
    const { secretKey } = await this.settings()
    let response: Response
    try {
      response = await fetch(`https://api.paystack.co${path}`, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new PaymentProviderUnavailableError('Unable to communicate with Paystack.')
    }
    if (response.status === 401 || response.status === 403) throw new PaymentProviderAuthenticationError('Paystack authentication failed.')
    if (response.status === 429 || response.status >= 500) throw new PaymentProviderUnavailableError('Paystack is temporarily unavailable.')
    let data: Record<string, unknown>
    try {
      data = (await response.json()) as Record<string, unknown>
    } catch {
      throw new PaymentProviderResponseError('Paystack returned an invalid JSON response.')
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PaymentProviderResponseError('Paystack returned an invalid response structure.')
    if (!response.ok) throw new PaymentProviderRequestError(String(data.message ?? 'Paystack request was rejected.'))
    if (data.status !== true) throw new PaymentProviderRequestError(String(data.message ?? 'Paystack rejected the request.'))
    return data
  }

  async authorize(data: AuthorizationData): Promise<ProviderResult> {
    if (!data.email) throw new PaymentProviderConfigurationError('Customer email is required for Paystack payment authorization.')
    if (!data.provider_reference) throw new PaymentProviderConfigurationError('A provider reference is required for Paystack payment authorization.')
    const { callbackUrl } = await this.settings()
    // v1's card provider forwarded its internal payload (major-unit amount, no reference); both variants now send
    // Paystack's documented fields.
    const response = await this.request('POST', '/transaction/initialize', {
      amount: subunits(data.amount), email: data.email, currency: data.currency || 'KES', reference: data.provider_reference, callback_url: callbackUrl,
      ...(this.cardOnly ? { channels: ['card'] } : {}),
    })
    const result = response.data as Record<string, unknown> | undefined
    if (!result || typeof result !== 'object') throw new PaymentProviderResponseError('Paystack authorization response has no valid data object.')
    const reference = result.reference
    if (!reference) throw new PaymentProviderResponseError('Paystack authorization response has no reference.')
    return {
      status: this.cardOnly ? 'pending' : 'authorized', successful: !this.cardOnly, providerReference: String(reference), rawResponse: response,
      amount: majorUnits(result.amount), currency: (result.currency as string) ?? null, providerEventId: `authorization:${reference}`,
    }
  }

  async verify(providerReference: string): Promise<ProviderResult> {
    if (!providerReference) throw new PaymentProviderConfigurationError('Paystack verification requires a transaction reference.')
    const response = await this.request('GET', `/transaction/verify/${encodeURIComponent(providerReference)}`)
    const data = response.data as Record<string, unknown> | undefined
    if (!data || typeof data !== 'object') throw new PaymentProviderResponseError('Paystack verification response has no valid data object.')
    if (data.reference && String(data.reference) !== String(providerReference)) throw new PaymentProviderResponseError('Paystack verification reference does not match the requested transaction.')
    const status = paystackStatus(data.status)
    const reference = String(data.reference ?? providerReference)
    return { status, successful: status === 'completed', providerReference: reference, rawResponse: response, amount: majorUnits(data.amount), currency: (data.currency as string) ?? null, providerEventId: `verification:${reference}` }
  }

  async webhook({ payload, headers, rawBody }: { payload: unknown; headers: Record<string, string>; rawBody: Buffer }): Promise<ProviderResult> {
    const signature = headers['x-paystack-signature']
    if (!signature) throw new PaymentProviderWebhookError('Missing Paystack webhook signature.')
    const expected = createHmac('sha512', (await this.settings()).secretKey).update(rawBody).digest('hex')
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new PaymentProviderWebhookError('Invalid Paystack webhook signature.')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PaymentProviderWebhookError('Paystack webhook payload must be an object.')
    const body = payload as Record<string, unknown>
    const data = body.data as Record<string, unknown> | undefined
    if (!data || typeof data !== 'object') throw new PaymentProviderWebhookError('Paystack webhook has no valid data object.')
    if (!data.reference) throw new PaymentProviderWebhookError('Paystack webhook has no transaction reference.')
    let status: TransactionStatus
    if (body.event === 'charge.success') status = 'completed'
    else if (body.event === 'charge.failed') status = 'failed'
    else throw new PaymentProviderWebhookError(`Unsupported Paystack webhook event: ${JSON.stringify(body.event ?? null)}`)
    const eventId = createHash('sha256').update(pythonDumps(body, { sortKeys: true, compact: true })).digest('hex')
    return { status, successful: status === 'completed', providerReference: String(data.reference), rawResponse: body, amount: majorUnits(data.amount), currency: (data.currency as string) ?? null, providerEventId: `paystack:${eventId}` }
  }
}

function paystackStatus(value: unknown): TransactionStatus {
  if (value === 'success') return 'completed'
  if (value === 'failed' || value === 'abandoned' || value === 'reversed') return 'failed'
  if (value === 'pending' || value === 'ongoing' || value === 'processing' || value === 'queued') return 'pending'
  throw new PaymentProviderResponseError(`Unsupported Paystack transaction status: ${JSON.stringify(value ?? null)}`)
}

// --- M-Pesa (Daraja STK push) ---

export class MpesaProvider implements PaymentProvider {
  private config?: { consumerKey: string; consumerSecret: string; shortcode: string; passkey: string; callbackUrl: string; baseUrl: string }

  constructor(private readonly gateway: Gateway) {}

  private async settings() {
    if (!this.config) {
      const values = await credentials(this.gateway)
      const missing = ['consumer_key', 'consumer_secret', 'shortcode', 'passkey'].filter((key) => !values[key])
      if (!this.gateway.callback_url) missing.push('callback_url')
      if (missing.length) throw new PaymentProviderConfigurationError(`Missing M-Pesa configuration: ${missing.join(', ')}`)
      this.config = {
        consumerKey: values.consumer_key, consumerSecret: values.consumer_secret, shortcode: values.shortcode, passkey: values.passkey,
        callbackUrl: this.gateway.callback_url, baseUrl: this.gateway.sandbox ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke',
      }
    }
    return this.config
  }

  private async token() {
    const config = await this.settings()
    let response: Response
    try {
      response = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')}` },
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') throw new PaymentProviderUnavailableError('M-Pesa authentication endpoint timed out.')
      throw new PaymentProviderRequestError('Unable to reach M-Pesa authentication endpoint.')
    }
    if (response.status === 429 || response.status >= 500) throw new PaymentProviderUnavailableError('M-Pesa authentication endpoint is temporarily unavailable.')
    if (response.status >= 400) throw new PaymentProviderAuthenticationError('M-Pesa authentication failed.')
    const payload = (await response.json().catch(() => null)) as { access_token?: string } | null
    if (!payload?.access_token) throw new PaymentProviderAuthenticationError('M-Pesa response did not contain an access token.')
    return payload.access_token
  }

  private async request(path: string, payload: unknown) {
    const config = await this.settings()
    const token = await this.token()
    let response: Response
    try {
      response = await fetch(`${config.baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') throw new PaymentProviderUnavailableError('M-Pesa request timed out; provider outcome is unknown.')
      throw new PaymentProviderUnavailableError('Unable to reach M-Pesa; provider outcome may be unknown.')
    }
    if (response.status === 429 || response.status >= 500) throw new PaymentProviderUnavailableError('M-Pesa is temporarily unavailable; provider outcome may be unknown.')
    if (response.status >= 400) throw new PaymentProviderRequestError('M-Pesa rejected the request.')
    const result = await response.json().catch(() => null)
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new PaymentProviderResponseError('M-Pesa returned invalid JSON.')
    return result as Record<string, unknown>
  }

  /** Daraja timestamps are in East Africa Time. */
  private timestamp() {
    return new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14)
  }

  private async password(timestamp: string) {
    const config = await this.settings()
    return Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64')
  }

  static normalizePhone(value: string) {
    let phone = value.trim().replace(/[ -]/g, '')
    if (phone.startsWith('+')) phone = phone.slice(1)
    if (phone.startsWith('0')) phone = `254${phone.slice(1)}`
    if (!phone.startsWith('254')) throw new PaymentProviderConfigurationError('M-Pesa phone number must use Kenyan MSISDN format.')
    if (phone.length !== 12) throw new PaymentProviderConfigurationError('M-Pesa phone number must contain 12 digits after normalization.')
    if (!/^\d+$/.test(phone)) throw new PaymentProviderConfigurationError('M-Pesa phone number must contain digits only.')
    return phone
  }

  async authorize(data: AuthorizationData): Promise<ProviderResult> {
    if (!data.phone_number) throw new PaymentProviderConfigurationError('A phone number is required for M-Pesa STK Push.')
    const phone = MpesaProvider.normalizePhone(data.phone_number)
    const amount = new Decimal(data.amount)
    if (amount.lte(0)) throw new PaymentProviderConfigurationError('M-Pesa payment amount must be greater than zero.')
    if (!amount.isInteger()) throw new PaymentProviderConfigurationError('M-Pesa STK Push amounts must be whole KES amounts.')
    const config = await this.settings()
    const timestamp = this.timestamp()
    const response = await this.request('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: config.shortcode, Password: await this.password(timestamp), Timestamp: timestamp, TransactionType: 'CustomerPayBillOnline',
      Amount: amount.toNumber(), PartyA: phone, PartyB: config.shortcode, PhoneNumber: phone, CallBackURL: config.callbackUrl,
      AccountReference: data.provider_reference, TransactionDesc: data.transaction_description ?? 'Payment',
    })
    const successful = String(response.ResponseCode ?? '') === '0'
    const reference = String(response.CheckoutRequestID ?? '')
    if (successful && !reference) throw new PaymentProviderResponseError('M-Pesa authorization response did not contain a CheckoutRequestID.')
    return { status: successful ? 'pending' : 'failed', successful, providerReference: reference, rawResponse: response, providerEventId: String(response.MerchantRequestID || reference), currency: 'KES' }
  }

  private static resultStatus(code: string): TransactionStatus {
    if (code === '0') return 'completed'
    if (code === '1032') return 'cancelled'
    if (code === '1037') return 'expired'
    return 'failed'
  }

  async verify(providerReference: string): Promise<ProviderResult> {
    if (!providerReference) throw new PaymentProviderResponseError('M-Pesa verification requires a CheckoutRequestID.')
    const config = await this.settings()
    const timestamp = this.timestamp()
    const response = await this.request('/mpesa/stkpushquery/v1/query', { BusinessShortCode: config.shortcode, Password: await this.password(timestamp), Timestamp: timestamp, CheckoutRequestID: providerReference })
    if (response.ResultCode === undefined || response.ResultCode === null) throw new PaymentProviderResponseError('M-Pesa verification response did not contain ResultCode.')
    const status = MpesaProvider.resultStatus(String(response.ResultCode))
    return { status, successful: status === 'completed', providerReference, rawResponse: response, providerEventId: providerReference, currency: 'KES' }
  }

  async webhook({ payload }: { payload: unknown }): Promise<ProviderResult> {
    const body = payload as Record<string, unknown>
    if (!body || typeof body !== 'object') throw new PaymentProviderResponseError('M-Pesa callback response is invalid.')
    const envelope = (body.Body ?? {}) as Record<string, unknown>
    const callback = (envelope.stkCallback ?? {}) as Record<string, unknown>
    if (typeof envelope !== 'object' || typeof callback !== 'object') throw new PaymentProviderResponseError('M-Pesa stkCallback is invalid.')
    const reference = String(callback.CheckoutRequestID ?? '')
    if (!reference) throw new PaymentProviderResponseError('M-Pesa callback did not contain a CheckoutRequestID.')
    if (callback.ResultCode === undefined || callback.ResultCode === null) throw new PaymentProviderResponseError('M-Pesa callback did not contain ResultCode.')
    let amount: string | null = null
    let receipt: string | null = null
    const metadata = (callback.CallbackMetadata ?? {}) as Record<string, unknown>
    const items = metadata.Item ?? []
    if (!Array.isArray(items)) throw new PaymentProviderResponseError('M-Pesa callback metadata items are invalid.')
    for (const item of items as Record<string, unknown>[]) {
      if (!item || typeof item !== 'object') throw new PaymentProviderResponseError('M-Pesa callback metadata item is invalid.')
      if (item.Name === 'Amount' && item.Value !== undefined && item.Value !== null) amount = new Decimal(String(item.Value)).toFixed(2)
      if (item.Name === 'MpesaReceiptNumber' && item.Value !== undefined && item.Value !== null) receipt = String(item.Value)
    }
    const status = MpesaProvider.resultStatus(String(callback.ResultCode))
    return { status, successful: status === 'completed', providerReference: reference, rawResponse: body, amount, providerEventId: reference, providerReceipt: receipt, currency: 'KES' }
  }
}

// --- Manual ---

/**
 * v1 marked manual payments completed as soon as a customer selected the gateway (and on an unauthenticated webhook),
 * which let customers settle invoices without paying. Manual payments now stay pending until staff record them.
 */
class ManualProvider implements PaymentProvider {
  async authorize(data: AuthorizationData): Promise<ProviderResult> {
    return { status: 'pending', successful: false, providerReference: data.provider_reference, rawResponse: { provider: 'manual', status: 'awaiting_confirmation', transaction_id: data.transaction_id, provider_reference: data.provider_reference } }
  }
  async verify(providerReference: string): Promise<ProviderResult> {
    return { status: 'pending', successful: false, providerReference, rawResponse: { provider: 'manual', status: 'awaiting_confirmation', provider_reference: providerReference } }
  }
  async webhook(): Promise<ProviderResult> {
    throw new PaymentProviderWebhookError('Manual payments are confirmed by MavenHost staff.')
  }
}

let override: ((gateway: Gateway) => PaymentProvider | undefined) | null = null

/** Tests substitute providers; production uses the adapters above. */
export function setPaymentProviderOverride(factory: ((gateway: Gateway) => PaymentProvider | undefined) | null) {
  override = factory
}

/** PaymentProviderFactory.create */
export function paymentProvider(gateway: Gateway): PaymentProvider {
  const replaced = override?.(gateway)
  if (replaced) return replaced
  const name = gateway.provider.trim().toLowerCase()
  if (name === 'paystack') return new PaystackProvider(gateway)
  if (name === 'card') return new PaystackProvider(gateway, true)
  if (name === 'mpesa') return new MpesaProvider(gateway)
  if (name === 'manual') return new ManualProvider()
  throw new Error(`No payment provider registered for '${name}'.`)
}

