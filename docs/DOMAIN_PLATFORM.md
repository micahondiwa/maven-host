# Domain platform (Openprovider) — capability matrix and roadmap

Openprovider is the sole domain supplier. Customers only ever see **Maven Host**: supplier names, handles, ids and
raw responses stay server-side (staff views keep the supplier name for operations).

Source of truth: Openprovider's OpenAPI spec at developer.openprovider.com (`data/swagger.spec.js`, checked
2026-10-10). Nothing below relies on undocumented behaviour.

## API version

Openprovider moved its REST API to **`/v1`** ("functionally identical"; a base-URL change). `/v1beta` is
discontinued and **switched off on 2027-06-30**. Production must use `OPENPROVIDER_API_URL=https://api.openprovider.eu/v1`.
The adapter accepts `/v1` and still accepts the legacy sandbox `/v1beta` host until a `/v1` sandbox host is published.

## Classification

- **Live-ready** — implemented, tested against the documented contract with mocks; goes live when credentials and
  flags are set (`OPENPROVIDER_ENABLED`, and `OPENPROVIDER_TRANSACTIONS_ENABLED` for anything that changes a domain).
- **Next phase** — documented by Openprovider; not built yet.
- **Manual** — handled by staff/support.
- **Not offered** — not available through the documented API, or out of scope.

| Capability | Openprovider operation | Status |
| --- | --- | --- |
| Availability search (batched) | `POST /domains/check` | Live-ready |
| Premium detection | `POST /domains/check` (`is_premium`) | Live-ready (premium names are not sold online) |
| Registration (paid order → durable fulfilment) | `POST /domains`, `POST /customers` (handles) | Live-ready |
| Price guard before purchase | `GET /domains/prices` | Live-ready |
| Renewal | `POST /domains/{id}/renew` | **Live-ready (phase 2)**: customer renewal through cart, checkout and payment, with registry reconciliation |
| Contacts (owner/admin/tech/billing) | `PUT /domains/{id}` handles, `GET/POST /customers` | Live-ready |
| Nameservers | `PUT /domains/{id}` `name_servers` | Live-ready |
| Glue records (existing hosts) | `GET/PUT /dns/nameservers/{name}` | Live-ready (creating new glue: next phase, `POST /dns/nameservers`) |
| DNS zone records | `GET/PUT /dns/zones/{name}` | Live-ready |
| **Live domain status** (lock, privacy, expiry) | `GET /domains/{id}` | **Live-ready (phase 1)** |
| **Registrar lock** | `PUT /domains/{id}` `is_locked` (gated by `is_lockable`) | **Live-ready (phase 1)** |
| **WHOIS privacy** | `PUT /domains/{id}` `is_private_whois_enabled` (gated by `is_private_whois_allowed`) | **Live-ready (phase 1)**; confirm any WPP fee on the account before advertising it as free |
| **Transfer code (transfer out)** | `GET /domains/{id}/authcode` | **Live-ready (phase 1)**: owner-only, rate-limited, audited (code never logged), owner emailed |
| **Catalog sync** (all extensions, paginated) | `GET /tlds?limit&offset&with_price&with_restrictions` | **Live-ready (phase 1)**: daily job; new extensions inactive until staff enable them |
| Transfer in | `POST /domains/transfer` (auth code, optional registry contact/NS import) | Next phase (cart product + auth-code capture + fulfilment) |
| Auth code reset | `POST /domains/{id}/authcode/reset` | Next phase |
| DNSSEC keys | `PUT /domains/{id}` `dnssec_keys`, `is_dnssec_enabled` | Next phase |
| Restore (redemption) | `POST /domains/{id}/restore` | Manual (staff, priced per case) |
| Owner change (trade) | `POST /domains/trade` | Manual |
| Name suggestions | `POST /domains/suggest-name` | Next phase (current suggestions use priced alternative extensions) |
| Registry email verification status | `GET /customers/verifications/emails/domains` | Next phase |
| SSL certificates | `/ssl/products`, `/ssl/orders`, CSR, approver email | Next phase (separate product line) |
| Reseller balance | `GET /resellers/{id}` | Next phase (staff dashboard) |
| Supplier auto-renew | `PUT /domains/{id}` `autorenew` | Not used: Maven Host bills renewals itself; supplier auto-renew stays `off` |
| Register.co.ke / registry.co.tz direct | — | Not offered until accreditation (standby adapters) |

## Phase 1 (done)

- Customer branding: search, domain list/detail and DNS/nameserver responses name **Maven Host**; supplier error
  messages are neutral ("Domain registration services are temporarily unavailable").
- Customer security controls (`/api/v1/domains/customer/domains/<id>/status|lock|privacy|auth-code/`) with ownership
  checks, live-state verification before writing, no write when already in the requested state, local mirroring,
  audit events (`domain_locked`, `domain_unlocked`, `domain_privacy_enabled/disabled`, `domain_auth_code_retrieved`),
  throttles (`domain_security` 20/hour, `domain_auth_code` 5/hour), and a portal panel on the domain page.
- `sync_domain_catalog` (daily 04:07 via cron; skipped while the integration is disabled): extension metadata
  (periods, renew/transfer availability, auth-code requirement, privacy and DNSSEC support, restrictions), one-year
  register/renew/transfer prices; prices the supplier no longer confirms (not offered, setup fee, multi-year minimum,
  unknown currency, withdrawn extension) are removed so they cannot be sold. Audited as `domain_catalog_synced`.

## Phase 2 (done): renewals

- **Renew through checkout.** A renewal is a domain cart item with `operation: renew`, priced from the extension's
  renewal price. It is accepted only for the customer's own domain, only with a renewal price matching that domain's
  extension and registrar, and once per cart. Renewal-only carts need no registrant contact. Registration items must
  now use a registration price (previously a renewal or transfer price id could be added as a "registration").
- **No double renewal.** The expiry being extended is recorded at checkout. At fulfilment the registry expiry is
  checked first: if it is already past that date (an earlier attempt renewed but did not finish), the record is
  reconciled and no second renewal is bought. Fulfilment uses its own durable operation (`domain_renewal`).
- **Maven Host auto-renew.** Customers switch auto-renew on the domain page. 14 days before expiry the daily
  `process_domain_renewals` job issues a renewal order and invoice (in the customer's USD/KES preference) and emails
  it; the domain renews once paid. The supplier's own auto-renew stays off, so nothing is renewed unpaid.
- **Reminders.** 30, 7 and 1 days before expiry, and once after expiry (within the 30-day grace window). Each notice
  and each automatic invoice is recorded in `domains_renewalnotice` (unique per domain, kind and expiry date) before
  sending, so reruns and overlapping runs never duplicate them; no automatic invoice is issued while an unpaid or
  in-progress renewal order exists.
- **Portal.** Renewal panel with expiry countdown, the price in the selected currency, "Renew for 1 year", a link to
  any unpaid renewal invoice, and the auto-renew switch. Cart lines show "Renewal: example.com".

## Next phases

1. Transfer in (auth code at checkout, `POST /domains/transfer`, status tracking) and auth-code reset.
2. DNSSEC management and new glue records.
3. Contact profiles reused across registrations; registry email verification status.
4. SSL product line; reseller balance and margin reporting for staff.
