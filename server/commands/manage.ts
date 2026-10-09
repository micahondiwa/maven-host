/**
 * `manage.py` equivalent: `npm run manage -- <command> [args]`. Each v1 management command is ported as an entry here.
 */
import { database, transaction } from '../db'
import { syncPermissions } from '../auth/permissions'
import { commands as accountCommands } from './accounts'

export type Command = { help: string; run: (args: string[]) => Promise<void> }

const commands: Record<string, Command> = {
  sync_permissions: {
    help: 'Synchronize business permissions and role assignments.',
    run: async () => {
      const created = await transaction((client) => syncPermissions(client))
      console.log(`Synchronization complete.\nNew permissions created: ${created}`)
    },
  },
  seed_roles: {
    help: 'Create the default authorization groups.',
    run: async () => {
      for (const name of ['Customer', 'Support', 'Billing', 'Sales', 'Reseller', 'Platform Administrator']) {
        const result = await database().query('INSERT INTO auth_group (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name])
        console.log(result.rowCount ? `Created group: ${name}` : `Group already exists: ${name}`)
      }
      console.log('Authorization groups are ready.')
    },
  },
  ...accountCommands,
}

async function main() {
  const [name, ...args] = process.argv.slice(2)
  const command = name ? commands[name] : undefined
  if (!command) {
    console.log('Available commands:')
    for (const [key, value] of Object.entries(commands).sort()) console.log(`  ${key.padEnd(32)} ${value.help}`)
    process.exitCode = name ? 1 : 0
    return
  }
  try {
    await command.run(args)
  } finally {
    await database().end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
