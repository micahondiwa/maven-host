import { seedBlog, seedDomainServiceBlog, seedExpandedBlog } from '../blog/seed'
import type { Command } from './manage'

export const commands: Record<string, Command> = {
  seed_blog: {
    help: 'Seed the MavenHost SEO-oriented editorial library (--create-editorial-author).',
    run: async (args) => console.log(await seedBlog({ createEditorialAuthor: args.includes('--create-editorial-author') })),
  },
  seed_expanded_blog: {
    help: 'Add 200+ additional software, AI, hosting, domain and SEO guides.',
    run: async () => console.log(await seedExpandedBlog()),
  },
  seed_domain_service_blog: {
    help: 'Publish focused DNS, domain, email and hosting migration guides.',
    run: async () => console.log(await seedDomainServiceBlog()),
  },
}
