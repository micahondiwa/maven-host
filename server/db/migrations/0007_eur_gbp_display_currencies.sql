-- EUR and GBP display currencies (2026-10-09): indicative conversions from USD, charged in USD, as on
-- inaracresttechnologies.com.
INSERT INTO currencies_currency (code, name, symbol, is_active, is_default, decimal_places) VALUES
  ('EUR', 'Euro', '€', true, false, 2),
  ('GBP', 'British Pound', '£', true, false, 2)
ON CONFLICT (code) DO NOTHING;
