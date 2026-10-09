import { database } from '../db'
import { seedCurrencies, synchronizeExchangeRates } from '../pricing/engine'
import { importSupplierPrices, seedSupplierRecords, seedTlds } from '../domains/service'
import { OpenproviderRegistrar } from '../domains/registrars/openprovider'
import type { Command } from './manage'

function option(args: string[], name: string) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

export const commands: Record<string, Command> = {
  seed_currencies: {
    help: 'Seed default currencies.',
    run: async () => {
      await seedCurrencies()
      console.log('Currencies seeded successfully.')
    },
  },
  sync_exchange_rates: {
    help: 'Synchronize exchange rates from Frankfurter.',
    run: async () => {
      const result = await synchronizeExchangeRates()
      console.log(`Exchange rates synchronized.\nCreated: ${result.created}\nUpdated: ${result.updated}\nSkipped: ${result.skipped}`)
    },
  },
  seed_pricing_rules: {
    help: 'Seed default pricing rules.',
    run: async () => {
      await database().query(
        `INSERT INTO pricing_pricingrule (name, strategy, value, is_default, is_active, created_at, updated_at)
         VALUES ('Standard Retail', 'percentage_markup', 25.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (name) DO UPDATE SET strategy = EXCLUDED.strategy, value = EXCLUDED.value, is_default = EXCLUDED.is_default, updated_at = CURRENT_TIMESTAMP`,
      )
      console.log('Pricing rules seeded successfully.')
    },
  },
  seed_tlds: {
    help: 'Seed the default public TLD catalog.',
    run: async () => {
      console.log(`Default TLD catalog ready: ${await seedTlds()} TLDs.`)
    },
  },
  seed_supplier_workflows: {
    help: 'Create inactive Openprovider, Register.co.ke and registry.co.tz records without switching live services.',
    run: async () => {
      for (const line of await seedSupplierRecords()) console.log(line)
    },
  },
  check_openprovider: {
    help: 'Read-only Openprovider authentication and availability check (--domain, --quote); never purchases domains.',
    run: async (args) => {
      const client = new OpenproviderRegistrar()
      const domain = option(args, 'domain') ?? 'example.com'
      const [result] = await client.checkDomains([domain])
      console.log(`API access verified; available=${result.available}, premium=${result.premium}.`)
      if (args.includes('--quote')) {
        const quote = await client.quoteDomain(domain)
        console.log(`Non-premium supplier quote: ${quote.price} ${quote.currency}. Not published or imported.`)
      }
      console.log('Openprovider remains in standby; live domain purchases are disabled.')
    },
  },
  sync_openprovider_catalog: {
    help: 'Import one-year wholesale lifecycle pricing for explicitly approved Openprovider extensions.',
    run: async () => {
      const client = new OpenproviderRegistrar()
      const prices = [...(await client.getPricing('REGISTER')), ...(await client.getPricing('RENEW')), ...(await client.getPricing('TRANSFER'))]
      const count = await importSupplierPrices('openprovider', prices)
      console.log(`Imported ${count} supplier prices; no suppliers or TLDs were activated and no domains purchased.`)
    },
  },
}
