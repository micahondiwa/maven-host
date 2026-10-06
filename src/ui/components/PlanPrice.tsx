import type { HostingPlan } from '../lib/api'
import { usd } from '../lib/hosting-presentation'
export function PlanPrice({ plan, term }: { plan: HostingPlan; term: string }) {
  const offer = plan.advertised_offers?.find(item => item.term === term)
  if (!offer) return <p className="py-4 text-sm text-maven-muted">Price confirmation required</p>
  return <div className="plan-price"><p className="text-sm text-maven-muted">{offer.starting_price ? 'Starting price · ' : ''}{offer.months === 1 ? 'One month' : `${offer.months} months, paid upfront`}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-maven-text">{usd(offer.total)} <span className="text-xs font-normal text-maven-muted">USD</span></p>{offer.months > 1 && <p className="mt-2 text-sm text-maven-muted">{usd(offer.monthly)} monthly equivalent · billed as the total above</p>}<p className="mt-3 text-xs leading-5 text-maven-muted">{offer.renewal_total ? `Renews at ${usd(offer.renewal_total)} USD for the same ${offer.months}-month period.` : 'Final configuration and renewal price require confirmation.'}</p><p className="mt-1 text-xs text-maven-muted">{offer.vat_included ? `Includes ${offer.vat_percent}% VAT.` : 'Review applicable tax in the cart.'}</p></div>
}
