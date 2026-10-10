// Same-origin Next.js API; never forwards to the production Django server.
const API_BASE_URL = "/api/v1"

const ACCESS_TOKEN_KEY = 'mwh_access'
const REFRESH_TOKEN_KEY = 'mwh_refresh'
const GUEST_CART_TOKEN_KEY = 'mwh_guest_cart_token'

function guestCartHeaders(): Record<string, string> {
  let token = localStorage.getItem(GUEST_CART_TOKEN_KEY)
  if (!token) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(GUEST_CART_TOKEN_KEY, token)
  }
  return { 'X-Guest-Cart-Token': token }
}

export class ApiError extends Error {
  status: number
  code?: string
  fieldErrors?: Record<string, string[]>

  constructor(message: string, status: number, code?: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(access: string, refresh?: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, access)
  if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return request('/auth/verify-email/', { method: 'POST', body: { token }, auth: false })
}

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken()
  if (!refresh) return null
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('refresh failed')
        const data = await response.json()
        setTokens(data.access, data.refresh)
        return data.access as string
      })
      .catch(() => {
        clearTokens()
        return null
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function extractMessage(body: unknown, status: number): { message: string; code?: string; fieldErrors?: Record<string, string[]> } {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.detail === 'string') return { message: record.detail, code: record.code as string | undefined }
    if (typeof record.message === 'string') return { message: record.message, code: record.code as string | undefined }
    if (typeof record.error === 'string') return { message: record.error, code: record.code as string | undefined }
    if (Array.isArray(record.detail)) return { message: record.detail.join(' ') }
    if (typeof record.detail === 'object' && record.detail !== null) {
      const fieldErrors = record.detail as Record<string, string[]>
      const first = Object.values(fieldErrors)[0]
      return { message: Array.isArray(first) ? first[0] : 'Request failed.', fieldErrors }
    }
    // DRF default validation error shape: { field: ["msg"], non_field_errors: ["msg"] }
    const entries = Object.entries(record).filter(([, value]) => Array.isArray(value))
    if (entries.length > 0) {
      const [, messages] = entries[0]
      return { message: (messages as string[])[0], fieldErrors: record as Record<string, string[]> }
    }
  }
  return { message: `The server could not complete this request (HTTP ${status}). Please try again.` }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  auth?: boolean
  params?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  headers?: Record<string, string>
}

export type ContactRequestType = 'general' | 'support' | 'developer'

export async function submitContactRequest(payload: {
  request_type: ContactRequestType
  name: string
  email: string
  phone?: string
  subject: string
  message: string
}): Promise<{ id: string; message: string }> {
  return request<{ id: string; message: string }>('/contact/', {
    method: 'POST',
    auth: false,
    body: payload,
  })
}

/** Authenticated request for feature modules that keep their own typed client (e.g. staff administration). */
export const apiRequest = <T,>(path: string, options: RequestOptions = {}) => request<T>(path, options)

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const { method = 'GET', body, auth = true, params, signal, headers: extraHeaders } = options

  let url = `${API_BASE_URL}${path}`
  if (params) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    }
    const qs = query.toString()
    if (qs) url += `?${qs}`
  }

  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })

  if (response.status === 401 && auth && !isRetry && getRefreshToken()) {
    const newAccess = await refreshAccessToken()
    if (newAccess) return request<T>(path, options, true)
  }

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null

  if (!response.ok) {
    const { message, code, fieldErrors } = extractMessage(payload, response.status)
    throw new ApiError(message, response.status, code, fieldErrors)
  }

  return payload as T
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AccountType = 'admin' | 'staff' | 'customer'

export type CurrentUser = {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  is_email_verified: boolean
  date_joined: string
  account_type: AccountType
  access_planes: string[]
  roles: string[]
  permissions: string[]
}

type LoginResponse = { access: string; refresh: string; user: CurrentUser }

export async function login(email: string, password: string): Promise<CurrentUser> {
  const data = await request<LoginResponse>('/auth/login/', { method: 'POST', body: { email, password }, auth: false })
  setTokens(data.access, data.refresh)
  return data.user
}

export async function register(payload: {
  email: string
  password: string
  confirm_password: string
  first_name?: string
  last_name?: string
}): Promise<CurrentUser> {
  const data = await request<LoginResponse>('/auth/register/', { method: 'POST', body: payload, auth: false })
  setTokens(data.access, data.refresh)
  return data.user
}

export type OAuthProvider = 'google' | 'github'

export function startOAuth(provider: OAuthProvider, next = '/account'): void {
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account'
  const url = `${API_BASE_URL}/auth/oauth/${provider}/?${new URLSearchParams({ next: safeNext }).toString()}`
  window.location.assign(url)
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>('/auth/me/')
}

export type CustomerProfile = {
  email: string
  first_name: string
  last_name: string
  profile: {
    phone_number: string
    company: string
    country: string
    city: string
    address: string
    postal_code: string
    timezone: string
    preferred_currency: string
  }
}

export async function getCustomerProfile(): Promise<CustomerProfile> {
  return request<CustomerProfile>('/auth/profile/')
}

export async function updateCustomerProfile(payload: Partial<CustomerProfile> & { profile?: Partial<CustomerProfile['profile']> }): Promise<CustomerProfile> {
  const { profile, ...userFields } = payload
  return request<CustomerProfile>('/auth/profile/', { method: 'PATCH', body: { ...userFields, ...profile } })
}

export async function logout(): Promise<void> {
  const refresh = getRefreshToken()
  try {
    if (refresh) await request('/auth/logout/', { method: 'POST', body: { refresh } })
  } finally {
    clearTokens()
  }
}

// ---------------------------------------------------------------------------
// Public domain search (marketing homepage)
// ---------------------------------------------------------------------------

export type DomainPrice = { product_id: number; usd: string; kes?: string }

export type DomainSearchSuggestion = {
  domain: string
  available: boolean
  premium: boolean
  registration_price?: DomainPrice | null
}

export type DomainSearchResult = {
  domain: string
  available: boolean
  premium: boolean
  registrar: string
  prices: Record<string, DomainPrice>
  message?: string | null
  suggestions?: DomainSearchSuggestion[]
  next_offset?: number | null
}

export async function searchDomain(domain: string, years = 1, options: { signal?: AbortSignal; suggestionLimit?: number; suggestionOffset?: number } = {}): Promise<DomainSearchResult> {
  return request<DomainSearchResult>('/domains/search/', { method: 'GET', params: { domain, years, suggestion_limit: options.suggestionLimit, suggestion_offset: options.suggestionOffset }, signal: options.signal, auth: false })
}

// ---------------------------------------------------------------------------
// Staff accounts
// ---------------------------------------------------------------------------

export type StaffStatus = 'active' | 'suspended' | 'invited'

export type StaffUser = {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  is_email_verified: boolean
  status: StaffStatus
  date_joined: string
  roles: string[]
  permissions: string[]
}

export async function listStaff(): Promise<StaffUser[]> {
  return request<StaffUser[]>('/staff/')
}

export async function createStaff(payload: {
  email: string
  first_name?: string
  last_name?: string
  role: string
}): Promise<StaffUser> {
  return request<StaffUser>('/staff/', { method: 'POST', body: payload })
}

export async function updateStaff(id: string, payload: { first_name?: string; last_name?: string }): Promise<StaffUser> {
  return request<StaffUser>(`/staff/${id}/`, { method: 'PATCH', body: payload })
}

export async function suspendStaff(id: string): Promise<StaffUser> {
  return request<StaffUser>(`/staff/${id}/suspend/`, { method: 'POST' })
}

export async function activateStaff(id: string): Promise<StaffUser> {
  return request<StaffUser>(`/staff/${id}/activate/`, { method: 'POST' })
}

export async function resendStaffInvitation(id: string): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/staff/${id}/resend-invitation/`, { method: 'POST' })
}

export async function getStaffRoles(id: string): Promise<{ roles: string[] }> {
  return request<{ roles: string[] }>(`/staff/${id}/roles/`)
}

export async function setStaffRoles(id: string, roles: string[]): Promise<StaffUser> {
  return request<StaffUser>(`/staff/${id}/roles/`, { method: 'PUT', body: { roles } })
}

export async function acceptStaffInvitation(token: string, password: string, password_confirm: string, profile: { first_name: string; last_name: string }): Promise<StaffUser> {
  return request<StaffUser>('/staff/invitations/accept/', { method: 'POST', body: { token, password, password_confirm, ...profile }, auth: false })
}

// ---------------------------------------------------------------------------
// Authorization (roles / permission catalogue)
// ---------------------------------------------------------------------------

export type Role = { name: string; permissions: string[]; user_count: number }
export type PermissionCatalogEntry = { module: string; codename: string; name: string }

export async function listRoles(): Promise<Role[]> {
  return request<Role[]>('/authorization/roles/')
}

export async function listPermissions(): Promise<PermissionCatalogEntry[]> {
  return request<PermissionCatalogEntry[]>('/authorization/permissions/')
}

// ---------------------------------------------------------------------------
// Staff: customers
// ---------------------------------------------------------------------------

export type StaffCustomer = {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  is_email_verified: boolean
  status: 'active' | 'unverified' | 'suspended'
  company: string | null
  country: string | null
  date_joined: string
}

export type StaffCustomerDetail = StaffCustomer & {
  phone_number: string | null
  city: string | null
  address: string | null
  postal_code: string | null
  timezone: string | null
  preferred_currency: string | null
  roles: string[]
}

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }

export async function listCustomers(search: string, page: number): Promise<Page<StaffCustomer>> {
  return request<Page<StaffCustomer>>('/staff/customers/', { params: { search, page } })
}

export async function getCustomer(id: string): Promise<StaffCustomerDetail> {
  return request<StaffCustomerDetail>(`/staff/customers/${id}/`)
}

// ---------------------------------------------------------------------------
// Staff: customer domains
// ---------------------------------------------------------------------------

export type StaffCustomerDomain = {
  id: string
  domain_name: string
  registrar: string
  status: string
  expires_at: string | null
  auto_renew: boolean
}

export type StaffCustomerDomainDetail = StaffCustomerDomain & {
  tld: string | null
  registration_years: number
  locked: boolean
  privacy_enabled: boolean
}

export async function listCustomerDomains(customerId: string): Promise<StaffCustomerDomain[]> {
  return request<StaffCustomerDomain[]>(`/staff/customers/${customerId}/domains/`)
}

export async function getCustomerDomain(customerId: string, domainId: string): Promise<StaffCustomerDomainDetail> {
  return request<StaffCustomerDomainDetail>(`/staff/customers/${customerId}/domains/${domainId}/`)
}

export async function setCustomerDomainAutoRenew(customerId: string, domainId: string, autoRenew: boolean): Promise<StaffCustomerDomainDetail> {
  return request<StaffCustomerDomainDetail>(`/staff/customers/${customerId}/domains/${domainId}/auto-renew/`, {
    method: 'POST',
    body: { auto_renew: autoRenew },
  })
}

// ---------------------------------------------------------------------------
// Staff: customer hosting
// ---------------------------------------------------------------------------

export type StaffCustomerHosting = {
  id: number
  username: string
  primary_domain: string | null
  package_name: string | null
  server_name: string | null
  status: string
  is_suspended: boolean
  created_at: string
}

export type StaffCustomerHostingDetail = StaffCustomerHosting & {
  disk_usage_mb: number
  bandwidth_usage_mb: number
  disk_limit_mb: number
  bandwidth_limit_mb: number
  provisioned_at: string | null
  suspended_at: string | null
  terminated_at: string | null
}

export async function listCustomerHosting(customerId: string): Promise<StaffCustomerHosting[]> {
  return request<StaffCustomerHosting[]>(`/staff/customers/${customerId}/hosting/`)
}

export async function getCustomerHosting(customerId: string, accountId: number | string): Promise<StaffCustomerHostingDetail> {
  return request<StaffCustomerHostingDetail>(`/staff/customers/${customerId}/hosting/${accountId}/`)
}

// ---------------------------------------------------------------------------
// Staff: customer orders
// ---------------------------------------------------------------------------

export type StaffCustomerOrder = {
  order_id: string
  number: string
  status: string
  subtotal: string
  discount: string
  tax: string
  total: string
  currency: string
}

export type StaffCustomerOrderItem = {
  order_item_id: string
  product_type: string
  resource_id: string | null
  name: string
  description: string
  billing_cycle: string
  quantity: number
  unit_price: string
  discount: string
  tax: string
  total: string
}

export type StaffCustomerOrderDetail = { order: StaffCustomerOrder; items: StaffCustomerOrderItem[] }

export async function listCustomerOrders(customerId: string): Promise<StaffCustomerOrder[]> {
  return request<StaffCustomerOrder[]>(`/staff/customers/${customerId}/orders/`)
}

export async function getCustomerOrder(customerId: string, orderId: string): Promise<StaffCustomerOrderDetail> {
  return request<StaffCustomerOrderDetail>(`/staff/customers/${customerId}/orders/${orderId}/`)
}

// ---------------------------------------------------------------------------
// Staff: customer billing (invoices / payments)
// ---------------------------------------------------------------------------

export type StaffCustomerInvoice = {
  invoice_id: string
  number: string
  order_id: string
  status: string
  currency: string
  subtotal: string
  discount: string
  tax: string
  total: string
  paid_amount: string
  credited_amount: string
  balance: string
  due_date: string | null
}

export type StaffCustomerInvoiceItem = {
  invoice_item_id: string
  product_type: string
  name: string
  description: string
  resource_id: string | null
  billing_cycle: string | null
  quantity: number
  unit_price: string
  discount: string
  tax: string
  total: string
}

export type StaffCustomerInvoiceDetail = {
  invoice: StaffCustomerInvoice
  items: StaffCustomerInvoiceItem[]
  issued_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  payment_terms: number
  notes: string
}

export type StaffCustomerPayment = {
  payment_id: string
  invoice_id: string
  amount: string
  currency: string
  status: string
  method: string
  provider_reference: string
  created_at: string
}

export type StaffCustomerPaymentDetail = {
  payment: StaffCustomerPayment
  customer_reference: string
  processed_at: string | null
}

export async function listCustomerInvoices(customerId: string): Promise<StaffCustomerInvoice[]> {
  return request<StaffCustomerInvoice[]>(`/staff/customers/${customerId}/invoices/`)
}

export async function getCustomerInvoice(customerId: string, invoiceId: string): Promise<StaffCustomerInvoiceDetail> {
  return request<StaffCustomerInvoiceDetail>(`/staff/customers/${customerId}/invoices/${invoiceId}/`)
}

export async function listCustomerPayments(customerId: string): Promise<StaffCustomerPayment[]> {
  return request<StaffCustomerPayment[]>(`/staff/customers/${customerId}/payments/`)
}

export async function getCustomerPayment(customerId: string, paymentId: string): Promise<StaffCustomerPaymentDetail> {
  return request<StaffCustomerPaymentDetail>(`/staff/customers/${customerId}/payments/${paymentId}/`)
}

export type StaffRefund = { refund_id: string; payment_id: string; amount: string; status: string; reason: string; provider_reference: string; processed_at: string | null; created_at: string }
export type StaffCreditNote = { credit_note_id: string; invoice_id: string; amount: string; status: string; reason: string; issued_at: string | null; applied_at: string | null; created_at: string }

export async function getInvoiceAdjustments(customerId: string, invoiceId: string): Promise<{ refunds: StaffRefund[]; credit_notes: StaffCreditNote[] }> {
  return request(`/staff/customers/${customerId}/invoices/${invoiceId}/adjustments/`)
}

export async function createRefund(customerId: string, paymentId: string, input: { amount: string; reason: string }): Promise<StaffRefund> {
  return request(`/staff/customers/${customerId}/payments/${paymentId}/refunds/`, { method: 'POST', body: input })
}

export async function transitionRefund(customerId: string, refundId: string, action: 'process' | 'complete' | 'fail' | 'cancel', providerReference?: string): Promise<StaffRefund> {
  return request(`/staff/customers/${customerId}/refunds/${refundId}/${action}/`, { method: 'POST', body: providerReference ? { provider_reference: providerReference } : {} })
}

export async function createCreditNote(customerId: string, invoiceId: string, input: { amount: string; reason: string }): Promise<StaffCreditNote> {
  return request(`/staff/customers/${customerId}/invoices/${invoiceId}/credit-notes/`, { method: 'POST', body: input })
}

export async function transitionCreditNote(customerId: string, creditNoteId: string, action: 'issue' | 'apply' | 'cancel'): Promise<StaffCreditNote> {
  return request(`/staff/customers/${customerId}/credit-notes/${creditNoteId}/${action}/`, { method: 'POST', body: {} })
}

// ---------------------------------------------------------------------------
// Staff: customer support tickets
// ---------------------------------------------------------------------------

export type StaffCustomerTicket = {
  id: string
  number: string
  subject: string
  category: string
  priority: string
  status: string
  customer_email: string
  assigned_to_email: string | null
  created_at: string
  updated_at: string
}

export type StaffCustomerTicketMessage = {
  id: string
  author_email: string
  body: string
  internal_note: boolean
  created_at: string
}

export type StaffCustomerTicketDetail = StaffCustomerTicket & {
  description: string
  resolved_at: string | null
  closed_at: string | null
  messages: StaffCustomerTicketMessage[]
}

export async function listCustomerTickets(customerId: string): Promise<StaffCustomerTicket[]> {
  return request<StaffCustomerTicket[]>(`/staff/customers/${customerId}/support/tickets/`)
}

export async function getCustomerTicket(customerId: string, ticketId: string): Promise<StaffCustomerTicketDetail> {
  return request<StaffCustomerTicketDetail>(`/staff/customers/${customerId}/support/tickets/${ticketId}/`)
}

export async function assignCustomerTicket(customerId: string, ticketId: string, staffId: string): Promise<StaffCustomerTicketDetail> {
  return request<StaffCustomerTicketDetail>(`/staff/customers/${customerId}/support/tickets/${ticketId}/assign/`, {
    method: 'POST',
    body: { staff_id: staffId },
  })
}

export async function replyToCustomerTicket(customerId: string, ticketId: string, body: string): Promise<StaffCustomerTicketDetail> {
  return request<StaffCustomerTicketDetail>(`/staff/customers/${customerId}/support/tickets/${ticketId}/reply/`, {
    method: 'POST',
    body: { body },
  })
}

export async function addCustomerTicketInternalNote(customerId: string, ticketId: string, body: string): Promise<StaffCustomerTicketDetail> {
  return request<StaffCustomerTicketDetail>(`/staff/customers/${customerId}/support/tickets/${ticketId}/internal-note/`, {
    method: 'POST',
    body: { body },
  })
}

export async function resolveCustomerTicket(customerId: string, ticketId: string, reason?: string): Promise<StaffCustomerTicketDetail> {
  return request<StaffCustomerTicketDetail>(`/staff/customers/${customerId}/support/tickets/${ticketId}/resolve/`, {
    method: 'POST',
    body: { reason },
  })
}

export async function closeCustomerTicket(customerId: string, ticketId: string, reason?: string): Promise<StaffCustomerTicketDetail> {
  return request<StaffCustomerTicketDetail>(`/staff/customers/${customerId}/support/tickets/${ticketId}/close/`, {
    method: 'POST',
    body: { reason },
  })
}

export async function reopenCustomerTicket(customerId: string, ticketId: string, reason?: string): Promise<StaffCustomerTicketDetail> {
  return request<StaffCustomerTicketDetail>(`/staff/customers/${customerId}/support/tickets/${ticketId}/reopen/`, {
    method: 'POST',
    body: { reason },
  })
}

// ---------------------------------------------------------------------------
// Public hosting catalogue
// ---------------------------------------------------------------------------

export type HostingPlanPrice = {
  id: number
  billing_cycle: string
  currency: string
  price: string
  regular_price: string
  sale_price: string | null
  setup_fee: string
}

export type HostingPlan = {
  id: number
  name: string
  slug: string | null
  short_description: string
  description: string
  is_featured: boolean
  display_order: number
  verification_status: string
  verified_features: Record<string, string | number | boolean>
  proposed_features?: Record<string, string | number | boolean>
  advertised_offers?: { term: string; months: number; currency: string; total: string; renewal_total: string | null; monthly: string; renewal_monthly: string | null; starting_price?: boolean; vat_percent: string; vat_included: boolean }[]
  plan_type: string
  disk_space_mb: number | null
  bandwidth_mb: number | null
  max_websites: number | null
  max_child_accounts: number | null
  requires_quote: boolean
  specifications: Record<string, string | number | boolean | string[]>
  /** Legacy API alias for max_websites; use the website wording in UI. */
  max_domains: number | null
  max_databases: number | null
  max_email_accounts: number | null
  max_ftp_accounts: number | null
  backup_frequency: string | null
  supports_ssl: boolean | null
  prices: HostingPlanPrice[]
}

export async function listHostingPlans(params?: { currency?: string; billing_cycle?: string }): Promise<HostingPlan[]> {
  return request<HostingPlan[]>('/hosting/plans/', { auth: false, params })
}

// ---------------------------------------------------------------------------
// Shopping cart
// ---------------------------------------------------------------------------

export type CartItem = {
  checkout_blocked?: boolean
  item_id: string
  product_type: 'domain' | 'hosting' | 'ssl'
  resource_id: string
  name: string
  billing_cycle: string
  domain_name: string
  /** Domain items: a new registration or a renewal of an owned domain. */
  operation?: 'register' | 'renew' | null
  quantity: number
  unit_price: string
  discount: string
  total: string
}

export type CartSummary = {
  cart_id: string
  currency: string
  items: CartItem[]
  subtotal: string
  discount: string
  tax: string
  total: string
}

export type DisplayCurrency = { code: string; name: string; symbol: string; decimal_places: number; payment: boolean; rate: string | null; rate_updated_at: string | null }
export type CurrencyCatalog = { base: string; default: string; payment_currencies: string[]; currencies: DisplayCurrency[]; attribution: { label: string; url: string } }

export async function listCurrencies(): Promise<CurrencyCatalog> {
  return request<CurrencyCatalog>('/currencies/', { auth: false })
}

export async function getCart(): Promise<CartSummary> {
  return request<CartSummary>('/orders/cart/', { headers: guestCartHeaders() })
}

export async function addDomainToCart(params: {
  resource_id: string | number
  billing_cycle?: string
  domain: string
  currency?: 'USD' | 'KES'
}): Promise<{ cart_id: string; item_id: string }> {
  return request('/orders/cart/', {
    method: 'POST',
    headers: guestCartHeaders(),
    body: {
      product_type: 'domain',
      resource_id: String(params.resource_id),
      billing_cycle: params.billing_cycle ?? 'annually',
      quantity: 1,
      configuration: { domain: params.domain },
      currency: params.currency,
    },
  })
}

export async function addHostingToCart(params: {
  resource_id: number
  billing_cycle: string
  domain?: string
  domain_id?: string
}): Promise<{ cart_id: string; item_id: string }> {
  const configuration: Record<string, unknown> = {}
  if (params.domain_id) configuration.domain_id = params.domain_id
  if (params.domain) configuration.domain = params.domain
  return request('/orders/cart/', {
    method: 'POST',
    headers: guestCartHeaders(),
    body: {
      product_type: 'hosting',
      resource_id: String(params.resource_id),
      billing_cycle: params.billing_cycle,
      quantity: 1,
      configuration,
    },
  })
}

export async function updateCartItemQuantity(itemId: string, quantity: number): Promise<CartSummary> {
  return request<CartSummary>(`/orders/cart/items/${itemId}/`, { method: 'PATCH', body: { quantity }, headers: guestCartHeaders() })
}

export async function removeCartItem(itemId: string): Promise<void> {
  return request(`/orders/cart/items/${itemId}/`, { method: 'DELETE', headers: guestCartHeaders() })
}

export async function clearCart(): Promise<void> {
  return request('/orders/cart/clear/', { method: 'DELETE', headers: guestCartHeaders() })
}

// ---------------------------------------------------------------------------
// Checkout & orders
// ---------------------------------------------------------------------------

export type CheckoutResult = {
  order_id: string
  order_number: string
  invoice_id: string | null
  invoice_number: string | null
}

export async function checkout(notes = '', hostingPasswords: Record<string, string> = {}, hostingDomains: Record<string, string> = {}, domainContact?: Record<string, string>): Promise<CheckoutResult> {
  return request<CheckoutResult>('/orders/checkout/', { method: 'POST', body: { notes, hosting_passwords: hostingPasswords, hosting_domains: hostingDomains, ...(domainContact ? { domain_contact: domainContact } : {}) } })
}

export type OrderSummary = {
  order_id: string
  number: string
  status: string
  subtotal: string
  discount: string
  tax: string
  total: string
  currency: string
}

export type OrderItem = {
  id: string
  product_type: string
  resource_id: string
  name: string
  description: string
  billing_cycle: string
  quantity: number
  unit_price: string
  discount: string
  tax: string
  total: string
}

export type OrderDetail = { order: OrderSummary; items: OrderItem[] }

export async function listOrders(): Promise<OrderSummary[]> {
  return request<OrderSummary[]>('/orders/')
}

export async function getOrder(orderId: string): Promise<OrderDetail> {
  return request<OrderDetail>(`/orders/${orderId}/`)
}

export async function cancelOrder(orderId: string): Promise<OrderDetail> {
  // The backend answers 204 No Content (apps/orders/api/views/order.py), so
  // re-read the order to give callers its updated state.
  await request<void>(`/orders/${orderId}/cancel/`, { method: 'POST' })
  return getOrder(orderId)
}

// ---------------------------------------------------------------------------
// Billing: gateways, invoices, payments
// ---------------------------------------------------------------------------

export type PaymentGateway = {
  slug: string
  name: string
  provider: string
  sandbox: boolean
  is_default: boolean
  paybill_number: string
  manual_payment_instructions: string
}

export async function listPaymentGateways(): Promise<PaymentGateway[]> {
  return request<PaymentGateway[]>('/billing/gateways/')
}

export type InvoiceSummary = {
  invoice_id: string
  number: string
  customer_id: string
  order_id: string
  status: string
  currency: string
  subtotal: string
  discount: string
  tax: string
  total: string
  paid_amount: string
  credited_amount: string
  balance: string
  due_date: string | null
}

export type InvoiceItem = {
  invoice_item_id: string
  product_type: string
  name: string
  description: string
  resource_id: string | null
  billing_cycle: string | null
  quantity: number
  unit_price: string
  discount: string
  tax: string
  total: string
}

export type InvoiceDetail = {
  invoice: InvoiceSummary
  items: InvoiceItem[]
  issued_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  payment_terms: number
  notes: string
}

export async function listInvoices(): Promise<InvoiceSummary[]> {
  return request<InvoiceSummary[]>('/billing/invoices/')
}

export async function getInvoice(invoiceId: string): Promise<InvoiceDetail> {
  return request<InvoiceDetail>(`/billing/invoices/${invoiceId}/`)
}

export type PaymentInitiateResult = {
  transaction_id: string
  invoice_id: string
  amount: string
  status: string
  provider_reference: string
  authorization_url?: string | null
}

export async function initiateInvoicePayment(
  invoiceId: string,
  payload: { gateway_slug: string; phone_number?: string; idempotency_key?: string },
): Promise<PaymentInitiateResult> {
  return request<PaymentInitiateResult>(`/billing/invoices/${invoiceId}/payments/`, { method: 'POST', body: payload })
}

export type PaymentVerifyResult = {
  successful: boolean
  status: string
  provider_reference: string
  transaction_id: string | null
}

export async function verifyPaymentTransaction(transactionId: string): Promise<PaymentVerifyResult> {
  return request<PaymentVerifyResult>(`/billing/transactions/${transactionId}/verify/`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Customer: my domains
// ---------------------------------------------------------------------------

export type MyDomain = {
  id: string
  domain_name: string
  registrar: string
  status: string
  expires_at: string | null
  auto_renew: boolean
}

export type MyDomainDetail = MyDomain & {
  tld: string | null
  registration_years: number
  locked: boolean
  privacy_enabled: boolean
}

export async function listMyDomains(): Promise<MyDomain[]> {
  return request<MyDomain[]>('/domains/customer/domains/')
}

export async function getMyDomain(id: string): Promise<MyDomainDetail> {
  return request<MyDomainDetail>(`/domains/customer/domains/${id}/`)
}

export type DNSRecord = {
  id: string | null
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV' | 'CAA'
  host: string
  value: string
  ttl: number
  priority?: number | null
  flag?: number | null
  tag?: string
  weight?: number | null
  port?: number | null
  protocol?: string
}

export async function listDomainDNSRecords(domainId: string): Promise<DNSRecord[]> {
  const result = await request<{ records: DNSRecord[] }>(`/domains/customer/domains/${domainId}/dns-records/`)
  return result.records
}

export async function createDomainDNSRecord(domainId: string, record: Omit<DNSRecord, 'id'>): Promise<void> {
  await request(`/domains/customer/domains/${domainId}/dns-records/`, { method: 'POST', body: { record } })
}

export async function deleteDomainDNSRecord(domainId: string, recordId: string): Promise<void> {
  await request(`/domains/customer/domains/${domainId}/dns-records/${encodeURIComponent(recordId)}/`, { method: 'DELETE' })
}

export async function listDomainNameservers(domainId: string): Promise<string[]> {
  const result = await request<{ nameservers: { hostname: string }[] }>(`/domains/customer/domains/${domainId}/nameservers/`)
  return result.nameservers.map(({ hostname }) => hostname)
}

export async function updateDomainNameservers(domainId: string, nameservers: string[]): Promise<void> {
  await request(`/domains/customer/domains/${domainId}/nameservers/`, {
    method: 'PUT',
    body: { nameservers: nameservers.map((hostname) => ({ hostname })) },
  })
}

// ---------------------------------------------------------------------------
// Customer: my hosting accounts
// ---------------------------------------------------------------------------

export type MyHostingAccountSummary = {
  account_id: string
  username: string
  primary_domain: string
  package_name: string
  server_name: string
  status: string
}

export type MyHostingAccountDetail = MyHostingAccountSummary & {
  disk_used_mb: number
  disk_limit_mb: number
  bandwidth_used_mb: number
  bandwidth_limit_mb: number
  dedicated_ip: string | null
  created_at: string
  suspended: boolean
}

export async function listMyHostingAccounts(): Promise<MyHostingAccountSummary[]> {
  const data = await request<{ accounts: MyHostingAccountSummary[] }>('/hosting/accounts/')
  return data.accounts
}

export async function getMyHostingAccount(accountId: string): Promise<MyHostingAccountDetail> {
  const data = await request<{ account: MyHostingAccountDetail }>('/hosting/accounts/', { params: { account_id: accountId } })
  return data.account
}

export type ResellerChild = {
  id: string
  domain: string
  username: string
  status: string
  created_at: string
  provisioned_at: string | null
}

export type ResellerPackageOption = { id: number; package_name: string; plan_name: string }
export type ResellerChildCatalog = {
  accounts: ResellerChild[]
  account_limit: number
  accounts_in_use: number
  packages: ResellerPackageOption[]
}

export async function getResellerChildAccounts(accountId: string): Promise<ResellerChildCatalog> {
  return request<ResellerChildCatalog>('/hosting/reseller/accounts/', { params: { reseller_account_id: accountId } })
}

export async function createResellerChildAccount(input: {
  reseller_account_id: string; package_id: number; domain: string; username: string; password: string; contact_email: string
}): Promise<ResellerChild> {
  return request<ResellerChild>('/hosting/reseller/accounts/', { method: 'POST', body: input })
}

export type HostingBackup = {
  backup_identifier: string
  filename: string
  size_bytes: number | null
  created_at: string
}

export type HostingOperation = {
  operation_id: string
  account_id: string
  operation_type: string
  status: string
  message?: string | null
}

export async function listHostingBackups(accountId: string): Promise<HostingBackup[]> {
  const result = await request<{ backups: HostingBackup[] }>('/hosting/accounts/backups/', { params: { account_id: accountId } })
  return result.backups
}

export async function createHostingBackup(accountId: string): Promise<HostingOperation> {
  return request<HostingOperation>('/hosting/accounts/backup/', { method: 'POST', body: { account_id: accountId } })
}

export async function restoreHostingBackup(accountId: string, backupIdentifier: string): Promise<HostingOperation> {
  return request<HostingOperation>('/hosting/accounts/backup/restore/', { method: 'POST', body: { account_id: accountId, backup_identifier: backupIdentifier } })
}

// ---------------------------------------------------------------------------
// Public blog
// ---------------------------------------------------------------------------

export type BlogCategory = {
  name: string
  slug: string
  description: string
  post_count: number
}

export type BlogTag = {
  name: string
  slug: string
  post_count: number
}

export type BlogPostSummary = {
  id: string
  title: string
  slug: string
  author: string
  category: BlogCategory | null
  tags: BlogTag[]
  excerpt: string
  featured_image_url: string
  is_featured: boolean
  published_at: string
  reading_time_minutes: number
  seo_title: string
  seo_description: string
}

export type BlogPostDetail = BlogPostSummary & {
  content: string
  created_at: string
  updated_at: string
}

export type BlogPostPage = {
  count: number
  next: string | null
  previous: string | null
  results: BlogPostSummary[]
}

export async function listBlogPosts(params?: {
  search?: string
  category?: string
  tag?: string
  featured?: boolean
  page?: number
  page_size?: number
}): Promise<BlogPostPage> {
  return request<BlogPostPage>('/blog/', {
    auth: false,
    params: {
      ...params,
      featured: params?.featured === undefined ? undefined : String(params.featured),
      page: params?.page === undefined ? undefined : String(params.page),
      page_size: params?.page_size === undefined ? undefined : String(params.page_size),
    },
  })
}

export async function getBlogPost(slug: string): Promise<BlogPostDetail> {
  return request<BlogPostDetail>(`/blog/${slug}/`, { auth: false })
}

export async function listBlogCategories(): Promise<BlogCategory[]> {
  return request<BlogCategory[]>('/blog/categories/', { auth: false })
}

// ---------------------------------------------------------------------------
// Public AI website builder and website SEO
// ---------------------------------------------------------------------------

export type GeneratedWebsiteSection = {
  type: string
  heading?: string
  subheading?: string
  body?: string
  cta?: string
  cta_url?: string
  items?: Array<{
    title?: string
    description?: string
    question?: string
    answer?: string
    image_url?: string
    alt?: string
  }>
}

export type GeneratedWebsitePage = {
  slug: string
  title: string
  page_type: string
  seo_title: string
  seo_description: string
  content: { sections?: GeneratedWebsiteSection[]; [key: string]: unknown }
}

export type PublicWebsiteGeneration = {
  id: string
  status: 'succeeded' | 'failed' | 'running' | 'claimed' | 'expired'
  visitor_token: string
  website_name: string
  pages: GeneratedWebsitePage[]
  expires_at: string
  created_at: string
}

export type ClaimedWebsite = {
  id: string
  name: string
  status: string
  pages: Array<{ id: string; title: string; slug: string }>
}

export type CustomerWebsite = ClaimedWebsite & {
  slug: string
  status: string
  generation_status: string
  publication_status: string
  domain_name: string | null
}

export type SEOFinding = {
  id: string
  page_id: string | null
  code: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  recommendation: string
}

export type SEOAnalysis = {
  id: string
  status: string
  score: number
  findings: SEOFinding[]
  started_at: string
  completed_at: string | null
  created_at: string
}

export async function generatePublicWebsite(brief: string, visitorToken?: string): Promise<PublicWebsiteGeneration> {
  return request<PublicWebsiteGeneration>('/ai/public/website-generations/', {
    method: 'POST',
    body: { brief, ...(visitorToken ? { visitor_token: visitorToken } : {}) },
    auth: false,
  })
}

export async function claimPublicWebsiteGeneration(generationId: string, visitorToken: string): Promise<ClaimedWebsite> {
  return request<ClaimedWebsite>(`/ai/public/website-generations/${generationId}/claim/`, {
    method: 'POST',
    headers: { 'X-Maven-Visitor-Token': visitorToken },
  })
}

export async function analyzeWebsiteSEO(websiteId: string): Promise<SEOAnalysis> {
  return request<SEOAnalysis>(`/websites/${websiteId}/seo/analyze/`, { method: 'POST' })
}

export async function listMyWebsites(): Promise<CustomerWebsite[]> {
  return request<CustomerWebsite[]>('/websites/')
}

export type EditableWebsitePage = GeneratedWebsitePage & { id: string }

export async function listWebsitePages(websiteId: string): Promise<EditableWebsitePage[]> {
  return request(`/websites/${websiteId}/pages/`)
}

export async function saveWebsitePage(websiteId: string, page: EditableWebsitePage): Promise<EditableWebsitePage> {
  return request(`/websites/${websiteId}/pages/${page.id}/`, {
    method: 'PATCH',
    body: { title: page.title, seo_title: page.seo_title, seo_description: page.seo_description, content: page.content },
  })
}


// ---------------------------------------------------------------------------
// Maven Assistant
// ---------------------------------------------------------------------------

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Public Maven Assistant contract.
 *
 * The frontend keeps the transport here so the assistant UI does not know
 * anything about HTTP paths. The backend endpoint can be introduced without
 * changing the component contract.
 */
export async function chatWithMaven(messages: ChatMessage[]): Promise<string> {
  const data = await request<{ answer?: string; message?: string }>('/ai/chat/', {
    method: 'POST',
    body: { messages },
    auth: false,
  })

  const answer = data.answer ?? data.message
  if (!answer) {
    throw new ApiError('Maven Assistant returned an empty response.', 502)
  }
  return answer
}


export type HostingSubscription = {
  id: number; plan: string; plan_slug: string | null; primary_domain: string;
  account_id: string; retail_price: string; currency: string; billing_cycle: string;
  status: string; starts_at: string; renews_at: string | null; auto_renew: boolean;
}
export async function listHostingSubscriptions(): Promise<HostingSubscription[]> {
  return request<HostingSubscription[]>('/hosting/subscriptions/')
}
