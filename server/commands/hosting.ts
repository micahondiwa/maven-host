import { TwentyISupplier, twentyiSettings } from '../hosting/suppliers/twentyi'
import type { Command } from './manage'

export const commands: Record<string, Command> = {
  check_twentyi: {
    help: 'Read-only 20i connectivity check: lists hosting packages (GET /package). Never provisions.',
    run: async () => {
      console.log(`20i enabled=${twentyiSettings.enabled} transactions=${twentyiSettings.transactionsEnabled} api=${twentyiSettings.apiUrl}`)
      const result = await new TwentyISupplier().verifyConnection()
      console.log(`20i connection verified: ${result.accounts} hosting package(s) visible.`)
    },
  },
}
