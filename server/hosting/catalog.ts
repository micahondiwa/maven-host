import 'server-only'
import { query, type Queryable, database } from '../db'
import { ValidationError, notFound } from '../http/errors'

/** Port of apps/hosting/api/views/catalog.py and services/product_availability.py. */

const COMMON_FEATURES = [
  'processor', 'http2', 'http3', 'opcache', 'quic_cloud', 'cloudflare', 'file_manager', 'panel_languages',
  'dns_management', 'git', 'wp_brute_force_protection', 'ddos_protection', 'php_management', 'ssh', 'sftp_ftps',
  'wp_cli', 'phpmyadmin', 'python_cli', 'mariadb', 'managed_infrastructure', 'security_patches', 'redundant_network',
  'redundant_power', 'webmail', 'pop3', 'imap', 'smtp', 'autoresponders', 'spam_filtering', 'global_email_filters',
  'softaculous', 'webalizer', 'vulnerability_stats', 'access_logs', 'php_versions',
]

export const PUBLIC_ENTITLEMENT_KEYS = new Set([
  'websites', 'child_accounts', 'storage_mb', 'bandwidth_mb', 'control_panel', 'ssl', 'email', 'spam_filtering',
  'databases', 'ftp', 'cron', 'php_management', 'backup_retention_days', 'assisted_migration', 'domain_connection',
  'support_level', 'cpu_cores', 'memory_gb', 'storage_gb', 'storage_type', 'bandwidth', 'max_email_accounts',
  'max_databases', 'litespeed', 'patchman_included', 'dedicated_ipv4', 'backup_retention', 'inodes', 'white_label',
  'imunify360', 'cloudlinux', 'ipv6', 'whmcs', ...COMMON_FEATURES, 'object_caching', 'storage_configuration',
  'cpu_threads', 'network_port',
])

const OFFER_KEYS = new Set(['term', 'months', 'currency', 'total', 'renewal_total', 'monthly', 'renewal_monthly', 'vat_percent', 'vat_included', 'starting_price'])

type Json = Record<string, unknown>
type PlanRow = {
  id: number; name: string; slug: string | null; short_description: string; description: string; is_featured: boolean
  display_order: number; plan_type: string; requires_quote: boolean; requires_verified_mapping: boolean; is_active: boolean
  target_entitlements: Json
}
type PackageRow = { hosting_plan_id: number; verified_entitlements: unknown; is_default: boolean; id: number; is_reseller_package: boolean; provider_type: string }

const isScalar = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value)
const publicSubset = (source: Json) => Object.fromEntries(Object.entries(source).filter(([key, value]) => PUBLIC_ENTITLEMENT_KEYS.has(key) && isScalar(value)))

export function knownHostTransactionsEnabled() {
  return process.env.KNOWNHOST_ENABLED === 'true' && process.env.KNOWNHOST_TRANSACTIONS_ENABLED === 'true'
}

/** `verified_packages(plan)`: packages that may actually be provisioned for a plan. */
export async function verifiedPackages(planIds: number[], db: Queryable = database()): Promise<PackageRow[]> {
  if (!planIds.length) return []
  return query<PackageRow>(
    `SELECT DISTINCT pkg.id, pkg.hosting_plan_id, pkg.verified_entitlements, pkg.is_default, pkg.is_reseller_package, prov.provider_type
       FROM hosting_hostingpackage pkg
       JOIN hosting_hostingplan plan ON plan.id = pkg.hosting_plan_id
       JOIN hosting_hostingprovider prov ON prov.id = pkg.provider_id
      WHERE pkg.hosting_plan_id = ANY($1) AND pkg.is_active AND pkg.is_provider_verified AND pkg.is_provisionable
        AND pkg.last_verified_at IS NOT NULL AND prov.is_active AND pkg.package_name <> ''
        AND prov.supplier_code <> 'centralnic'
        AND EXISTS (SELECT 1 FROM hosting_server s WHERE s.provider_id = prov.id AND s.status = 'online')
        AND ($2 OR prov.supplier_code <> 'knownhost')
        AND (NOT plan.requires_verified_mapping OR (
              jsonb_typeof(pkg.verified_entitlements -> 'websites') = 'number' AND (pkg.verified_entitlements ->> 'websites')::numeric > 0
          AND jsonb_typeof(pkg.verified_entitlements -> 'storage_mb') = 'number' AND (pkg.verified_entitlements ->> 'storage_mb')::numeric > 0))
        AND (plan.plan_type <> 'reseller' OR pkg.is_reseller_package)
      ORDER BY pkg.hosting_plan_id, pkg.is_default DESC, pkg.id`,
    [planIds, knownHostTransactionsEnabled()],
    db,
  )
}

function proposedComparisonFeatures(plan: PlanRow): Json {
  const targets = plan.target_entitlements
  if (!targets || typeof targets !== 'object' || !['wholesale_shared', 'reseller', 'infrastructure'].includes(targets.agreement as string) || targets.supplier !== 'knownhost') return {}
  return publicSubset(targets)
}

function publicResellerOffers(plan: PlanRow): Json[] {
  const targets = plan.target_entitlements ?? {}
  if (targets.supplier !== 'knownhost' || !['reseller', 'wholesale_shared', 'infrastructure'].includes(targets.agreement as string)) return []
  const offers = Array.isArray(targets.public_offers) ? (targets.public_offers as Json[]) : []
  return offers.map((offer) => Object.fromEntries(Object.entries(offer).filter(([key]) => OFFER_KEYS.has(key))))
}

export async function listPublicPlans(params: URLSearchParams) {
  const currencyParam = params.get('currency')
  const currencies = (currencyParam || 'USD').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean)
  if (currencyParam !== null && !currencies.length) throw new ValidationError({ currency: ['Use an ISO currency code such as USD.'] })
  const billingCycle = params.get('billing_cycle')

  const plans = await query<PlanRow>(
    `SELECT id, name, slug, short_description, description, is_featured, display_order, plan_type, requires_quote,
            requires_verified_mapping, is_active, target_entitlements
       FROM hosting_hostingplan WHERE is_active ORDER BY display_order, id`,
  )
  const prices = await query<{ id: number; hosting_plan_id: number; billing_cycle: string; currency: string; regular_price: string; sale_price: string | null; setup_fee: string }>(
    `SELECT p.id, p.hosting_plan_id, p.billing_cycle, c.code AS currency, p.regular_price, p.sale_price, p.setup_fee
       FROM hosting_hostingplanprice p JOIN currencies_currency c ON c.id = p.currency_id
      WHERE p.is_active AND c.code = ANY($1) AND ($2::text IS NULL OR p.billing_cycle = $2)
      ORDER BY p.hosting_plan_id, p.billing_cycle, p.id`,
    [currencies, billingCycle || null],
  )
  const packages = await verifiedPackages(plans.map((plan) => plan.id))
  const firstPackage = new Map<number, PackageRow>()
  for (const pkg of packages) if (!firstPackage.has(pkg.hosting_plan_id)) firstPackage.set(pkg.hosting_plan_id, pkg)
  const provisionableReseller = new Set(packages.filter((pkg) => pkg.is_reseller_package && pkg.provider_type === 'cpanel').map((pkg) => pkg.hosting_plan_id))

  return plans.map((plan) => {
    const pkg = firstPackage.get(plan.id)
    const entitlements = pkg && pkg.verified_entitlements && typeof pkg.verified_entitlements === 'object' && !Array.isArray(pkg.verified_entitlements)
      ? publicSubset(pkg.verified_entitlements as Json) : {}
    const hasFeatures = Object.keys(entitlements).length > 0
    const canPurchase = plan.is_active && !plan.requires_quote && Boolean(pkg)
    const feature = (key: string) => (entitlements[key] as unknown) ?? null
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      short_description: plan.short_description,
      description: plan.description,
      is_featured: plan.is_featured,
      display_order: plan.display_order,
      verification_status: hasFeatures ? 'verified' : 'pending',
      verified_features: entitlements,
      proposed_features: hasFeatures ? {} : proposedComparisonFeatures(plan),
      advertised_offers: publicResellerOffers(plan),
      plan_type: plan.plan_type,
      disk_space_mb: feature('storage_mb'),
      bandwidth_mb: feature('bandwidth_mb'),
      max_websites: feature('websites'),
      max_child_accounts: feature('child_accounts'),
      requires_quote: !canPurchase || (plan.plan_type === 'reseller' && !provisionableReseller.has(plan.id)),
      specifications: {},
      max_domains: feature('websites'),
      max_databases: feature('max_databases'),
      max_email_accounts: feature('max_email_accounts'),
      max_ftp_accounts: feature('max_ftp_accounts'),
      backup_frequency: feature('backup_frequency'),
      supports_ssl: feature('supports_ssl'),
      prices: prices.filter((price) => price.hosting_plan_id === plan.id).map((price) => ({
        id: price.id,
        billing_cycle: price.billing_cycle,
        currency: price.currency,
        price: price.sale_price ?? price.regular_price,
        regular_price: price.regular_price,
        sale_price: price.sale_price,
        setup_fee: price.setup_fee,
      })),
    }
  })
}

export async function getPublicPlan(slug: string, params: URLSearchParams) {
  const plans = await listPublicPlans(params)
  const plan = plans.find((item) => item.slug === slug)
  if (!plan) throw notFound('No HostingPlan matches the given query.')
  return plan
}

