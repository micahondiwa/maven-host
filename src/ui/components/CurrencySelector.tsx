import { useId } from 'react'
import { useCurrency } from '../lib/currency'

const EAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })

/** USD and KES as buttons, other East African currencies in a menu (the inaracresttechnologies.com pattern). */
export function CurrencySelector({ className = '' }: { className?: string }) {
  const { catalog, code, current, setCode, indicative } = useCurrency()
  const selectId = useId()
  const primary = catalog.currencies.filter((currency) => currency.payment)
  const others = catalog.currencies.filter((currency) => !currency.payment && currency.rate !== null)
  const button = (active: boolean) =>
    `inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold transition-colors ${active ? 'bg-maven-signal text-white' : 'border border-maven-line bg-white text-maven-ink hover:border-maven-signal'}`
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div role="group" aria-label="Display currency" className="flex flex-wrap items-center justify-center gap-2">
        {primary.map((currency) => <button key={currency.code} type="button" aria-pressed={code === currency.code} onClick={() => setCode(currency.code)} className={button(code === currency.code)}>{currency.code}</button>)}
        {others.length > 0 && <>
          <label htmlFor={selectId} className="sr-only">Other currencies</label>
          <select id={selectId} value={indicative ? code : ''} onChange={(event) => { if (event.target.value) setCode(event.target.value) }} className={`${button(indicative)} appearance-auto pr-8`}>
            <option value="" disabled>Other currencies</option>
            {others.map((currency) => <option key={currency.code} value={currency.code} className="bg-white text-maven-ink">{currency.code} — {currency.name}</option>)}
          </select>
        </>}
      </div>
      <p className="text-center text-xs leading-relaxed text-maven-muted" aria-live="polite">
        {code === 'USD' && 'Prices are set in US dollars.'}
        {code === 'KES' && 'Prices in Kenyan shillings are charged in KES by card or M-Pesa.'}
        {indicative && <>Indicative conversion from USD{current.rate_updated_at ? ` · rates updated ${EAT.format(new Date(current.rate_updated_at))} EAT` : ''}. {current.name} amounts are for information; you are charged in US dollars. <a href={catalog.attribution.url} target="_blank" rel="noreferrer" className="underline">{catalog.attribution.label}</a></>}
      </p>
    </div>
  )
}
