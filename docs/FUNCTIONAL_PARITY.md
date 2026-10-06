# Functional parity checklist

Source commit: `58e0bb2540fd1376d45495ad8ad6c74a2dd6a6b7` in `micahondiwa/maven-host-v1`.

The source contains 77,074 tracked Python lines across 1,155 files, 64 model classes with field definitions, 21 route modules, 53 explicit frontend route declarations, 29 management commands and 143 test files. `source-inventory.json` records symbols, model declarations/relationships/meta constraints and route targets. Zero Python parse errors.

A source implementation or test file does not prove a provider integration works. "Working" below means prior observed production behaviour; all other source implementations remain unverified until equivalent local tests run. The new app is not complete and must not replace production yet.

| Area | Source state/evidence | Next migration state | Source location |
|---|---|---|---|
| Public branding and navigation | Working in deployed v1; carried to Next UI | UI carried; SSR, hydration and browser parity pending | frontend/src/components/CustomerHeader.tsx |
| Domain search and suggestions | Working in v1 production smoke checks | Server adapter/API port pending | backend/apps/domains/api/urls.py |
| Registration, transfer, renewal and DNS | Source implemented; provider integration depends on credentials | Not ported; lifecycle and recovery tests required | backend/apps/domains |
| Register.co.ke | Intentionally disabled awaiting actual reseller API | Keep disabled; no invented API | docs/supplier-workflows.md |
| Hosting plans and cart selection | Working; 23 proposed plans, activation pending | UI carried; catalog and cart backend port pending | backend/apps/hosting |
| KnownHost provisioning | Adapter exists; credentials and wholesale activation pending | Keep checkout/provisioning restrictions | backend/apps/hosting/providers/knownhost.py |
| Email packages | cPanel mailbox inclusions, not separate subscriptions | Preserve shared-storage/mailbox presentation | frontend/src/pages/HostingPlansPage.tsx |
| Login, registration, email verification, staff invitations | Source implemented; prior live emails confirmed | Password primitive started; APIs, tokens and email port pending | backend/apps/accounts |
| Password recovery | Backend endpoints exist; public recovery UI absent | Preserve backend recovery; track UI gap as pre-existing | backend/apps/accounts/api/urls.py |
| Google/GitHub OAuth | Prior user confirmed successful live login | Port state/PKCE, token checks and safe account linking | backend/apps/accounts/api/views/oauth.py |
| Permissions and staff/customer access | Source implemented, with explicit business permissions | Server-side authorization port pending; UI guards insufficient | backend/apps/accounts/api |
| Cart and checkout | Source implemented; hosting checkout intentionally blocked | Exact decimal helper started; catalog re-resolution/ownership port pending | backend/apps/orders/services |
| Invoices, refunds, reconciliation and payment webhooks | Source implemented with extensive boundary tests | Port all transactions, signatures, idempotency and accounting before acceptance | backend/apps/billing |
| Support and contact | Public contact and staff support workflows implemented | UI carried; ticket/notification services pending | backend/apps/support |
| Emails and documents | Implemented templates and notification/PDF services | Server render, attachments and outbox deliveries pending | backend/apps/notifications |
| Blogs and managed content | Working public published articles | UI carried; database/content/admin migration pending | backend/apps/blog |
| Assistant and AI Builder | Source API and UI implemented; runtime requires provider configuration | Port adapters and access/rate limits; no invented AI responses | backend/apps/ai |
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
