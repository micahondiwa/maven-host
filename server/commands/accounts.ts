import { transaction } from '../db'
import { createUser, findUserByEmail, normalizeEmail } from '../accounts/users'
import { deleteExpiredTokens } from '../auth/jwt'
import type { Command } from './manage'

function option(args: string[], name: string) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

export const commands: Record<string, Command> = {
  createsuperuser: {
    help: 'Create a platform superuser: --email <address>; password from DJANGO_SUPERUSER_PASSWORD.',
    run: async (args) => {
      const email = option(args, 'email') ?? process.env.DJANGO_SUPERUSER_EMAIL
      const password = process.env.DJANGO_SUPERUSER_PASSWORD
      if (!email || !password) throw new Error('Provide --email and set DJANGO_SUPERUSER_PASSWORD.')
      await transaction(async (client) => {
        if (await findUserByEmail(normalizeEmail(email), client)) throw new Error('Error: That email is already taken.')
        await createUser(client, { email, password, is_staff: true, is_superuser: true, is_email_verified: true })
      })
      console.log('Superuser created successfully.')
    },
  },
  flushexpiredtokens: {
    help: 'Delete expired outstanding JWT refresh tokens and their blacklist entries.',
    run: async () => {
      console.log(`Deleted ${await deleteExpiredTokens()} expired token(s).`)
    },
  },
}
