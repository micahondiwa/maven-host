import 'server-only'
import { database, query, type Queryable } from '../db'
import { PricingNotAvailableError } from './types'

/**
 * Supplier routing for new registrations (apps/domains/registrars/routing.py). Openprovider is the sole
 * provisioning source for every extension, including .ke and .tz. Register.co.ke and registry.co.tz remain
 * proposed providers in standby until accreditation; they can be routed to later via DOMAIN_COUNTRY_REGISTRARS.
 * Existing domains always stay with the registrar recorded on the domain.
 */

const KENYA = ['.co.ke', '.or.ke', '.ne.ke', '.me.ke', '.mobi.ke', '.info.ke', '.ac.ke', '.go.ke', '.sc.ke', '.ke']
const TANZANIA = ['.co.tz', '.or.tz', '.ne.tz', '.ac.tz', '.go.tz', '.me.tz', '.sc.tz', '.info.tz', '.mobi.tz', '.tz']

function list(name: string, fallback: string[]) {
  const value = process.env[name]?.trim()
  return value ? value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) : fallback
}

export const routingConfig = {
  get generalRegistrar() {
    return (process.env.DOMAIN_GENERAL_REGISTRAR?.trim() || 'openprovider').toLowerCase()
  },
  get countryRegistrars(): Record<string, string> {
    const raw = process.env.DOMAIN_COUNTRY_REGISTRARS?.trim()
    if (raw) return Object.fromEntries(Object.entries(JSON.parse(raw) as Record<string, string>).map(([suffix, slug]) => [suffix.toLowerCase(), slug.toLowerCase()]))
    return {}
  },
  get countryExtensions() {
    return list('DOMAIN_COUNTRY_EXTENSIONS', [...KENYA, ...TANZANIA])
  },
}

export function slugForExtension(extension: string): string {
  const value = extension.toLowerCase()
  const routes = routingConfig.countryRegistrars
  for (const suffix of Object.keys(routes).sort((a, b) => b.length - a.length)) if (value === suffix || value.endsWith(suffix)) return routes[suffix]
  return routingConfig.generalRegistrar
}

export async function tldExtensions(db: Queryable = database()) {
  return (await query<{ extension: string }>('SELECT extension FROM domains_tld', [], db)).map((row) => row.extension)
}

/** Longest known suffix of a domain name. */
export function extensionFor(domain: string, known: string[]) {
  const name = domain.trim().toLowerCase().replace(/\.$/, '')
  const candidates = [...new Set([...known, ...routingConfig.countryExtensions])].sort((a, b) => b.length - a.length)
  return candidates.find((value) => name.endsWith(value)) ?? `.${name.split('.').pop()}`
}

export const flag = (name: string) => (process.env[name] ?? '').trim().toLowerCase() === 'true'

export const openproviderReady = () => flag('OPENPROVIDER_ENABLED') && flag('OPENPROVIDER_TRANSACTIONS_ENABLED')

/** Refuses purchases through suppliers that are not live. */
export function assertSupplierReady(slug: string) {
  if (slug === 'openprovider' && !openproviderReady()) throw new PricingNotAvailableError('Openprovider purchases are disabled pending verification.')
  if (slug === 'register_ke') throw new PricingNotAvailableError('Register.co.ke purchases are disabled pending reseller API integration.')
  if (slug === 'registry_tz') throw new PricingNotAvailableError('registry.co.tz purchases are disabled pending reseller API integration.')
  if (slug === 'kenic') throw new PricingNotAvailableError('The direct KeNIC integration has been retired.')
}

export function permittedPrice(registrarSlug: string, extension: string) {
  return registrarSlug === slugForExtension(extension)
}
