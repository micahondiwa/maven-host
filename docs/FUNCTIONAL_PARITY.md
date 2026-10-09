# Functional parity checklist

Source commit: `58e0bb2540fd1376d45495ad8ad6c74a2dd6a6b7` in `micahondiwa/maven-host-v1`.

The source contains 77,074 tracked Python lines across 1,155 files, 64 model classes with field definitions, 21 route modules, 53 explicit frontend route declarations, 29 management commands and 143 test files. `source-inventory.json` records symbols, model declarations/relationships/meta constraints and route targets. Zero Python parse errors.

A source implementation or test file does not prove a provider integration works. "Working" below means prior observed production behaviour; all other source implementations remain unverified until equivalent local tests run. The new app is not complete and must not replace production yet.

| Area | Source state/evidence | Next migration state | Source location |
|---|---|---|---|
| Public branding and navigation | Working in deployed v1; carried to Next UI | UI carried; SSR, hydration and browser parity pending | frontend/src/components/CustomerHeader.tsx |
| Domain search and suggestions | Working in v1 production smoke checks | Ported with v1 pricing engine, paging and caching; every extension, .ke and .tz included, is provisioned through Openprovider | backend/apps/domains/api/urls.py |
| Registration, transfer, renewal and DNS | Source implemented; provider integration depends on credentials | Ported (durable pending intent and reconciliation, contacts, nameservers, glue, DNS). Customer renewal is staff-only because v1 renewed without payment; Namecheap removed (product decision; no domains were registered through it). Live supplier tests still need credentials | backend/apps/domains |
| Register.co.ke and registry.co.tz | Register.co.ke disabled awaiting reseller API; no Tanzania supplier in v1 | Proposed providers in standby until accreditation: not routed by default (opt-in via DOMAIN_COUNTRY_REGISTRARS), adapters fail closed without network calls; no invented API | docs/supplier-workflows.md |
| Hosting plans and cart selection | Working; 23 proposed plans, activation pending | Catalog served natively from the Django tables with the v1 availability policy; cart pending | backend/apps/hosting |
| Hosting provisioning | KnownHost/WHM adapter; credentials and wholesale activation pending | Product decision: 20i replaces KnownHost (see docs/HOSTING_20I.md). Supplier-neutral hosting core ported (paid-order fulfilment through the outbox, duplicate-safe provisioning, subscriptions, customer and staff account views, durable lifecycle operations, audit and notification delivery). 20i adapter uses only documented endpoints and stays off until enabled; KnownHost providers deactivated by migration 0003 | backend/apps/hosting |
| Email packages | cPanel mailbox inclusions, not separate subscriptions | Preserve shared-storage/mailbox presentation | frontend/src/pages/HostingPlansPage.tsx |
| Login, registration, email verification, staff invitations | Source implemented; prior live emails confirmed | Ported with v1 messages/throttles; SimpleJWT- and reset-token-compatible (fixture-tested against v1 code); SMTP delivery not yet exercised against a live server | backend/apps/accounts |
| Password recovery | Backend endpoints exist; public recovery UI absent | API ported and Django-token-compatible; the `/reset-password/` page linked from the email still needs a frontend route | backend/apps/accounts/api/urls.py |
| Google/GitHub OAuth | Prior user confirmed successful live login | Ported (signed state, verified-email linking); live provider sign-in not yet exercised | backend/apps/accounts/api/views/oauth.py |
| Permissions and staff/customer access | Source implemented, with explicit business permissions | Database-backed `has_perm`, role matrix, staff lifecycle, customer directory and authorization catalogue ported; staff customer sub-resources follow their domains | backend/apps/accounts/api |
| Cart and checkout | Source implemented; hosting checkout intentionally blocked | Ported (guest carts with merge, catalog re-resolution, contact validation, encrypted hosting passwords, invoice at checkout). Fixed: repeat checkout failed on the unique cart link; KES carts were invoiced in USD; order numbers could collide | backend/apps/orders/services |
| Invoices, refunds, reconciliation and payment webhooks | Source implemented with extensive boundary tests | Invoices, settlement, Paystack/card/M-Pesa initiation, verification and signed/verified webhooks, durable fulfillment ported. Security fixes: manual gateway no longer self-completes; C2B reconciliation requires a registered token; card gateway sends Paystack subunit amounts. Refund/credit-note staff workflows still to port with the admin replacement | backend/apps/billing |
| Support and contact | Public contact and staff support workflows implemented | Ported (routed contact emails, idempotent audited staff ticket actions). New: customer self-service tickets; internal notes never shown to customers | backend/apps/support |
| Blog | Public blog and staff editor implemented; seed commands publish the editorial library | Ported (public list/detail/categories/tags, staff CRUD, v1 HTML allow-list, seed_blog / seed_expanded_blog / seed_domain_service_blog with sitemap). New: audited staff writes, bulk publish/archive (v1 admin actions). Fixed: a duplicate custom slug returned 500 | backend/apps/blog |
| Emails and documents | Implemented templates and notification/PDF services | Account and notification emails (templates, preferences, delivery attempts, in-app list) ported; PDF documents pending | backend/apps/notifications |
| Blogs and managed content | Working public published articles | UI carried; database/content/admin migration pending | backend/apps/blog |
| Assistant and AI Builder | Source API and UI implemented; runtime requires provider configuration | Ported (OpenAI Responses API, strict schema, quotas, claim). Preview and publication now share one renderer. Requires `OPENAI_API_KEY`; default model `gpt-5.6` must be confirmed for the account | backend/apps/ai |
| SEO checks | Deterministic checks over structured pages; crashed when a page repeated a finding | Ported with v1 scoring, one finding per page/code, plus content-depth, length-floor, home page, slug, internal-link and call-to-action checks | backend/apps/seo |
| Websites, WordPress and trial infrastructure | Source implementations with provider/durable operation boundaries | Review per-endpoint completeness; do not omit expansion workflows | backend/apps/websites, backend/apps/wordpress, backend/apps/infrastructure |
| Scheduled work | 29 source management commands identified | Durable outbox schema started; bounded runner/handlers pending | docs/source-inventory.json |
| Historical data migration | No production export authorized for development | Build idempotent importer; use synthetic data; full balances/counts tests pending | docs/source-inventory.json |

## Preservation and integration safety

- The original repository was public, owned by `micahondiwa`; owner admin permission was verified. `maven-host-v1` returned 404 before rename and was not overwritten.
- The existing deployment workflow was disabled before rename. No repository webhooks or deploy keys were listed. Existing named Actions secrets remain in the reference repository and were not read or copied.
- The reference local remote points explicitly at `maven-host-v1`; the separate Next project remote points explicitly at the new `maven-host`. No GitHub redirect is relied upon. The reference working copy and its uncommitted `.gitignore` edit are intact.
- Actions are disabled in the new repository, which has no production deployment workflow or secrets.
- The existing cPanel checkout's Git remote is a cutover integration item: before any future manual fetch/deployment, it must explicitly point to the preserved `maven-host-v1` until the replacement has passed acceptance. Current deployment automation is disabled. The running original app remains the production service; no application files or database records were changed during preservation.
- Inara Crest was inspected read-only for Next.js/cPanel reference. No secrets, data or unrelated business code were copied.

## Acceptance gates

- Clean database migrations and repeatable seeds on supported PostgreSQL plus isolated PostgreSQL 10.23.
- Auth/ownership/organization permission tests, OAuth state/verified-email linking, invitation/password recovery/verification, notification rendering.
- All domain/hosting service operations; restricted provider modes remain disabled where v1 is disabled.
- Exact pricing/billing, cart merge/token security, atomic checkout/catalog re-resolution, signed/idempotent webhooks, reconciliation, invoices/refunds.
- Durable background claims, retry/backoff/stale-lock recovery, renewal and invoice tasks.
- Synthetic full-data import with original identifiers, repeatable counts/relations/balances/password continuity.
- Next production build/start, responsive and end-to-end browser journeys, security checks and no production API proxy.
- Only after all local gates pass: cPanel Node setup, destination DB/version checks, backups, write synchronization/maintenance window, rollback, controlled cutover.

PostgreSQL 10 reached end of support in November 2022. It is an explicit compatibility target, not the recommended long-term database. Driver support is documented at https://node-postgres.com/ and version lifecycle at https://www.postgresql.org/support/versioning/. No newer-server dump will be treated as directly restorable into version 10 without a tested import.
