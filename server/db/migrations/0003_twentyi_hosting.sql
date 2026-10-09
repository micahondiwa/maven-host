-- Product decision (2026-10-09): 20i replaces KnownHost as the hosting supplier.
--
-- 20i hosting packages are not placed on servers Maven Host manages, so a hosting account no longer needs a server.
-- Relaxing NOT NULL is backwards compatible: every existing row (and v1, which always writes a server) is unaffected.
ALTER TABLE hosting_hostingaccount ALTER COLUMN server_id DROP NOT NULL;

-- KnownHost provider records are kept for history but can no longer be selected for provisioning.
UPDATE hosting_hostingprovider SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE supplier_code = 'knownhost';

-- The 20i supplier record starts inactive; credentials come from the server environment, never the database.
INSERT INTO hosting_hostingprovider (name, provider_type, api_url, api_username, api_key, is_active, created_at, updated_at, infrastructure_component_id, supplier_code)
SELECT '20i', 'twentyi', 'https://api.20i.com', '', '', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, 'twentyi'
 WHERE NOT EXISTS (SELECT 1 FROM hosting_hostingprovider WHERE supplier_code = 'twentyi' OR name = '20i');
