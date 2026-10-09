import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listCurrencies, type CurrencyCatalog, type DisplayCurrency } from './api'

/**
 * Display currency, following the Inara Crest pattern: prices are set in US dollars (the default); KES is also a
 * payment currency with its own fixed prices; UGX, TZS and RWF show an indicative conversion from USD and are
 * charged in USD.
 */

const STORAGE_KEY = 'mavenhost-currency'
const USD: DisplayCurrency = { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2, payment: true, rate: '1', rate_updated_at: null }
const FALLBACK: CurrencyCatalog = {
  base: 'USD', default: 'USD', payment_currencies: ['USD', 'KES'], attribution: { label: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
  currencies: [USD, { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimal_places: 2, payment: true, rate: null, rate_updated_at: null }],
}

type CurrencyContextValue = {
  catalog: CurrencyCatalog
  /** Selected display currency. */
  code: string
  current: DisplayCurrency
  setCode: (code: string) => void
  /** Currency the customer is charged in for the current selection. */
  chargeCode: 'USD' | 'KES'
  /** True when the selection is an indicative conversion rather than a payment currency. */
  indicative: boolean
  format: (amount: string | number, code?: string) => string
  /** Indicative conversion of a USD amount into the selected currency, or null without a rate. */
  convertUsd: (usd: string | number) => string | null
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

export function formatMoney(amount: string | number, currency: Pick<DisplayCurrency, 'code' | 'symbol' | 'decimal_places'>) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return String(amount)
  const digits = currency.decimal_places
  const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  return currency.code === 'USD' ? `$${number}` : `${currency.symbol} ${number}`
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CurrencyCatalog>(FALLBACK)
  const [code, setCodeState] = useState('USD')

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) setCodeState(stored)
    } catch {
      // Storage unavailable: start from USD.
    }
    listCurrencies().then(setCatalog).catch(() => undefined)
  }, [])

  const setCode = useCallback((next: string) => {
    setCodeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private browsing or blocked storage: the choice lasts for this visit only.
    }
  }, [])

  const value = useMemo<CurrencyContextValue>(() => {
    const byCode = new Map(catalog.currencies.map((currency) => [currency.code, currency]))
    const wanted = byCode.get(code)
    // A display-only currency without a rate cannot be shown, so fall back to USD.
    const current = wanted && (wanted.payment || wanted.rate !== null) ? wanted : byCode.get('USD') ?? USD
    return {
      catalog,
      code: current.code,
      current,
      setCode,
      chargeCode: current.code === 'KES' ? 'KES' : 'USD',
      indicative: !current.payment,
      format: (amount, other) => formatMoney(amount, (other ? byCode.get(other) : current) ?? { code: other ?? 'USD', symbol: other ?? '$', decimal_places: 2 }),
      convertUsd: (usd) => {
        if (!current.rate) return null
        const factor = 10 ** current.decimal_places
        return String(Math.round(Number(usd) * Number(current.rate) * factor) / factor)
      },
    }
  }, [catalog, code, setCode])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  const context = useContext(CurrencyContext)
  if (!context) throw new Error('useCurrency must be used inside CurrencyProvider')
  return context
}

/**
 * Price label for the selected currency: the exact KES charge when one is supplied, otherwise the USD price, with an
 * indicative conversion first for display-only currencies.
 */
export function usePriceLabel() {
  const currency = useCurrency()
  return (usd: string, kes?: string | null): { main: string; note: string | null } => {
    if (currency.code === 'KES' && kes) return { main: currency.format(kes, 'KES'), note: null }
    if (currency.indicative) {
      const converted = currency.convertUsd(usd)
      if (converted) return { main: `≈ ${currency.format(converted)}`, note: `Charged as ${currency.format(usd, 'USD')}` }
    }
    if (currency.code === 'KES') return { main: currency.format(usd, 'USD'), note: 'Charged in USD' }
    return { main: currency.format(usd, 'USD'), note: null }
  }
}
