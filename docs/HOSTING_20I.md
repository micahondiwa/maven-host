# Hosting supplier: 20i

**Decision (2026-10-09):** 20i (reseller hosting, StackCP) replaces KnownHost as Maven Host's hosting supplier.
Openprovider remains the sole domain supplier. Customers only ever see Maven Host; supplier names, package ids and
raw responses stay server-side.

## How it fits together

- Domains are registered through Openprovider. A hosted domain points at the hosting platform's nameservers through
  the existing Openprovider nameserver operation; once that happens, DNS for that domain is authoritative at 20i.
- A Maven hosting plan (`hosting_hostingplan`) is sold through a verified package (`hosting_hostingpackage`) whose
  `package_name` is the 20i package type id and whose provider is the `twentyi` supplier record.
- Paid hosting order → `orders.fulfillment.requested` outbox event → `fulfillHostingItem` → `provisionHosting`.
  A pending account row is written first; the supplier is then searched by domain, so a retry after a timeout adopts
  the package created earlier instead of buying a second one.
- 20i packages do not live on Maven-managed servers, so `hosting_hostingaccount.server_id` is now nullable (0003).

## Capability matrix

| Capability | 20i endpoint | Status |
| --- | --- | --- |
| Connection check / list packages | `GET /package` | Implemented (read-only `npm run manage -- check_twentyi`) |
| Provision hosting package | `POST /reseller/{id}/addWeb` (`type`, `domain_name`, `label`) | Implemented; requires `TWENTYI_TRANSACTIONS_ENABLED` |
| Find account by domain / read state (`enabled`) | `GET /package` | Implemented (duplicate protection, suspension state) |
| Mailboxes | `POST /package/{id}/email/{domain}` | Documented; not wired yet |
| List StackCP users | `GET /reseller/{id}/susers` | Documented; not wired yet |
| Create StackCP user / single sign-on | — | Unconfirmed: needs the authenticated 20i API console |
| Suspend / unsuspend / terminate | — | Unconfirmed: customers get "contact support" (409) until confirmed |
| Package change, password, backups | — | Unconfirmed: 409 until confirmed |
| Reseller sub-accounts (WHM feature) | — | No equivalent; 409 |
| Package types list | `/packageTypes` (path not fully specified) | Unconfirmed |

Endpoints marked unconfirmed are deliberately not guessed. When they are confirmed in the 20i API console, the adapter
adds the capability and the existing durable operation pipeline (`hosting_hostingoperation`) runs them.

## Activation checklist

1. Open the 20i reseller account; generate the general API key at my.20i.com/reseller/api.
2. Put the key in the server environment only (`TWENTYI_GENERAL_API_KEY`), set `TWENTYI_ENABLED=true`, and run
   `npm run manage -- check_twentyi` (read-only).
3. Create 20i package types for each Maven plan, then record each as a verified `hosting_hostingpackage`
   (`package_name` = package type id, `is_provider_verified`, `is_provisionable`, `last_verified_at`, entitlements).
4. Set retail prices (GBP wholesale cost converts through the exchange-rate tables) and clear `requires_quote`.
5. Activate the `twentyi` provider record and set `TWENTYI_TRANSACTIONS_ENABLED=true` only after explicit approval.
   20i has no sandbox: the first provisioning is a live purchase.

## Sources

- https://www.20i.com/reseller-hosting
- https://docs.20i.com/api/20i-api-documentation
- https://docs.20i.com/api/provision-hosting-package-api
- https://docs.20i.com/api/retrieve-packages-api
- https://docs.20i.com/api/stackusers-api
- https://docs.20i.com/api/provision-mailbox-api
