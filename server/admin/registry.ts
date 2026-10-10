import 'server-only'

/**
 * Declarative staff administration (replaces the v1 Django admin for operational data). Each resource names its table,
 * the permissions to view and manage it, the columns shown in lists, filters, search, and the fields staff may edit
 * with their validation. Writes are transactional and audit-logged by the generic service; secrets are write-only.
 */

export type FieldType = 'text' | 'longtext' | 'boolean' | 'integer' | 'decimal' | 'choice' | 'json' | 'datetime' | 'ref' | 'secret'

export type Field = {
  name: string
  label: string
  type: FieldType
  /** Staff with the manage permission may change it. */
  editable?: boolean
  /** Required on create. */
  required?: boolean
  nullable?: boolean
  maxLength?: number
  choices?: readonly string[]
  /** Foreign key: `table` rows offered as options, shown as `label` (SQL over alias `r`). */
  ref?: { table: string; label: string; where?: string }
  decimalPlaces?: number
  min?: number
  help?: string
}

export type Action = { name: string; label: string; permission: string; sql: string; when?: string; confirm?: string }

export type Resource = {
  key: string
  label: string
  group: 'Hosting' | 'Billing' | 'Domains' | 'Pricing' | 'Platform'
  description: string
  table: string
  pk: 'uuid' | 'bigint'
  view: string[]
  manage?: string[]
  /** Field names shown in the list, in order. */
  list: string[]
  search?: string[]
  filters?: string[]
  order: string
  fields: Field[]
  /** Values for NOT NULL columns staff do not supply on create (SQL expressions). Absent: create disabled. */
  createDefaults?: Record<string, string>
  actions?: Action[]
}

const CYCLES = ['monthly', 'quarterly', 'semi_annually', 'annually', 'biennially', 'triennially'] as const
const PLAN_TYPES = ['shared', 'reseller', 'vps', 'dedicated', 'email'] as const
const timestamps: Field[] = [
  { name: 'created_at', label: 'Created', type: 'datetime' },
  { name: 'updated_at', label: 'Updated', type: 'datetime' },
]
const STAMP = { created_at: 'CURRENT_TIMESTAMP', updated_at: 'CURRENT_TIMESTAMP' }
const currencyRef = { table: 'currencies_currency', label: 'r.code' }

const HOSTING_VIEW = ['view_hosting']
const HOSTING_MANAGE = ['view_hosting', 'manage_hosting']
const SETTINGS = ['manage_platform_settings']

export const RESOURCES: Resource[] = [
  {
    key: 'hosting-plans', label: 'Hosting plans', group: 'Hosting', table: 'hosting_hostingplan', pk: 'bigint', view: HOSTING_VIEW, manage: HOSTING_MANAGE,
    description: 'Plans shown on the hosting pages. A plan is sold only when it has active prices and a verified package.',
    list: ['name', 'slug', 'plan_type', 'is_active', 'requires_quote', 'is_featured', 'display_order'], search: ['name', 'slug'], filters: ['plan_type', 'is_active'], order: 'display_order, id',
    fields: [
      { name: 'name', label: 'Name', type: 'text', editable: true, required: true, maxLength: 100 },
      { name: 'slug', label: 'Slug', type: 'text', editable: true, nullable: true, maxLength: 100, help: 'Lowercase letters, numbers and hyphens; used in /hosting URLs.' },
      { name: 'plan_type', label: 'Type', type: 'choice', choices: PLAN_TYPES, editable: true, required: true },
      { name: 'short_description', label: 'Short description', type: 'text', editable: true, maxLength: 240 },
      { name: 'description', label: 'Description', type: 'longtext', editable: true },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      { name: 'is_featured', label: 'Featured', type: 'boolean', editable: true },
      { name: 'requires_quote', label: 'Requires quote', type: 'boolean', editable: true, help: 'When on, the plan cannot be bought online.' },
      { name: 'requires_verified_mapping', label: 'Requires verified package', type: 'boolean', editable: true },
      { name: 'display_order', label: 'Display order', type: 'integer', editable: true, min: 0 },
      { name: 'disk_space_mb', label: 'Disk space (MB)', type: 'integer', editable: true, nullable: true, min: 0 },
      { name: 'bandwidth_mb', label: 'Bandwidth (MB)', type: 'integer', editable: true, nullable: true, min: 0 },
      { name: 'target_entitlements', label: 'Published features and offers', type: 'json', editable: true, help: 'Features and public_offers shown while the plan is pending verification.' },
      ...timestamps,
    ],
    createDefaults: {
      ...STAMP, max_domains: '1', max_databases: '0', max_email_accounts: '0', max_ftp_accounts: '0', backup_frequency: "'daily'", supports_ssl: 'true', max_child_accounts: '0',
      specifications: "'{}'::jsonb", description: "''", short_description: "''", display_order: '0', is_featured: 'false', is_active: 'false', requires_quote: 'true',
      requires_verified_mapping: 'true', target_entitlements: "'{}'::jsonb",
    },
  },
  {
    key: 'hosting-plan-prices', label: 'Hosting plan prices', group: 'Hosting', table: 'hosting_hostingplanprice', pk: 'bigint', view: HOSTING_VIEW, manage: HOSTING_MANAGE,
    description: 'Retail prices per plan, billing cycle and currency (VAT inclusive). Changes apply to new carts and checkouts.',
    list: ['hosting_plan_id', 'billing_cycle', 'currency_id', 'regular_price', 'sale_price', 'is_active'], filters: ['billing_cycle', 'currency_id', 'is_active'], order: 'hosting_plan_id, billing_cycle, currency_id',
    fields: [
      { name: 'hosting_plan_id', label: 'Plan', type: 'ref', ref: { table: 'hosting_hostingplan', label: 'r.name' }, required: true },
      { name: 'billing_cycle', label: 'Billing cycle', type: 'choice', choices: CYCLES, required: true },
      { name: 'currency_id', label: 'Currency', type: 'ref', ref: { ...currencyRef, where: "r.code IN ('USD', 'KES')" }, required: true },
      { name: 'regular_price', label: 'Price', type: 'decimal', decimalPlaces: 2, min: 0, editable: true, required: true },
      { name: 'sale_price', label: 'Sale price', type: 'decimal', decimalPlaces: 2, min: 0, editable: true, nullable: true },
      { name: 'setup_fee', label: 'Setup fee', type: 'decimal', decimalPlaces: 2, min: 0, editable: true },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      ...timestamps,
    ],
    createDefaults: { ...STAMP, setup_fee: '0', is_active: 'true', sale_price: 'NULL' },
  },
  {
    key: 'hosting-packages', label: 'Hosting packages', group: 'Hosting', table: 'hosting_hostingpackage', pk: 'bigint', view: HOSTING_VIEW, manage: HOSTING_MANAGE,
    description: 'Supplier package types that provision each plan. Mark a package verified only after checking it in the supplier account.',
    list: ['hosting_plan_id', 'provider_id', 'package_name', 'is_active', 'is_provider_verified', 'is_provisionable', 'last_verified_at'], filters: ['provider_id', 'is_provider_verified', 'is_active'], order: 'hosting_plan_id, id',
    fields: [
      { name: 'hosting_plan_id', label: 'Plan', type: 'ref', ref: { table: 'hosting_hostingplan', label: 'r.name' }, required: true },
      { name: 'provider_id', label: 'Supplier', type: 'ref', ref: { table: 'hosting_hostingprovider', label: 'r.name' }, required: true },
      { name: 'package_name', label: 'Supplier package type id', type: 'text', editable: true, required: true, maxLength: 100, help: 'For 20i, the package type id used by addWeb.' },
      { name: 'package_identifier', label: 'Package identifier', type: 'text', editable: true, maxLength: 100 },
      { name: 'provider_product_id', label: 'Supplier product id', type: 'text', editable: true, maxLength: 120 },
      { name: 'provider_region', label: 'Region', type: 'text', editable: true, maxLength: 100 },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      { name: 'is_default', label: 'Default for plan', type: 'boolean', editable: true },
      { name: 'is_provider_verified', label: 'Verified with supplier', type: 'boolean', editable: true },
      { name: 'is_provisionable', label: 'Provisionable', type: 'boolean', editable: true },
      { name: 'is_reseller_package', label: 'Reseller package', type: 'boolean', editable: true },
      { name: 'last_verified_at', label: 'Last verified', type: 'datetime', help: 'Set automatically when the package is marked verified.' },
      { name: 'verified_entitlements', label: 'Verified entitlements', type: 'json', editable: true, help: 'Confirmed limits, e.g. {"websites": 1, "storage_mb": 10240}.' },
      { name: 'provisioning_metadata', label: 'Provisioning metadata', type: 'json', editable: true },
      { name: 'wholesale_cost', label: 'Wholesale cost', type: 'decimal', decimalPlaces: 2, min: 0, editable: true, nullable: true },
      { name: 'wholesale_currency_id', label: 'Wholesale currency', type: 'ref', ref: currencyRef, editable: true, nullable: true },
      { name: 'wholesale_billing_cycle', label: 'Wholesale billing cycle', type: 'text', editable: true, maxLength: 30 },
      ...timestamps,
    ],
    createDefaults: {
      ...STAMP, package_identifier: "''", is_default: 'false', is_active: 'true', is_reseller_package: 'false', is_provider_verified: 'false', is_provisionable: 'false',
      last_verified_at: 'NULL', provider_product_id: "''", provider_region: "''", provisioning_metadata: "'{}'::jsonb", verified_entitlements: "'{}'::jsonb",
      wholesale_billing_cycle: "''", wholesale_cost: 'NULL', wholesale_currency_id: 'NULL',
    },
  },
  {
    key: 'hosting-suppliers', label: 'Hosting suppliers', group: 'Hosting', table: 'hosting_hostingprovider', pk: 'bigint', view: HOSTING_VIEW, manage: HOSTING_MANAGE,
    description: 'Supplier records. API credentials are read from the server environment, never stored here.',
    list: ['name', 'supplier_code', 'provider_type', 'is_active'], order: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'supplier_code', label: 'Supplier code', type: 'text' },
      { name: 'provider_type', label: 'Type', type: 'text' },
      { name: 'api_url', label: 'API URL', type: 'text', editable: true, maxLength: 200 },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      ...timestamps,
    ],
  },
  {
    key: 'hosting-accounts', label: 'Hosting accounts', group: 'Hosting', table: 'hosting_hostingaccount', pk: 'bigint', view: HOSTING_VIEW,
    description: 'Provisioned hosting accounts (read-only; lifecycle actions run through the hosting service).',
    list: ['primary_domain', 'username', 'owner_id', 'package_id', 'status', 'provisioned_at'], search: ['primary_domain', 'username'], filters: ['status'], order: 'created_at DESC',
    fields: [
      { name: 'primary_domain', label: 'Primary domain', type: 'text' },
      { name: 'username', label: 'Label', type: 'text' },
      { name: 'owner_id', label: 'Customer', type: 'ref', ref: { table: 'accounts_user', label: 'r.email' } },
      { name: 'package_id', label: 'Package', type: 'ref', ref: { table: 'hosting_hostingpackage', label: 'r.package_name' } },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'is_suspended', label: 'Suspended', type: 'boolean' },
      { name: 'provisioned_at', label: 'Provisioned', type: 'datetime' },
      ...timestamps,
    ],
  },
  {
    key: 'payment-gateways', label: 'Payment gateways', group: 'Billing', table: 'billing_payment_gateway', pk: 'uuid', view: ['view_payment'], manage: SETTINGS,
    description: 'Paystack, card, M-Pesa and manual payment options. Credentials are managed separately and are write-only.',
    list: ['name', 'slug', 'provider', 'sandbox', 'is_active', 'is_default'], filters: ['provider', 'is_active'], order: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text', editable: true, required: true, maxLength: 100 },
      { name: 'slug', label: 'Slug', type: 'text', editable: true, required: true, maxLength: 100 },
      { name: 'provider', label: 'Provider', type: 'choice', choices: ['paystack', 'card', 'mpesa', 'manual'], editable: true, required: true },
      { name: 'sandbox', label: 'Sandbox mode', type: 'boolean', editable: true },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      { name: 'is_default', label: 'Default', type: 'boolean', editable: true },
      { name: 'callback_url', label: 'Callback URL', type: 'text', editable: true, maxLength: 200 },
      { name: 'webhook_url', label: 'Webhook URL', type: 'text', editable: true, maxLength: 200 },
      { name: 'reconciliation_url', label: 'Reconciliation URL', type: 'text', editable: true, maxLength: 200 },
      { name: 'paybill_number', label: 'Paybill / till number', type: 'text', editable: true, maxLength: 20 },
      { name: 'manual_payment_instructions', label: 'Manual payment instructions', type: 'longtext', editable: true },
      ...timestamps,
    ],
    createDefaults: { ...STAMP, sandbox: 'true', is_active: 'false', is_default: 'false', callback_url: "''", webhook_url: "''", reconciliation_url: "''", paybill_number: "''", manual_payment_instructions: "''" },
  },
  {
    key: 'gateway-credentials', label: 'Gateway credentials', group: 'Billing', table: 'billing_payment_gateway_credential', pk: 'uuid', view: SETTINGS, manage: SETTINGS,
    description: 'Encrypted gateway secrets (secret_key, consumer_key, passkey, reconciliation_token…). Values are never shown again after saving.',
    list: ['gateway_id', 'key', 'is_secret', 'updated_at'], filters: ['gateway_id'], order: 'gateway_id, key',
    fields: [
      { name: 'gateway_id', label: 'Gateway', type: 'ref', ref: { table: 'billing_payment_gateway', label: 'r.name' }, required: true },
      { name: 'key', label: 'Key', type: 'text', required: true, maxLength: 100 },
      { name: 'value', label: 'Value', type: 'secret', editable: true, required: true },
      { name: 'is_secret', label: 'Secret', type: 'boolean', editable: true },
      ...timestamps,
    ],
    createDefaults: { ...STAMP, is_secret: 'true' },
  },
  {
    key: 'tlds', label: 'Domain extensions', group: 'Domains', table: 'domains_tld', pk: 'bigint', view: ['view_domain'], manage: SETTINGS,
    description: 'Extensions offered in domain search. Supplier support and prices come from the Openprovider catalog sync.',
    list: ['extension', 'display_name', 'is_active', 'is_featured', 'provider_supported', 'registration_order'], search: ['extension', 'display_name'], filters: ['is_active', 'provider_supported'], order: 'registration_order, extension',
    fields: [
      { name: 'extension', label: 'Extension', type: 'text' },
      { name: 'display_name', label: 'Display name', type: 'text', editable: true, maxLength: 100 },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      { name: 'is_featured', label: 'Featured', type: 'boolean', editable: true },
      { name: 'registration_order', label: 'Order', type: 'integer', editable: true, min: 0 },
      { name: 'supports_dnssec', label: 'DNSSEC', type: 'boolean', editable: true },
      { name: 'supports_idn', label: 'IDN', type: 'boolean', editable: true },
      { name: 'provider_supported', label: 'Supplier supported', type: 'boolean' },
      { name: 'last_synced_at', label: 'Last synced', type: 'datetime' },
      ...timestamps,
    ],
  },
  {
    key: 'domain-prices', label: 'Domain supplier prices', group: 'Domains', table: 'domains_domainprice', pk: 'bigint', view: SETTINGS,
    description: 'Wholesale prices from the supplier catalog (staff only; retail prices apply the pricing rule).',
    list: ['tld_id', 'registrar_id', 'price_type', 'years', 'price', 'currency_id', 'last_synced_at'], filters: ['price_type', 'registrar_id'], order: 'tld_id, price_type, years',
    fields: [
      { name: 'tld_id', label: 'Extension', type: 'ref', ref: { table: 'domains_tld', label: 'r.extension' } },
      { name: 'registrar_id', label: 'Registrar', type: 'ref', ref: { table: 'domains_registrar', label: 'r.name' } },
      { name: 'price_type', label: 'Type', type: 'text' },
      { name: 'years', label: 'Years', type: 'integer' },
      { name: 'price', label: 'Wholesale price', type: 'decimal' },
      { name: 'currency_id', label: 'Currency', type: 'ref', ref: currencyRef },
      { name: 'last_synced_at', label: 'Synced', type: 'datetime' },
    ],
  },
  {
    key: 'registrars', label: 'Registrars', group: 'Domains', table: 'domains_registrar', pk: 'bigint', view: ['view_domain'], manage: SETTINGS,
    description: 'Registrar records. Openprovider is the only provisioning registrar; purchases also need its server credentials and flags.',
    list: ['name', 'slug', 'is_active'], order: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'slug', label: 'Slug', type: 'text' },
      { name: 'website', label: 'Website', type: 'text' },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      ...timestamps,
    ],
  },
  {
    key: 'pricing-rules', label: 'Pricing rules', group: 'Pricing', table: 'pricing_pricingrule', pk: 'bigint', view: SETTINGS, manage: SETTINGS,
    description: 'Retail markup applied to supplier domain prices. Exactly one active rule should be the default.',
    list: ['name', 'strategy', 'value', 'is_default', 'is_active'], order: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text', editable: true, required: true, maxLength: 100 },
      { name: 'strategy', label: 'Strategy', type: 'choice', choices: ['percentage_markup', 'fixed_markup', 'fixed_price'], editable: true, required: true },
      { name: 'value', label: 'Value', type: 'decimal', decimalPlaces: 2, min: 0, editable: true, required: true },
      { name: 'is_default', label: 'Default', type: 'boolean', editable: true },
      { name: 'is_active', label: 'Active', type: 'boolean', editable: true },
      ...timestamps,
    ],
    createDefaults: { ...STAMP, is_default: 'false', is_active: 'true' },
  },
  {
    key: 'currencies', label: 'Currencies', group: 'Pricing', table: 'currencies_currency', pk: 'bigint', view: SETTINGS,
    description: 'USD and KES are payment currencies; the others are display-only.',
    list: ['code', 'name', 'symbol', 'decimal_places', 'is_active', 'is_default'], order: 'id',
    fields: [
      { name: 'code', label: 'Code', type: 'text' },
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'symbol', label: 'Symbol', type: 'text' },
      { name: 'decimal_places', label: 'Decimals', type: 'integer' },
      { name: 'is_active', label: 'Active', type: 'boolean' },
      { name: 'is_default', label: 'Default', type: 'boolean' },
    ],
  },
  {
    key: 'exchange-rates', label: 'Exchange rates', group: 'Pricing', table: 'currencies_exchangerate', pk: 'bigint', view: SETTINGS,
    description: 'Synchronised daily by the sync_exchange_rates job.',
    list: ['base_currency_id', 'target_currency_id', 'rate', 'updated_at'], order: 'target_currency_id',
    fields: [
      { name: 'base_currency_id', label: 'Base', type: 'ref', ref: currencyRef },
      { name: 'target_currency_id', label: 'Target', type: 'ref', ref: currencyRef },
      { name: 'rate', label: 'Rate', type: 'decimal' },
      { name: 'updated_at', label: 'Updated', type: 'datetime' },
    ],
  },
  {
    key: 'audit-log', label: 'Audit log', group: 'Platform', table: 'audit_auditlog', pk: 'bigint', view: ['view_audit_logs'],
    description: 'Every staff action and provider operation, newest first.',
    list: ['created_at', 'event', 'category', 'status', 'performed_by_id', 'object_id', 'message'], search: ['event', 'object_id', 'message'], filters: ['category', 'status'], order: 'created_at DESC, id DESC',
    fields: [
      { name: 'created_at', label: 'Time', type: 'datetime' },
      { name: 'event', label: 'Event', type: 'text' },
      { name: 'category', label: 'Category', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'performed_by_id', label: 'By', type: 'ref', ref: { table: 'accounts_user', label: 'r.email' } },
      { name: 'object_id', label: 'Object', type: 'text' },
      { name: 'message', label: 'Message', type: 'longtext' },
      { name: 'ip_address', label: 'IP address', type: 'text' },
      { name: 'metadata', label: 'Metadata', type: 'json' },
    ],
  },
  {
    key: 'outbox-events', label: 'Background jobs', group: 'Platform', table: 'core_events_outbox', pk: 'uuid', view: SETTINGS, manage: SETTINGS,
    description: 'Durable events processed every minute (fulfilment, provisioning, notifications). Failed events retry with backoff.',
    list: ['created_at', 'event_name', 'status', 'attempts', 'available_at', 'last_error'], search: ['event_name'], filters: ['status', 'event_name'], order: 'created_at DESC',
    fields: [
      { name: 'created_at', label: 'Created', type: 'datetime' },
      { name: 'event_name', label: 'Event', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'attempts', label: 'Attempts', type: 'integer' },
      { name: 'available_at', label: 'Next attempt', type: 'datetime' },
      { name: 'processed_at', label: 'Processed', type: 'datetime' },
      { name: 'last_error', label: 'Last error', type: 'longtext' },
      { name: 'payload', label: 'Payload', type: 'json' },
    ],
    actions: [
      {
        name: 'retry-now', label: 'Retry now', permission: 'manage_platform_settings', when: "status = 'failed'",
        sql: `UPDATE core_events_outbox SET available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'failed'`,
      },
    ],
  },
]

export const resourceByKey = (key: string) => RESOURCES.find((resource) => resource.key === key)
