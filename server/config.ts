import 'server-only'

/** Environment-backed settings. Names match the v1 Django settings so the same environment can be reused. */
function env(name: string, fallback = ''): string {
  const value = process.env[name]
  return value === undefined ? fallback : value.trim()
}

function required(name: string): string {
  const value = env(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export const settings = {
  get secretKey() {
    return required('SECRET_KEY')
  },
  get frontendUrl() {
    return env('FRONTEND_URL', env('APP_ORIGIN', 'http://localhost:3000')).replace(/\/+$/, '')
  },
  get isProduction() {
    return env('APP_ENV') === 'production'
  },
  /** Number of trusted reverse proxies that append to X-Forwarded-For (cPanel/Apache adds one). */
  get trustedProxyHops() {
    return Number.parseInt(env('TRUSTED_PROXY_HOPS', '1'), 10) || 0
  },
  email: {
    get host() { return env('EMAIL_HOST') },
    get port() { return Number.parseInt(env('EMAIL_PORT', '587'), 10) },
    get user() { return env('EMAIL_HOST_USER') },
    get password() { return env('EMAIL_HOST_PASSWORD') },
    get useTls() { return env('EMAIL_USE_TLS', 'true').toLowerCase() === 'true' },
    get useSsl() { return env('EMAIL_USE_SSL', 'false').toLowerCase() === 'true' },
    get timeoutSeconds() { return Number.parseInt(env('EMAIL_TIMEOUT', '15'), 10) },
    get subjectPrefix() { return env('EMAIL_SUBJECT_PREFIX', '[MavenHost] ') },
    get notificationsFrom() { return env('NOTIFICATIONS_FROM_EMAIL', 'MavenHost <notifications@maven-host.com>') },
    get noreplyFrom() { return env('NOREPLY_FROM_EMAIL', 'MavenHost <noreply@maven-host.com>') },
    get infoFrom() { return env('INFO_FROM_EMAIL', 'MavenHost <info@maven-host.com>') },
    get supportFrom() { return env('SUPPORT_FROM_EMAIL', 'MavenHost Support <support@maven-host.com>') },
    get developerFrom() { return env('DEVELOPER_FROM_EMAIL', 'MavenHost Developers <developers@maven-host.com>') },
    get billingFrom() { return env('BILLING_FROM_EMAIL', 'MavenHost Billing <billing@maven-host.com>') },
    get serverFrom() { return env('SERVER_EMAIL', 'MavenHost System <server@maven-host.com>') },
  },
  oauth: {
    google: {
      get clientId() { return env('GOOGLE_CLIENT_ID') },
      get clientSecret() { return env('GOOGLE_CLIENT_SECRET') },
      get redirectUri() { return env('GOOGLE_REDIRECT_URI') },
    },
    github: {
      get clientId() { return env('GITHUB_CLIENT_ID') },
      get clientSecret() { return env('GITHUB_CLIENT_SECRET') },
      get redirectUri() { return env('GITHUB_REDIRECT_URI') },
    },
  },
  throttleRate(scope: string): string | undefined {
    const defaults: Record<string, string> = {
      domain_search: '30/min',
      password_reset: '5/hour',
      login: '10/min',
      registration: '5/hour',
      email_verification: '10/hour',
      token_refresh: '30/min',
      payment_initiation: '10/min',
      payment_verification: '20/min',
      ai_generation: '5/hour',
      public_ai_generation: '3/day',
      seo_analysis: '20/min',
      website_publish: '10/min',
      wordpress_operations: '10/min',
      staff_management: '60/min',
      staff_invitation: '5/hour',
      chatbot: '30/hour',
      public_contact: '5/hour',
      domain_security: '20/hour',
      domain_auth_code: '5/hour',
    }
    if (!(scope in defaults)) return undefined
    return env(`THROTTLE_${scope.toUpperCase()}`, defaults[scope])
  },
}
