import 'server-only'
import { database, query, queryOne } from '../db'
import { audit } from '../audit/audit'
import { HttpError } from '../http/errors'
import { sendBrandedEmail } from '../communications/email'
import { settings } from '../config'
import { catalogProduct, createRenewalOrder } from '../orders/service'
import { ownedDomain } from './service'

/**
 * Domain renewals, phase 2: renewal quotes for the portal, the customer auto-renew switch, and the daily job that sends
 * expiry reminders and issues Maven Host auto-renew invoices. Maven Host bills renewals itself; the supplier's own
 * auto-renew stays off, so nothing renews at the registry until the customer has paid.
 */

const REMINDER_DAYS = [30, 7, 1] as const
const AUTO_INVOICE_DAYS = 14
const GRACE_DAYS = 30
const OPEN_ORDER = `EXISTS (SELECT 1 FROM orders_order_item i JOIN orders_order o ON o.id = i.order_id
  WHERE i.product_type = 'domain' AND i.configuration ->> 'operation' = 'renew' AND i.configuration ->> 'domain_id' = d.id::text
    AND o.status IN ('pending_payment', 'paid', 'provisioning'))`

/** Nairobi calendar date (YYYY-MM-DD). */
const nairobiDate = (at: Date) => new Date(at.getTime() + 3 * 3600_000).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Renewal price and state for the portal; `price` is null when the domain cannot be renewed online. */
export async function renewalQuote(ownerId: string, domainId: string) {
  const domain = await ownedDomain(ownerId, domainId)
  const price = await queryOne<{ id: number }>(`SELECT id FROM domains_domainprice WHERE registrar_id = $1 AND tld_id = $2 AND price_type = 'renew' AND years = 1`, [domain.registrar_id, domain.tld_id])
  let renewable = Boolean(price) && ['active', 'expired', 'pending'].includes(domain.status)
  let quote: { product_id: string; usd: string; kes: string | null } | null = null
  if (renewable && price) {
    try {
      const usd = await catalogProduct('domain', String(price.id), 'USD')
      const kes = await catalogProduct('domain', String(price.id), 'KES').catch(() => null)
      quote = { product_id: usd.id, usd: usd.unit_price, kes: kes?.unit_price ?? null }
    } catch (error) {
      // Supplier switched off, extension inactive or no pricing rule: show the domain as not renewable online.
      if (!(error instanceof HttpError)) throw error
      renewable = false
    }
  }
  const open = await queryOne<{ order_id: string; status: string }>(
    `SELECT o.id AS order_id, o.status FROM orders_order_item i JOIN orders_order o ON o.id = i.order_id
      WHERE i.product_type = 'domain' AND i.configuration ->> 'operation' = 'renew' AND i.configuration ->> 'domain_id' = $1 AND o.status = 'pending_payment'
      ORDER BY o.created_at DESC LIMIT 1`,
    [domain.id],
  )
  return {
    domain_id: domain.id, domain_name: domain.domain_name, expires_at: domain.expires_at, auto_renew: domain.auto_renew, renewable, years: 1, price: quote,
    pending_order_id: open?.order_id ?? null,
  }
}

/** Customer auto-renew switch: when on, Maven Host issues the renewal invoice 14 days before expiry. */
export async function setAutoRenew(ownerId: string, domainId: string, enabled: boolean, actor: { userId: string; ip: string | null }) {
  const domain = await ownedDomain(ownerId, domainId)
  if (domain.auto_renew !== enabled) {
    await database().query('UPDATE domains_domain SET auto_renew = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [domain.id, enabled])
    await audit({
      event: enabled ? 'domain_auto_renew_enabled' : 'domain_auto_renew_disabled', category: 'domain', performedBy: actor.userId, ipAddress: actor.ip,
      target: { appLabel: 'domains', model: 'domain', id: domain.id }, message: `Auto-renew ${enabled ? 'enabled' : 'disabled'} by the owner.`, metadata: { domain: domain.domain_name },
    })
  }
  return renewalQuote(ownerId, domainId)
}

type DueDomain = { id: string; domain_name: string; expires_at: string; auto_renew: boolean; owner_id: string; email: string; first_name: string; preferred_currency: string | null }

async function claim(domainId: string, kind: string, expiresAt: string, orderId: string | null = null) {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO domains_renewalnotice (domain_id, kind, expires_at, order_id, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (domain_id, kind, expires_at) DO NOTHING RETURNING id`,
    [domainId, kind, expiresAt, orderId],
  )
  return row?.id ?? null
}

const portal = (domainId: string) => `${settings.frontendUrl}/account/domains/${domainId}`

async function notify(domain: DueDomain, subject: string, heading: string, body: string) {
  await sendBrandedEmail({ subject, heading, textContent: `Hello ${domain.first_name || 'there'},\n\n${body}\n\nManage this domain: ${portal(domain.id)}`, recipients: [domain.email], from: settings.email.billingFrom })
}

/**
 * Daily renewal job: automatic invoices first (auto-renew domains within 14 days of expiry, unless an unpaid or
 * in-progress renewal order already exists), then one reminder per threshold (30, 7, 1 days) and one expiry notice.
 * Each notice is claimed in the database before sending, so a rerun or overlapping run cannot duplicate it.
 */
export async function processDomainRenewals(now = new Date()) {
  const today = nairobiDate(now)
  const summary = { invoices: 0, reminders: 0, expired_notices: 0, failures: 0 }
  const due = await query<DueDomain>(
    `SELECT d.id, d.domain_name, d.expires_at::text AS expires_at, d.auto_renew, d.owner_id, u.email, u.first_name, p.preferred_currency
       FROM domains_domain d JOIN accounts_user u ON u.id = d.owner_id LEFT JOIN accounts_profile p ON p.user_id = u.id
      WHERE d.status IN ('active', 'expired') AND d.expires_at IS NOT NULL AND u.is_active
        AND d.expires_at BETWEEN $1::date AND $2::date`,
    [addDays(today, -GRACE_DAYS), addDays(today, Math.max(...REMINDER_DAYS))],
  )

  for (const domain of due) {
    const daysLeft = daysBetween(today, domain.expires_at)
    try {
      if (domain.auto_renew && daysLeft <= AUTO_INVOICE_DAYS && !(await queryOne(`SELECT 1 FROM domains_domain d WHERE d.id = $1 AND ${OPEN_ORDER}`, [domain.id]))) {
        const claimed = await claim(domain.id, 'auto_invoice', domain.expires_at)
        if (claimed) {
          const currency = domain.preferred_currency === 'KES' ? 'KES' : 'USD'
          let order: Awaited<ReturnType<typeof createRenewalOrder>>
          try {
            order = await createRenewalOrder(domain.owner_id, domain.id, currency)
          } catch (error) {
            await database().query('DELETE FROM domains_renewalnotice WHERE id = $1', [claimed])
            throw error
          }
          if (!order) await database().query('DELETE FROM domains_renewalnotice WHERE id = $1', [claimed])
          else {
            await database().query('UPDATE domains_renewalnotice SET order_id = $2 WHERE id = $1', [claimed, order.order_id])
            await audit({ event: 'domain_auto_renew_invoiced', category: 'domain', target: { appLabel: 'domains', model: 'domain', id: domain.id }, message: `Automatic renewal invoice ${order.invoice_number} issued.`, metadata: { order_id: order.order_id, expires_at: domain.expires_at } })
            await notify(domain, `Renewal invoice for ${domain.domain_name}`, 'Your domain renewal invoice',
              `${domain.domain_name} expires on ${domain.expires_at}. Auto-renew is on, so we have issued renewal invoice ${order.invoice_number}. Pay it before the expiry date and we will renew the domain for another year.\n\nPay now: ${settings.frontendUrl}/orders/${order.order_id}/pay`)
            summary.invoices++
          }
        }
      }

      if (daysLeft < 0) {
        if (await claim(domain.id, 'expired', domain.expires_at)) {
          await notify(domain, `${domain.domain_name} has expired`, 'Your domain has expired',
            `${domain.domain_name} expired on ${domain.expires_at}. Websites and email using it may stop working. Renew it as soon as possible; after the registry grace period, recovery costs more or may not be possible.`)
          summary.expired_notices++
        }
        continue
      }
      // One reminder per run: the nearest threshold not yet sent; larger thresholds are marked sent with it.
      const applicable = REMINDER_DAYS.filter((days) => daysLeft <= days)
      if (!applicable.length) continue
      const nearest = Math.min(...applicable)
      let sent = false
      for (const days of [...applicable].sort((a, b) => a - b)) {
        const claimed = await claim(domain.id, `reminder_${days}`, domain.expires_at)
        if (claimed && days === nearest) sent = true
      }
      if (sent) {
        const autoLine = domain.auto_renew ? 'Auto-renew is on: pay the renewal invoice we sent to keep it active.' : 'Auto-renew is off: renew it from your account to keep it active.'
        await notify(domain, `${domain.domain_name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, 'Your domain is due for renewal', `${domain.domain_name} expires on ${domain.expires_at}. ${autoLine}`)
        summary.reminders++
      }
    } catch (error) {
      summary.failures++
      console.error('Domain renewal processing failed', { domainId: domain.id, error: (error as Error).message })
    }
  }
  return summary
}
