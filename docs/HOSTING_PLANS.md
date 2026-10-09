# Cloud hosting lineup and pricing (proposal, 2026-10-09)

Three website hosting plans on 20i replace the KnownHost-specified shared plans. The four reseller ("+") plans are
dropped: they were whole WHM reseller pools, and 20i has no documented API for selling sub-reseller accounts.
Migration `0004_cloud_hosting_catalog.sql` applies this; rows are deactivated, never deleted. Prices can be changed
later from staff tools without a migration.

## Plans

| | Cloud Starter | Cloud Business (most popular) | Cloud Pro |
| --- | --- | --- | --- |
| Websites | 1 | 5 | 20 |
| Website storage | 10 GB | 50 GB | 100 GB |
| Mailboxes (10 GB each) | 5 | 25 | Unlimited |
| MySQL databases | 5 | Unlimited | Unlimited |
| Monthly | $3.49 · KSh 449 | $6.99 · KSh 899 | $11.99 · KSh 1,549 |
| 1 year | **$29.99 · KSh 3,899** | **$59.99 · KSh 7,799** | **$99.99 · KSh 12,999** |
| 2 years | $54.99 · KSh 6,999 | $109.99 · KSh 13,999 | $179.99 · KSh 22,999 |

All prices include 16% VAT and renew at the same price (no introductory discount that jumps at renewal).

## Currencies

USD is the base and default. Following the inaracresttechnologies.com pattern, customers can switch the display
currency: **USD** and **KES** are payment currencies (fixed catalog prices above; card or M-Pesa), while **UGX, TZS and
RWF** under "Other currencies" show an indicative conversion from USD with the rate's timestamp, and are charged in USD.
Rates come from ExchangeRate-API's open endpoint (attribution "Rates By Exchange Rate API" is shown with conversions);
v1's Frankfurter/ECB source publishes no KES, UGX, TZS or RWF rates. A cart holds one charge currency.

## Removed

The managed VPS and dedicated server plans were KnownHost hardware configurations; migration
`0005_retire_knownhost_infrastructure.sql` withdraws them (and any KnownHost packages) until infrastructure products are
defined on 20i.

Every plan includes, as published by 20i for its reseller platform: unlimited bandwidth, free SSL (including
wildcard), global Anycast CDN, web application firewall, DDoS protection, malware scanning, two-factor sign-in,
WordPress manager and staging, WP-CLI, SSH, Git, PHP version control, DNS management, webmail, autoresponders,
spam filtering, DKIM and free website migration. Backup retention and data-centre location are **not** advertised
until confirmed in the 20i account.

The limits are targets: each must be configured as a 20i package type and verified by staff before the plan can be
bought (until then the site shows "pending activation" and checkout stays closed).

## Why these prices

**Market (Kenya, 2026).** Shared hosting is commonly sold for KES 2,000–6,000 a year; reliable plans with decent
support sit around KES 3,000–6,000 and premium tiers reach KES 10,000–25,000. Cloud Starter (KSh 3,899) sits in the
reliable band. Cloud Business (KSh 7,799) is priced against competitors' upper shared tiers, and Cloud Pro
(KSh 12,999) against their top tiers, while offering separate 10 GB mailboxes, a CDN and a WAF, which local entry
plans usually lack. The previous KnownHost-based Maven Basic was US$112.13 a year (about KSh 14,500), roughly four
times the local entry price.

**Cost.** 20i bills per reseller plan, not per site: Reseller 50 is £39.99/month (50 accounts), Reseller 500
£69.99/month and Unlimited £99.99/month. At an assumed ~US$1.27 per £ (check the live rate), the cost per hosting
account is roughly:

| Accounts sold | 20i plan | Cost per account per year |
| --- | --- | --- |
| 25 | Reseller 50 | ~US$24 |
| 50 | Reseller 50 | ~US$12 |
| 200 | Reseller 500 | ~US$5 |
| 500 | Reseller 500 | ~US$2 |

Cloud Starter nets about US$24.80 a year after VAT and ~3.5% payment fees, so it roughly **breaks even at 25 accounts**
and earns about 50% at 50 accounts and 75–90% at scale. Business and Pro are profitable from the first sale. Start on
Reseller 50 (first month £1) and move to Reseller 500 at about 40 accounts. Support time, domain costs and add-ons such
as Website Turbo are not included in this model.

**Billing terms.** Monthly prices are ~45–55% higher than the annual monthly equivalent to steer customers to annual
terms; the two-year term saves a further ~8–10%. Three-year terms are not offered.

## Sources

- 20i reseller plans and features: https://www.20i.com/reseller-hosting
- Kenyan market price ranges: https://truehost.co.ke/comparing-web-hosting-prices/,
  https://novahost.co.ke/blog/web-hosting-prices-kenya/, https://nescom.co.ke/website-hosting-cost-in-kenya,
  https://www.hostraha.com/blog/best-web-hosting-kenya-2026
