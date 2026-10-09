import 'server-only'
import { routingConfig } from '../routing'
import { SupplierFeatureUnavailable, type Registrar } from '../types'
import { OpenproviderRegistrar } from './openprovider'

/**
 * Approved suppliers whose reseller APIs are not yet documented fail closed without network requests; no endpoint,
 * credential format or payload is guessed (apps/domains/registrars/register_ke.py).
 */
function standby(slug: string, message: string): Registrar {
  const notReady = async (): Promise<never> => {
    throw new SupplierFeatureUnavailable(message)
  }
  return {
    slug,
    checkDomains: notReady, registerDomain: notReady, getRegistrationInfo: notReady, renewDomain: notReady,
    getContacts: notReady, setContacts: notReady, getNameservers: notReady, setNameservers: notReady,
    getDnsHosts: notReady, setDnsHosts: notReady, getDnsRecords: notReady, createDnsRecord: notReady,
    updateDnsRecord: notReady, deleteDnsRecord: notReady,
  }
}

const FACTORIES: Record<string, () => Registrar> = {
  openprovider: () => new OpenproviderRegistrar(),
  register_ke: () => standby('register_ke', 'Register.co.ke is in standby pending reseller API documentation and credentials.'),
  registry_tz: () => standby('registry_tz', 'registry.co.tz is in standby pending reseller API documentation and credentials.'),
}

let override: ((slug: string) => Registrar | undefined) | null = null

/** Tests substitute deterministic registrars; production always uses the real adapters. */
export function setRegistrarOverride(factory: ((slug: string) => Registrar | undefined) | null) {
  override = factory
}

/** RegistrarManager.get */
export function registrarFor(slug?: string | null): Registrar {
  const key = (slug ?? routingConfig.generalRegistrar).toLowerCase()
  const replaced = override?.(key)
  if (replaced) return replaced
  const factory = FACTORIES[key]
  if (!factory) throw new Error(`Unsupported registrar '${key}'.`)
  return factory()
}
