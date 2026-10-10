import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@/lib/navigation'
import { ArrowRight, LoaderCircle, Trash2 } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { ApiError, checkout, removeCartItem } from '../lib/api'
import { useCart } from '../lib/cart'
import { useCurrency } from '../lib/currency'
import { useAuth } from '../lib/auth'

import { SEO } from '../components/SEO'
import { DomainContactFields, validateDomainContact } from '../components/DomainContactFields'
export function CartPage() {
  const { cart, loading, refresh } = useCart()
  const currency = useCurrency()
  const money = (value: string) => currency.format(value, cart?.currency ?? 'USD')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)
  const [hostingPasswords, setHostingPasswords] = useState<Record<string, string>>({})
  const [hostingDomains, setHostingDomains] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [domainContact, setDomainContact] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!user) return
    setDomainContact(current => ({ ...current, first_name: current.first_name || user.first_name || '',
      last_name: current.last_name || user.last_name || '', email: current.email || user.email || '' }))
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!cart) return
    setHostingDomains((current) => {
      const next = { ...current }
      cart.items.filter((item) => item.product_type === 'hosting').forEach((item) => {
        if (next[item.item_id] === undefined) next[item.item_id] = item.domain_name ?? ''
      })
      return next
    })
  }, [cart])

  async function remove(itemId: string) {
    setRemovingId(itemId)
    try {
      await removeCartItem(itemId)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not remove this item.')
    } finally {
      setRemovingId(null)
    }
  }

  const checkoutBlocked = cart?.items.some(item => item.checkout_blocked) ?? false

  async function proceedToCheckout() {
    if (checkoutBlocked) { setError('Hosting checkout is not available yet. Your selection is saved in your cart.'); return }
    if (!user) {
      navigate(`/login?next=${encodeURIComponent('/cart')}`)
      return
    }
    // Registrant contact is needed for new registrations only; renewals keep the existing registrant.
    const hasDomains = cart?.items.some(item => item.product_type === 'domain' && item.operation !== 'renew')
    const contactError = hasDomains ? validateDomainContact(domainContact) : null
    if (contactError) {
      setError(contactError)
      return
    }
    const hostingItems = cart?.items.filter((item) => item.product_type === 'hosting') ?? []
    if (hostingItems.some((item) => (hostingPasswords[item.item_id] ?? '').length < 8)) {
      setError('Enter a control panel password of at least 8 characters for each hosting plan.')
      return
    }
    const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
    if (hostingItems.some((item) => !domainPattern.test((hostingDomains[item.item_id] ?? '').trim()))) {
      setError('Enter a primary domain for each hosting plan before checkout. You can add hosting to your cart without a domain first.')
      return
    }
    setError('')
    setCheckingOut(true)
    try {
      const result = await checkout(
        '',
        Object.fromEntries(hostingItems.map((item) => [item.item_id, hostingPasswords[item.item_id]])),
        Object.fromEntries(hostingItems.map((item) => [item.item_id, (hostingDomains[item.item_id] ?? '').trim()])),
        hasDomains ? { ...domainContact, country: domainContact.country.toUpperCase(), address2: domainContact.address2 || '',
          organization: domainContact.organization || '', street_suffix: '',
          phone: `+${domainContact.phone_country_code}.${domainContact.phone_area_code}${domainContact.phone_subscriber_number}` } : undefined,
      )
      await refresh()
      if (result.invoice_id) navigate(`/orders/${result.order_id}/pay`)
      else navigate(`/orders/${result.order_id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not start checkout. Please try again.')
    } finally {
      setCheckingOut(false)
    }
  }

  const isEmpty = !cart || cart.items.length === 0

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <SEO title="Cart | MavenHost" description="Review selected domains and hosting before checkout." path="/cart" indexable={false} />
      <CustomerHeader />
      <main id="main-content" className="container-shell py-14">
        <h1 className="text-[1.9rem] font-semibold tracking-tight text-maven-ink">Cart</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-maven-muted">Buy a domain only, hosting only, or both as separate cart items. Hosting does not register a domain; you can provide a domain you already own at checkout.</p>

        {loading && (
          <div className="mt-10 flex items-center gap-3 text-maven-muted">
            <LoaderCircle className="size-5 animate-spin" /> Loading your cart…
          </div>
        )}

        {!loading && isEmpty && (
          <div className="mt-10 panel border-dashed p-6 text-center sm:p-10">
            <p className="mono text-sm text-maven-muted">Your selections</p>
            <p className="mt-3 text-[15px] font-semibold text-maven-ink">Your cart is empty</p>
            <p className="mt-1 text-sm text-maven-muted">Search for a domain or browse hosting plans to get started.</p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/domains" className="btn btn-primary">Find a domain</Link>
              <Link to="/hosting" className="btn btn-secondary">Browse hosting</Link>
            </div>
          </div>
        )}

        {!loading && cart && !isEmpty && (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.6fr_1fr]">
            <div className="panel divide-y divide-maven-line">
              {cart.items.map((item) => (
                <div key={item.item_id} className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="mono text-[11px] font-medium text-maven-muted">{item.product_type}</p>
                      <p className="mt-1 font-semibold text-maven-ink">{item.product_type === 'domain' && item.domain_name ? `${item.operation === 'renew' ? 'Renewal: ' : ''}${item.domain_name}` : item.name}</p>
                      <p className="mt-0.5 text-sm text-maven-muted">{item.billing_cycle.replace('_', ' ')} · Qty {item.quantity}</p>
                      {item.product_type === 'hosting' && !item.checkout_blocked && <p className="mt-1 text-sm text-maven-muted">Primary domain: <span className="font-medium text-maven-ink">{item.domain_name || 'Choose at checkout'}</span></p>}
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="mono font-semibold text-maven-ink">{money(item.total)} <span className="text-xs font-medium text-maven-muted">{cart.currency}</span></p>
                      <button
                        onClick={() => remove(item.item_id)}
                        disabled={removingId === item.item_id}
                        className="rounded-md p-2 text-maven-muted transition hover:bg-red-50 hover:text-maven-danger"
                        aria-label="Remove item"
                      >
                        {removingId === item.item_id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      </button>
                    </div>
                  </div>
                  {user && !item.checkout_blocked && item.product_type === 'hosting' && <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2"><div><label htmlFor={`hosting-domain-${item.item_id}`} className="label">Primary domain</label><input id={`hosting-domain-${item.item_id}`} type="text" autoComplete="url" autoCapitalize="none" inputMode="url" value={hostingDomains[item.item_id] ?? ''} onChange={(event) => setHostingDomains((values) => ({ ...values, [item.item_id]: event.target.value }))} className="field mono mt-1.5" placeholder="yourbusiness.com" /><p className="mt-1.5 text-xs text-maven-muted">Required to set up hosting. This does not register or charge for the domain.</p></div><div><label htmlFor={`hosting-password-${item.item_id}`} className="label">Control panel password</label><input id={`hosting-password-${item.item_id}`} type="password" autoComplete="new-password" minLength={8} value={hostingPasswords[item.item_id] ?? ''} onChange={(event) => setHostingPasswords((values) => ({ ...values, [item.item_id]: event.target.value }))} className="field mt-1.5" placeholder="At least 8 characters" /><p className="mt-1.5 text-xs text-maven-muted">Used during account setup when provisioning is enabled. Do not reuse your MavenHost sign-in password.</p></div></div>}
                </div>
              ))}
            </div>

            <div className="panel h-fit p-6">
              <h2 className="font-semibold text-maven-ink">Order summary</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-maven-muted">Subtotal</dt><dd className="mono text-maven-ink">{money(cart.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-maven-muted">Discount</dt><dd className="mono text-maven-ink">-{money(cart.discount)}</dd></div>
                <div className="flex justify-between"><dt className="text-maven-muted">Additional tax</dt><dd className="mono text-maven-ink">{money(cart.tax)}</dd></div>
                <div className="mt-2 flex justify-between border-t border-maven-line pt-3 text-base"><dt className="font-semibold text-maven-ink">Total <span className="text-xs font-normal text-maven-muted">{cart.currency}</span></dt><dd className="mono font-semibold text-maven-ink">{money(cart.total)}</dd></div>
                {currency.indicative && cart.currency === 'USD' && currency.convertUsd(cart.total) && <p className="text-xs text-maven-muted">≈ {currency.format(currency.convertUsd(cart.total)!)} at today's indicative rate. You are charged in US dollars.</p>}
              </dl>
              {user && !checkoutBlocked && cart.items.some(item => item.product_type === 'domain' && item.operation !== 'renew') && <DomainContactFields value={domainContact} onChange={setDomainContact} />}
              {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-maven-danger">{error}</p>}
              {checkoutBlocked && <p role="status" className="mt-5 rounded-lg border border-maven-line bg-maven-paper p-3 text-sm leading-6 text-maven-ink">Your hosting selection is saved. Checkout, payment and account setup are not available yet. Hosting prices already include 16% VAT.</p>}
              {!user ? (
                <>
                  <p className="mt-5 rounded-lg border border-maven-line bg-maven-paper p-3 text-sm leading-6 text-maven-muted">You can review your items and total without an account. Sign in or create an account to keep your selections with your account.</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Link to={`/login?next=${encodeURIComponent('/cart')}`} className="btn btn-primary justify-center">Sign in</Link>
                    <Link to={`/register?next=${encodeURIComponent('/cart')}`} className="btn btn-secondary justify-center">Create account</Link>
                  </div>
                </>
              ) : (
                <>
                  {!checkoutBlocked && cart.items.some((item) => item.product_type === 'hosting') && <p className="mt-5 rounded-lg border border-maven-line bg-maven-paper p-3 text-sm leading-6 text-maven-muted">Before payment, enter a primary domain and control panel password for each hosting plan. Adding the plan to your cart does not require a domain or register one.</p>}
                  <button onClick={proceedToCheckout} disabled={checkingOut || checkoutBlocked} className="btn btn-primary mt-5 w-full">
                  {checkingOut ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  {checkoutBlocked ? 'Hosting checkout unavailable' : 'Proceed to checkout'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    <SiteFooter />
      </div>
  )
}
