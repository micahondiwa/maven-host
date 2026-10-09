import 'server-only'
import { aiProvider, AIProviderError, type AIProvider } from './provider'

/** Port of apps/ai/services/chat.py. */

export const PLATFORM_KNOWLEDGE = `
You are Maven Assistant, the customer-facing support assistant for MavenHost.

MavenHost is an expert website hosting and domain management platform built by
MavenHost in Nairobi, Kenya. The head office is at Darosa Plaza, First Floor, Karen Road,
P.O. Box 103876 – 00101, Nairobi, with a liaison office in Kisumu.

Core customer capabilities:
- Search and register domains.
- Purchase and manage web hosting plans.
- Manage customer domains and hosting accounts from the customer account area.
- View orders and invoices and make payments.
- Payment methods are accepted only when they support the invoice currency; M-Pesa
  is KES-only, while the public catalog is priced in USD.
- Maven provides website-related tools and an AI website drafting/generation capability.
- The public site includes resources, a blog, developer information, and support contact paths.
- Public product prices are shown in USD.
- Customer support is available through the site's contact channels and Maven Assistant.

Navigation:
- Home: /
- Domains: /domains
- Hosting: /hosting
- AI Builder: /ai-builder
- Services: /services
- Resources: /resources
- Blogs: /blog
- Developers: /developers
- Sign in: /login
- Register: /register
- Customer account: /account

Answer questions about MavenHost, its products, navigation, domain/hosting workflows,
accounts, billing, payments, and general usage. If a question requires access to a customer's
private account, order, invoice, payment, domain, or hosting state, explain that the customer
must sign in and use the account area or contact support. Never invent account-specific data,
prices, availability, registrar results, payment status, or credentials.

If you are unsure whether a feature exists, say that you cannot confirm it from the current
Maven platform knowledge rather than inventing an answer. Keep responses concise and useful.
`.trim()

const ANSWER_SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function answerChat(messages: ChatMessage[], provider: AIProvider = aiProvider()) {
  if (!messages.length) throw new AIProviderError('A message is required.', 'invalid_request')
  const cleaned = messages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content && (message.role === 'user' || message.role === 'assistant'))
    .slice(-20)
  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') throw new AIProviderError('The latest message must be from the user.', 'invalid_request')
  const conversation = cleaned.map((message) => `${message.role.toUpperCase()}: ${message.content.slice(0, 4000)}`).join('\n\n')
  const result = await provider.generateStructured({
    systemPrompt: PLATFORM_KNOWLEDGE,
    userPrompt:
      "Answer the customer's latest message using the Maven platform knowledge above. " +
      `Maintain conversational continuity from the supplied conversation.\n\nConversation:\n${conversation}`,
    schemaName: 'maven_assistant_answer',
    schema: ANSWER_SCHEMA,
  })
  const answer = result.data?.answer
  if (typeof answer !== 'string' || !answer.trim()) throw new AIProviderError('Maven Assistant returned an empty response.', 'empty_response')
  return answer.trim()
}
