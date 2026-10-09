import { database } from '../db'
import { processOutbox } from '../jobs/outbox'
import { OUTBOX_HANDLERS } from '../jobs/handlers'
import { cleanupPublicGenerations } from '../ai/public-generation'
import { enqueueExpiredTrials } from '../websites/trials'
import type { Command } from './manage'

export const commands: Record<string, Command> = {
  process_outbox: {
    help: 'Process pending durable platform outbox events (--limit N, default 50).',
    run: async (args) => {
      const index = args.indexOf('--limit')
      const limit = index >= 0 ? Number(args[index + 1]) : 50
      console.log(`Processed ${await processOutbox(database(), OUTBOX_HANDLERS, limit)} outbox event(s).`)
    },
  },
  cleanup_public_generations: {
    help: 'Expire and clear retained anonymous Maven AI website generation content.',
    run: async () => {
      console.log(`Cleaned up ${await cleanupPublicGenerations()} anonymous generation(s).`)
    },
  },
  enqueue_expired_trials: {
    help: 'Queue cleanup for expired website trials.',
    run: async () => {
      console.log(`Queued ${await enqueueExpiredTrials()} expired website trial(s).`)
    },
  },
}
