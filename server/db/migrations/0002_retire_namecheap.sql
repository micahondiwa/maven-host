-- Product decision (October 2026): Openprovider is the international registrar; Namecheap is not used. No MavenHost
-- domain was registered through the Namecheap API, so the v1 seed registrar is retired. Fail loudly if that is untrue.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM domains_domain d JOIN domains_registrar r ON r.id = d.registrar_id WHERE r.slug = 'namecheap') THEN
    RAISE EXCEPTION 'Domains are still assigned to the Namecheap registrar; migrate them before retiring it.';
  END IF;
END $$;
DELETE FROM domains_domainprice WHERE registrar_id IN (SELECT id FROM domains_registrar WHERE slug = 'namecheap');
UPDATE domains_registrar SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE slug = 'namecheap';
