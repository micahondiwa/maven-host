-- Product decision (2026-10-09): new website hosting lineup on 20i; reseller ("+") plans are dropped.
-- Rows are deactivated, never deleted, so historical orders, invoices and subscriptions keep their references.

INSERT INTO currencies_currency (code, name, symbol, is_active, is_default, decimal_places)
VALUES ('KES', 'Kenyan Shilling', 'KSh', true, false, 2) ON CONFLICT (code) DO NOTHING;

-- Drop the WHM reseller plans and withdraw the KnownHost-specified shared plans (their cPanel/LiteSpeed/NVMe
-- specifications and prices do not describe the 20i service).
UPDATE hosting_hostingplanprice SET is_active = false, updated_at = CURRENT_TIMESTAMP
 WHERE hosting_plan_id IN (SELECT id FROM hosting_hostingplan WHERE plan_type = 'reseller'
                              OR (plan_type = 'shared' AND target_entitlements ->> 'supplier' = 'knownhost'));
UPDATE hosting_hostingplan SET is_active = false, is_featured = false, updated_at = CURRENT_TIMESTAMP
 WHERE plan_type = 'reseller' OR (plan_type = 'shared' AND target_entitlements ->> 'supplier' = 'knownhost');

-- Cloud hosting plans. Limits are targets to configure as 20i package types; they are shown as "pending activation"
-- until staff verify a package for each plan. Features listed are those 20i publishes for its reseller platform.
-- Prices include 16% VAT; renewals are charged at the same price (no introductory discount).
CREATE TEMPORARY TABLE cloud_plans (slug text, name text, short_description text, description text, display_order int, featured boolean, disk_mb int, entitlements jsonb) ON COMMIT DROP;
INSERT INTO cloud_plans VALUES
('cloud-starter', 'Cloud Starter', 'One professional website with business email.',
 'Fast, secure hosting for one website, with professional mailboxes, free SSL and a global CDN.', 0, false, 10240,
 '{"websites": 1, "storage_gb": 10, "max_email_accounts": 5, "mailbox_storage_gb": 10, "max_databases": 5}'),
('cloud-business', 'Cloud Business', 'Room for several websites and a growing team.',
 'Host up to five websites with more mailboxes and more storage for a growing business.', 1, true, 51200,
 '{"websites": 5, "storage_gb": 50, "max_email_accounts": 25, "mailbox_storage_gb": 10, "max_databases": "unlimited"}'),
('cloud-pro', 'Cloud Pro', 'For agencies and busy sites that need headroom.',
 'Host up to twenty websites with unlimited mailboxes and databases, for agencies and higher-traffic sites.', 2, false, 102400,
 '{"websites": 20, "storage_gb": 100, "max_email_accounts": "unlimited", "mailbox_storage_gb": 10, "max_databases": "unlimited"}');

-- term, months, billing cycle, USD price, KES price
CREATE TEMPORARY TABLE cloud_prices (slug text, cycle text, term text, months int, usd numeric(10,2), kes numeric(10,2)) ON COMMIT DROP;
INSERT INTO cloud_prices VALUES
('cloud-starter', 'monthly', '1-month', 1, 3.49, 449), ('cloud-starter', 'annually', '1-year', 12, 29.99, 3899), ('cloud-starter', 'biennially', '2-year', 24, 54.99, 6999),
('cloud-business', 'monthly', '1-month', 1, 6.99, 899), ('cloud-business', 'annually', '1-year', 12, 59.99, 7799), ('cloud-business', 'biennially', '2-year', 24, 109.99, 13999),
('cloud-pro', 'monthly', '1-month', 1, 11.99, 1549), ('cloud-pro', 'annually', '1-year', 12, 99.99, 12999), ('cloud-pro', 'biennially', '2-year', 24, 179.99, 22999);

INSERT INTO hosting_hostingplan (name, plan_type, disk_space_mb, bandwidth_mb, max_domains, max_databases, max_email_accounts, max_ftp_accounts, backup_frequency, supports_ssl,
  is_active, created_at, updated_at, max_child_accounts, requires_quote, specifications, description, display_order, is_featured, requires_verified_mapping,
  short_description, slug, target_entitlements)
SELECT p.name, 'shared', p.disk_mb, NULL, (p.entitlements ->> 'websites')::int, 0, 0, 0, 'daily', true,
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, false, '{}', p.description, p.display_order, p.featured, true,
       p.short_description, p.slug,
       p.entitlements || jsonb_build_object(
         'supplier', 'twentyi', 'agreement', 'wholesale_shared', 'source', 'https://www.20i.com/reseller-hosting', 'source_checked_on', '2026-10-09',
         'control_panel', 'Maven Host control panel', 'bandwidth', 'unlimited', 'ssl', 'Free SSL, including wildcard', 'cdn', 'Global Anycast CDN',
         'waf', true, 'ddos_protection', true, 'malware_scanning', true, 'two_factor_auth', true, 'webmail', true, 'autoresponders', true,
         'spam_filtering', true, 'dkim', true, 'dns_management', true, 'ssh', true, 'git', true, 'wp_cli', true, 'php_management', true,
         'wordpress_manager', true, 'wordpress_staging', true, 'free_migration', true,
         'public_offers', (SELECT jsonb_agg(jsonb_build_object(
             'term', c.term, 'months', c.months, 'currency', 'USD', 'total', c.usd::text, 'monthly', round(c.usd / c.months, 2)::text,
             'renewal_total', c.usd::text, 'renewal_monthly', round(c.usd / c.months, 2)::text, 'vat_percent', '16', 'vat_included', true) ORDER BY c.months DESC)
           FROM cloud_prices c WHERE c.slug = p.slug))
  FROM cloud_plans p
 WHERE NOT EXISTS (SELECT 1 FROM hosting_hostingplan h WHERE h.slug = p.slug OR h.name = p.name);

INSERT INTO hosting_hostingplanprice (billing_cycle, regular_price, sale_price, setup_fee, is_active, created_at, updated_at, currency_id, hosting_plan_id)
SELECT c.cycle, CASE cur.code WHEN 'USD' THEN c.usd ELSE c.kes END, NULL, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, cur.id, h.id
  FROM cloud_prices c JOIN hosting_hostingplan h ON h.slug = c.slug JOIN currencies_currency cur ON cur.code IN ('USD', 'KES')
 WHERE NOT EXISTS (SELECT 1 FROM hosting_hostingplanprice x WHERE x.hosting_plan_id = h.id AND x.billing_cycle = c.cycle AND x.currency_id = cur.id);
