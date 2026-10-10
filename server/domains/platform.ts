import 'server-only'
import { database, query, queryOne, transaction } from '../db'
import { audit } from '../audit/audit'
import { sendBrandedEmail } from '../communications/email'
import { settings } from '../config'
import { registrarFor } from './registrars'
import { ownedDomain, type DomainRow } from './service'
import { SupplierFeatureUnavailable, type DomainState, type Registrar } from './types'

/**
 * Domain platform, phase 1: customer security controls (registrar lock, WHOIS privacy, transfer code) and the
 * paginated supplier catalog sync. Every capability is backed by a documented supplier operation; anything the
 * supplier adapter does not implement fails closed with a customer-safe message.
 */

const NOT_AVAILABLE = 'This action is not available for this domain online yet. Please contact Maven Host support.'

function capability<K extends 'getDomainState' | 'setLock' | 'setPrivacy' | 'getAuthCode' | 'listTlds'>(registrar: Registrar, name: K): NonNullable<Registrar[K]> {
  const method = registrar[name]
  if (typeof method !== 'function') throw new SupplierFeatureUnavailable(NOT_AVAILABLE)
  return (method as (...args: never[]) => unknown).bind(registrar) as NonNullable<Registrar[K]>
}

type Actor = { userId: string; ip: string | null }

const stateData = (domain: DomainRow, state: DomainState) => ({
  domain_id: domain.id, domain_name: domain.domain_name, status: state.status, expires_on: state.expires_on, locked: state.locked, lock_available: state.lockable,
  privacy_enabled: state.privacy_enabled, privacy_available: state.privacy_allowed, transfer_code_required: state.auth_code_required_for_transfer, renewable: state.can_renew,
})

/** Mirrors live registry flags onto the local record so lists and staff views stay accurate. */
async function remember(domain: DomainRow, state: DomainState) {
  await database().query(
    `UPDATE domains_domain SET locked = $2, privacy_enabled = $3, expires_at = COALESCE($4::date, expires_at), updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND (locked IS DISTINCT FROM $2 OR privacy_enabled IS DISTINCT FROM $3 OR ($4::date IS NOT NULL AND expires_at IS DISTINCT FROM $4::date))`,
    [domain.id, state.locked, state.privacy_enabled, state.expires_on],
  )
}

const record = (actor: Actor, event: string, domain: DomainRow, message: string, metadata: Record<string, unknown> = {}) =>
  audit({ event, category: 'domain', performedBy: actor.userId, target: { appLabel: 'domains', model: 'domain', id: domain.id }, message, ipAddress: actor.ip, metadata: { domain: domain.domain_name, ...metadata } })

export const domainSecurity = {
  /** Live registry state for the customer portal. */
  async state(ownerId: string, domainId: string) {
    const domain = await ownedDomain(ownerId, domainId)
    const state = await capability(registrarFor(domain.registrar_slug), 'getDomainState')(domain.domain_name)
    await remember(domain, state)
    return stateData(domain, state)
  },

  async setLock(ownerId: string, domainId: string, locked: boolean, actor: Actor) {
    const domain = await ownedDomain(ownerId, domainId)
    const registrar = registrarFor(domain.registrar_slug)
    await capability(registrar, 'setLock')(domain.domain_name, locked)
    const state = await capability(registrar, 'getDomainState')(domain.domain_name)
    await remember(domain, state)
    await record(actor, locked ? 'domain_locked' : 'domain_unlocked', domain, `Registrar lock ${locked ? 'enabled' : 'disabled'}.`)
    return stateData(domain, state)
  },

  async setPrivacy(ownerId: string, domainId: string, enabled: boolean, actor: Actor) {
    const domain = await ownedDomain(ownerId, domainId)
    const registrar = registrarFor(domain.registrar_slug)
    await capability(registrar, 'setPrivacy')(domain.domain_name, enabled)
    const state = await capability(registrar, 'getDomainState')(domain.domain_name)
    await remember(domain, state)
    await record(actor, enabled ? 'domain_privacy_enabled' : 'domain_privacy_disabled', domain, `WHOIS privacy ${enabled ? 'enabled' : 'disabled'}.`)
    return stateData(domain, state)
  },

  /**
   * Transfer (EPP) code for moving the domain to another registrar. Shown only to the owner; the code itself is
   * never logged, and the account email is told it was retrieved so an unexpected retrieval is noticed.
   */
  async authCode(ownerId: string, domainId: string, actor: Actor) {
    const domain = await ownedDomain(ownerId, domainId)
    const code = await capability(registrarFor(domain.registrar_slug), 'getAuthCode')(domain.domain_name)
    await record(actor, 'domain_auth_code_retrieved', domain, 'Transfer code retrieved by the account owner.')
    const owner = await queryOne<{ email: string; first_name: string }>('SELECT email, first_name FROM accounts_user WHERE id = $1', [ownerId])
    if (owner)
      await sendBrandedEmail({
        subject: `Transfer code retrieved for ${domain.domain_name}`,
        heading: 'Domain transfer code retrieved',
        textContent: `Hello ${owner.first_name || 'there'},\n\nThe transfer code for ${domain.domain_name} was retrieved from your Maven Host account. If you are moving the domain to another provider, no action is needed.\n\nIf you did not do this, sign in, change your password and contact Maven Host support straight away.`,
        recipients: [owner.email],
        from: settings.email.notificationsFrom,
      }).catch((error) => console.error('Transfer code notification failed', { domainId, error: (error as Error).message }))
    return { domain_id: domain.id, domain_name: domain.domain_name, auth_code: code }
  },
}

// --- Catalog sync ---

/**
 * Pulls the supplier's full extension catalog (paginated) into the TLD table and refreshes one-year wholesale
 * prices. New extensions arrive inactive (staff enable them in Administration); extensions with setup fees or without
 * a price are not priced; extensions the supplier no longer offers are marked unsupported.
 */
export async function syncDomainCatalog(slug = 'openprovider') {
  const tlds = await capability(registrarFor(slug), 'listTlds')()
  if (!tlds.length) throw new SupplierFeatureUnavailable('The supplier returned an empty catalog; nothing was changed.')
  return transaction(async (client) => {
    const registrar = await queryOne<{ id: number }>('SELECT id FROM domains_registrar WHERE slug = $1', [slug], client)
    if (!registrar) throw new Error(`Registrar ${slug} is not configured; run seed_supplier_workflows.`)
    const currencies = new Map((await query<{ id: number; code: string }>('SELECT id, code FROM currencies_currency', [], client)).map((row) => [row.code, row.id]))
    const summary = { extensions: tlds.length, added: 0, supported: 0, priced: 0, price_changes: 0, withdrawn_prices: 0, skipped_currency: 0, unsupported: 0 }
    const seen: string[] = []
    for (const tld of tlds) {
      if (tld.extension.length > 20) continue
      seen.push(tld.extension)
      const metadata = {
        status: tld.active ? 'active' : 'inactive', min_period: tld.min_period, max_period: tld.max_period, renew_available: tld.renew_available,
        transfer_available: tld.transfer_available, transfer_auth_code_required: tld.transfer_auth_code_required, privacy_allowed: tld.privacy_allowed,
        dnssec_allowed: tld.dnssec_allowed, restrictions: tld.restrictions, setup_fee: tld.setup_fee,
      }
      const inserted = await client.query(
        `INSERT INTO domains_tld (extension, display_name, is_active, supports_dnssec, supports_idn, registration_order, is_featured, provider_supported, provider_metadata, last_synced_at, created_at, updated_at)
         VALUES ($1, $2, false, $3, false, 1000, false, $4, jsonb_build_object($5::text, $6::jsonb), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (extension) DO NOTHING`,
        [tld.extension, tld.extension.slice(0, 50), tld.dnssec_allowed, tld.active, slug, JSON.stringify(metadata)],
      )
      if (inserted.rowCount) summary.added++
      else
        await client.query(
          `UPDATE domains_tld SET provider_supported = $2, provider_metadata = provider_metadata || jsonb_build_object($3::text, $4::jsonb), last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE extension = $1`,
          [tld.extension, tld.active, slug, JSON.stringify(metadata)],
        )
      const tldId = (await queryOne<{ id: number }>('SELECT id FROM domains_tld WHERE extension = $1', [tld.extension], client))!.id
      // A price the supplier no longer confirms must not stay sellable: remove it (checkout re-resolves and fails closed).
      const withdraw = async (priceTypes: string[]) => {
        const removed = await client.query('DELETE FROM domains_domainprice WHERE registrar_id = $1 AND tld_id = $2 AND years = 1 AND price_type = ANY($3::text[])', [registrar.id, tldId, priceTypes])
        summary.withdrawn_prices += removed.rowCount ?? 0
      }
      if (tld.active) summary.supported++
      if (!tld.active || tld.setup_fee || tld.min_period === null || tld.min_period > 1) {
        await withdraw(['register', 'renew', 'transfer'])
        continue
      }
      const offers: [string, { currency: string; price: string } | null][] = [
        ['register', tld.prices.register],
        ['renew', tld.renew_available ? tld.prices.renew : null],
        ['transfer', tld.transfer_available ? tld.prices.transfer : null],
      ]
      for (const [priceType, offer] of offers) {
        if (!offer) {
          await withdraw([priceType])
          continue
        }
        const currencyId = currencies.get(offer.currency)
        if (!currencyId) {
          summary.skipped_currency++
          await withdraw([priceType])
          continue
        }
        const previous = await queryOne<{ price: string; currency_id: number }>(
          'SELECT price, currency_id FROM domains_domainprice WHERE registrar_id = $1 AND tld_id = $2 AND price_type = $3 AND years = 1',
          [registrar.id, tldId, priceType],
          client,
        )
        if (previous && (Number(previous.price) !== Number(offer.price) || previous.currency_id !== currencyId)) summary.price_changes++
        await client.query(
          `INSERT INTO domains_domainprice (price_type, years, price, last_synced_at, created_at, updated_at, currency_id, registrar_id, tld_id)
           VALUES ($1, 1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3, $4, $5)
           ON CONFLICT (registrar_id, tld_id, price_type, years) DO UPDATE SET price = EXCLUDED.price, currency_id = EXCLUDED.currency_id, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
          [priceType, offer.price, currencyId, registrar.id, tldId],
        )
        summary.priced++
      }
    }
    const gone = await query<{ id: number }>(
      `UPDATE domains_tld SET provider_supported = false, updated_at = CURRENT_TIMESTAMP
        WHERE provider_supported AND provider_metadata ? $1 AND NOT (extension = ANY($2::text[])) RETURNING id`,
      [slug, seen],
      client,
    )
    summary.unsupported = gone.length
    if (gone.length)
      summary.withdrawn_prices += (await client.query('DELETE FROM domains_domainprice WHERE registrar_id = $1 AND tld_id = ANY($2::bigint[])', [registrar.id, gone.map((row) => row.id)])).rowCount ?? 0
    await audit({ event: 'domain_catalog_synced', category: 'domain', status: 'success', message: `Domain catalog synchronised from ${slug}.`, metadata: summary }, client)
    return summary
  })
}
