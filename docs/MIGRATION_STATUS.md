# Migration status — 6 October 2026

## Completed preservation

- Renamed the original public GitHub repository to [maven-host-v1](https://github.com/micahondiwa/maven-host-v1) after verifying owner/admin rights and target-name availability. History and code are preserved. Original local directory remains `D:/maven-host` with its original uncommitted `.gitignore` edit.
- Created a separate public [maven-host](https://github.com/micahondiwa/maven-host) repository at `D:/maven-host-next`. Both local remotes explicitly identify the correct repository.
- Disabled the old deployment workflow before rename and disabled Actions in the new repository. No production application files or data were changed.
- Read-only Inara Crest reference inspection confirmed the current Next.js version and the standalone cPanel deployment pattern. No secrets, customer data or unrelated business code were copied; deployment preparation has not started.
- Generated source inventory of 64 model classes, 1,155 Python files, 21 route modules, 53 frontend route declarations, 29 management commands and 143 source test files. High-level parity classifications are in `FUNCTIONAL_PARITY.md`.

## Verified local foundation

- Next.js 16.3.8, React 19.2.4 and TypeScript. Approved UI, logo, brand assets, contacts, content and restrained motion carried forward; public routes use Next.js routing. Native navigation adapter preserves existing component interfaces while routes move to App Router.
- Native PostgreSQL-backed hosting catalog: 23 configurations and 47 exact USD price records, preserving approved limits, billing periods, tax-inclusive offers and pending supplier activation.
- Versioned/checksummed SQL migrations with advisory locking, rollback and replay checks. Repeatable local hosting seeds. Development migration/seed tooling refuses non-loopback databases and requires explicit local-only configuration.
- Exact monetary arithmetic preserves source cart tax of zero because published hosting prices already include VAT. No financial provider integration or checkout acceptance is claimed.
- Django PBKDF2-SHA256 and PBKDF2-SHA1 password verification tested against Python-generated synthetic hashes, including Unicode. Unsupported hash schemes are not silently accepted; imported-hash inventory/reset handling remains to implement.
- Durable outbox primitives: transactional enqueue/deduplication, concurrent claim locking, 15-minute stale recovery, attempt-fenced completion, bounded processing and retry/backoff. Errors persist a redacted code. Business event handlers and cron command wiring remain to port.
- All other API operations explicitly return `503 migration_in_progress`; they neither proxy to Django nor simulate success. These are deliberate unfinished boundaries, not completed customer flows.

## Verification evidence

- `npm run lint`: pass, no warnings.
- Type generation/typecheck and Next production build: pass.
- Dependency audit: zero reported vulnerabilities across runtime and development dependencies after updating the supported linter/test toolchain.
- Both current migrations and seeds passed on isolated PostgreSQL 18.6 and 10.23. Replay/seed repetition created no duplicate plans/prices.
- 11 automated foundation tests passed on each PostgreSQL version: monetary precision/cardinality, password continuity, outbox deduplication/rollback, concurrent claims, stale recovery, backoff and exact seed records.
- Built application tested through `next start`, rather than only dev mode. Eight public pages passed no-overflow checks at 320, 390, 768, 1024 and 1366 px. Native catalog responses contained 23 plans/47 prices, Inara Devs link and theme switching worked, and no browser JavaScript/hydration errors occurred. Checkout remained unavailable.
- Fixed a new-stack regression: non-breaking indentation in the source header rendered as flex text under Next.js; normalized indentation in the new copy. Original source remains unchanged.

These results establish this foundation only. They do not prove full application parity or production compatibility. Tests used synthetic records and previously captured public product definitions, never customer data. Local PostgreSQL 10.23 binaries are isolated under `.local/`, verified by archive digest and not installed as a system service. PostgreSQL 10 is unsupported upstream and is a compatibility target only; see https://www.postgresql.org/support/versioning/ and https://node-postgres.com/ for lifecycle and driver support.

## Remaining implementation and acceptance

1. Complete native auth/token/session/recovery/verification/OAuth APIs, user/profile/role migrations and server-side authorization. Wire private account/staff route layouts and all administrative workflows.
2. Port domains, hosting service management, cart/checkout, invoices, payments/webhooks/reconciliation/refunds and all provider restrictions/adapters. Test ownership, amounts, currency, callback signatures and idempotency.
3. Port support, managed blogs/resources, email/PDF templates, AI, website/WordPress/trial operations, notification jobs and all 29 scheduled/management command behaviours.
4. Build actual-source data import tooling with retained identifiers, relationships, timestamps and balances. Prove repeatability and password/account continuity using authorized synthetic/sanitized data.
5. Complete the full parity checklist and production-mode end-to-end tests on both local database versions. No provider, financial or authenticated OAuth end-to-end acceptance has been claimed.
6. Only then prepare cPanel/Passenger configuration, destination database/version checks, environment-variable documentation, backups/final synchronization, rollback and controlled cutover with supplied infrastructure.

Current production remains the Django application. No Node replacement, customer-data migration, provider transaction or decommissioning has occurred. The source cPanel checkout remote is a future integration item and must explicitly identify the reference repo before any manual fetch/deployment of v1.
