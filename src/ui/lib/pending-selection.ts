// Lets an anonymous visitor pick a domain on the public search, then
// continue straight into the purchase flow after they sign in or register.

const KEY = 'mwh_pending_domain'

export type PendingDomainSelection = {
  domain: string
  resource_id: number
  billing_cycle: string
  currency?: 'USD'
}

export function setPendingDomainSelection(selection: PendingDomainSelection) {
  sessionStorage.setItem(KEY, JSON.stringify(selection))
}

export function getPendingDomainSelection(): PendingDomainSelection | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingDomainSelection
  } catch {
    return null
  }
}

export function clearPendingDomainSelection() {
  sessionStorage.removeItem(KEY)
}
