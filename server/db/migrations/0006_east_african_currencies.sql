-- Display currencies for East Africa (2026-10-09). USD stays the base and default; USD and KES are charged.
-- UGX, TZS and RWF show indicative conversions from USD only, so they are stored without minor units.
INSERT INTO currencies_currency (code, name, symbol, is_active, is_default, decimal_places) VALUES
  ('UGX', 'Ugandan Shilling', 'USh', true, false, 0),
  ('TZS', 'Tanzanian Shilling', 'TSh', true, false, 0),
  ('RWF', 'Rwandan Franc', 'FRw', true, false, 0)
ON CONFLICT (code) DO NOTHING;
