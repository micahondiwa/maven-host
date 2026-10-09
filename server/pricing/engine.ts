import 'server-only'
import Decimal from 'decimal.js'
import { database, query, queryOne, transaction, type Queryable } from '../db'

/**
 * Port of apps/core/pricing and apps/core/currencies. Arithmetic uses Python's default decimal context
 * (28 significant digits, half-even), with explicit half-up quantization where v1 quantized.
 */
export const D = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN })
export type DecimalValue = InstanceType<typeof D>

export const quantize = (value: DecimalValue, places = 2) => value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP)
export const money = (value: DecimalValue | string | number, places = 2) => new D(value).toFixed(places, Decimal.ROUND_HALF_UP)

export class ExchangeRateNotFound extends Error {}

export type Currency = { id: number; code: string; name: string; symbol: string; is_active: boolean; is_default: boolean; decimal_places: number }
export type PricingRule = { id: number; name: string; strategy: 'fixed_markup' | 'percentage_markup' | 'fixed_price'; value: string; is_default: boolean; is_active: boolean }

export async function currencyByCode(code: string, db: Queryable = database()) {
  return queryOne<Currency>('SELECT * FROM currencies_currency WHERE code = $1 AND is_active', [code], db)
}

export async function defaultPricingRule(db: Queryable = database()) {
  return queryOne<PricingRule>('SELECT * FROM pricing_pricingrule WHERE is_default AND is_active ORDER BY name LIMIT 1', [], db)
}

/** CurrencyConversionService.convert */
export async function convert(amount: DecimalValue, from: Currency, to: Currency, db: Queryable = database()): Promise<DecimalValue> {
  if (from.id === to.id) return amount
  const direct = await queryOne<{ rate: string }>('SELECT rate FROM currencies_exchangerate WHERE base_currency_id = $1 AND target_currency_id = $2', [from.id, to.id], db)
  let rate: DecimalValue
  if (direct) rate = new D(direct.rate)
  else {
    const inverse = await queryOne<{ rate: string }>('SELECT rate FROM currencies_exchangerate WHERE base_currency_id = $1 AND target_currency_id = $2', [to.id, from.id], db)
    if (!inverse) throw new ExchangeRateNotFound(`No exchange rate between ${from.code} and ${to.code}.`)
    rate = new D(1).div(inverse.rate)
  }
  return quantize(amount.mul(rate), to.decimal_places)
}

/** MarginService.apply */
export function applyMargin(cost: DecimalValue, rule: PricingRule): DecimalValue {
  const value = new D(rule.value)
  if (rule.strategy === 'fixed_markup') return cost.add(value)
  if (rule.strategy === 'percentage_markup') return cost.add(cost.mul(value).div(100))
  if (rule.strategy === 'fixed_price') return value
  throw new Error(`Unsupported pricing strategy: ${rule.strategy}`)
}

const TAX_RATE = new D('16.00')

/** PricingEngine.calculate */
export async function calculatePrice(input: { supplierPrice: string; supplierCurrency: Currency; targetCurrency: Currency; rule: PricingRule; applyTax?: boolean }, db?: Queryable) {
  const converted = await convert(new D(input.supplierPrice), input.supplierCurrency, input.targetCurrency, db)
  const markedUp = applyMargin(converted, input.rule)
  const tax = input.applyTax ? markedUp.mul(TAX_RATE).div(100) : new D('0.00')
  const selling = quantize(markedUp.add(tax))
  return { supplierPrice: input.supplierPrice, convertedPrice: converted, marginAmount: markedUp.sub(converted), taxAmount: tax, sellingPrice: selling.toFixed(2), currency: input.targetCurrency.code }
}

/** seed_currencies */
export async function seedCurrencies(db: Queryable = database()) {
  const display = process.env.DISPLAY_CURRENCY?.trim() || 'USD'
  for (const currency of [{ code: 'USD', name: 'US Dollar', symbol: '$' }, { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' }]) {
    await db.query(
      `INSERT INTO currencies_currency (code, name, symbol, is_active, is_default, decimal_places) VALUES ($1, $2, $3, true, $4, 2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, symbol = EXCLUDED.symbol, is_default = EXCLUDED.is_default`,
      [currency.code, currency.name, currency.symbol, currency.code === display],
    )
  }
}

/** ExchangeRateSyncService.synchronize (Frankfurter). */
export async function synchronizeExchangeRates(fetchRates: (base: string) => Promise<{ rates: Record<string, number> }> = frankfurterLatest) {
  const base = process.env.BASE_CURRENCY?.trim() || 'USD'
  const data = await fetchRates(base)
  return transaction(async (client) => {
    const baseCurrency = await currencyByCode(base, client)
    if (!baseCurrency) throw new Error(`Base currency '${base}' does not exist. Run 'seed_currencies' first.`)
    const result = { created: 0, updated: 0, skipped: 0 }
    for (const [code, rate] of Object.entries(data.rates)) {
      const target = await currencyByCode(code, client)
      if (!target) {
        result.skipped++
        continue
      }
      const existing = await query('SELECT 1 FROM currencies_exchangerate WHERE base_currency_id = $1 AND target_currency_id = $2', [baseCurrency.id, target.id], client)
      await client.query(
        `INSERT INTO currencies_exchangerate (rate, updated_at, base_currency_id, target_currency_id) VALUES ($1, CURRENT_TIMESTAMP, $2, $3)
         ON CONFLICT (base_currency_id, target_currency_id) DO UPDATE SET rate = EXCLUDED.rate, updated_at = CURRENT_TIMESTAMP`,
        [new D(String(rate)).toFixed(8, Decimal.ROUND_HALF_EVEN), baseCurrency.id, target.id],
      )
      if (existing.length) result.updated++
      else result.created++
    }
    return result
  })
}

async function frankfurterLatest(base: string) {
  const response = await fetch(`https://api.frankfurter.app/latest?${new URLSearchParams({ from: base })}`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Frankfurter responded ${response.status}`)
  return (await response.json()) as { rates: Record<string, number> }
}
