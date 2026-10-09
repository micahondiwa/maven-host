-- Product decision (2026-10-09): 20i is the only hosting supplier for now. The managed VPS and dedicated server plans
-- were KnownHost hardware configurations and prices, so they are withdrawn from the catalog until infrastructure
-- products are defined on 20i. Rows are deactivated, never deleted, so historical references remain valid.
UPDATE hosting_hostingplanprice SET is_active = false, updated_at = CURRENT_TIMESTAMP
 WHERE hosting_plan_id IN (SELECT id FROM hosting_hostingplan WHERE target_entitlements ->> 'supplier' = 'knownhost');
UPDATE hosting_hostingplan SET is_active = false, is_featured = false, updated_at = CURRENT_TIMESTAMP
 WHERE target_entitlements ->> 'supplier' = 'knownhost';
UPDATE hosting_hostingpackage SET is_active = false, is_provisionable = false, updated_at = CURRENT_TIMESTAMP
 WHERE provider_id IN (SELECT id FROM hosting_hostingprovider WHERE supplier_code = 'knownhost');
