import type { HostingPlan } from '../lib/api'
import { useCurrency } from '../lib/currency'

const TERM_CYCLES: Record<string, string> = { '1-month': 'monthly', '1-year': 'annually', '2-year': 'biennially', '3-year': 'triennially' }

/** Total, monthly equivalent and renewal for a term, in the selected display currency. */
export function PlanPrice({ plan, term }: { plan: HostingPlan; term: string }) {
  const currency = useCurrency()
  const offer = plan.advertised_offers?.find(item => item.term === term)
  if (!offer) return <p className="py-4 text-sm text-maven-muted">Price confirmation required</p>
  const kes = currency.code === 'KES' ? plan.prices.find(price => price.currency === 'KES' && price.billing_cycle === TERM_CYCLES[term]) : undefined
  // KES has its own fixed prices; other display currencies convert the USD price for information only.
  const amount = (usd: string, kesAmount?: string) => {
    if (kesAmount) return currency.format(kesAmount, 'KES')
    const converted = currency.indicative ? currency.convertUsd(usd) : null
    return converted ? `≈ ${currency.format(converted)}` : currency.format(usd, 'USD')
  }
  const total = amount(offer.total, kes?.price)
  const monthly = amount(offer.monthly, kes ? String(Math.round((Number(kes.price) / offer.months) * 100) / 100) : undefined)
  const renewal = offer.renewal_total ? amount(offer.renewal_total, kes ? kes.regular_price : undefined) : null
  const unit = kes ? 'KES' : currency.indicative ? currency.code : 'USD'
  return <div className="plan-price">
    <p className="text-sm text-maven-muted">{offer.starting_price ? 'Starting price · ' : ''}{offer.months === 1 ? 'One month' : `${offer.months} months, paid upfront`}</p>
    <p className="mt-2 text-3xl font-semibold tracking-tight text-maven-text">{total} <span className="text-xs font-normal text-maven-muted">{unit}</span></p>
    {currency.indicative && <p className="mt-1 text-xs text-maven-muted">Charged as {currency.format(offer.total, 'USD')}</p>}
    {offer.months > 1 && <p className="mt-2 text-sm text-maven-muted">{monthly} monthly equivalent · billed as the total above</p>}
    <p className="mt-3 text-xs leading-5 text-maven-muted">{renewal ? `Renews at ${renewal} for the same ${offer.months}-month period.` : 'Final configuration and renewal price require confirmation.'}</p>
    <p className="mt-1 text-xs text-maven-muted">{offer.vat_included ? `Includes ${offer.vat_percent}% VAT.` : 'Review applicable tax in the cart.'}</p>
  </div>
}
