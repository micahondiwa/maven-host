import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

/**
 * AI providers with automatic failover. OpenAI (v1's provider, Responses API with strict JSON-schema output) is the
 * default; Anthropic is the alternative used when the preferred provider cannot serve a request (missing or expired
 * key, exhausted credit or quota, rate limits, outages, timeouts, unusable output). `AI_PROVIDER_ORDER` sets the order.
 */

export type AIResult = { data: Record<string, unknown>; inputTokens: number; outputTokens: number; model: string; providerRequestId: string; provider: string }

export class AIProviderError extends Error {
  constructor(message: string, readonly code = 'provider_error') {
    super(message)
  }
}

export interface AIProvider {
  readonly providerName: string
  readonly model: string
  generateStructured(input: { systemPrompt: string; userPrompt: string; schemaName: string; schema: Record<string, unknown> }): Promise<AIResult>
}

type Input = Parameters<AIProvider['generateStructured']>[0]

const seconds = (name: string, fallback: number) => (Number.parseInt(process.env[name] ?? '', 10) || fallback) * 1000

function parseStructured(text: string | undefined | null): Record<string, unknown> {
  if (!text) throw new AIProviderError('The AI provider returned no structured output.', 'empty_response')
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object')
    return data
  } catch {
    throw new AIProviderError('The AI provider returned malformed structured output.', 'invalid_structured_output')
  }
}

export class OpenAIProvider implements AIProvider {
  readonly providerName = 'openai'
  readonly endpoint = 'https://api.openai.com/v1/responses'
  readonly apiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
  readonly model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6'
  readonly timeoutMs = seconds('OPENAI_TIMEOUT_SECONDS', 45)

  async generateStructured({ systemPrompt, userPrompt, schemaName, schema }: Input): Promise<AIResult> {
    if (!this.apiKey) throw new AIProviderError('AI provider is not configured.', 'not_configured')
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
            { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
          ],
          text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') throw new AIProviderError('The AI provider timed out.', 'timeout')
      throw new AIProviderError('The AI provider could not be reached.', 'transport_error')
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500)
      // Logged server-side only; the browser never sees provider details.
      console.error('OpenAI request failed', response.status, detail)
      if (response.status === 401 || response.status === 403) throw new AIProviderError('The AI provider rejected the credentials.', 'auth_failed')
      if (response.status === 402 || /insufficient_quota|billing/i.test(detail)) throw new AIProviderError('The AI provider account has no remaining credit.', 'quota_exhausted')
      if (response.status === 429) throw new AIProviderError('The AI provider rate limit was reached.', 'rate_limited')
      if (response.status >= 500) throw new AIProviderError('The AI provider is temporarily unavailable.', 'provider_unavailable')
      throw new AIProviderError('The AI provider rejected the request.', 'provider_rejected')
    }
    let body: { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string; id?: string }
    try {
      body = await response.json()
    } catch {
      throw new AIProviderError('The AI provider returned invalid JSON.', 'invalid_response')
    }
    let outputText = body.output_text
    if (!outputText)
      for (const item of body.output ?? []) {
        const content = (item.content ?? []).find((entry) => entry.type === 'output_text')
        if (content?.text) {
          outputText = content.text
          break
        }
      }
    return {
      data: parseStructured(outputText), inputTokens: Number(body.usage?.input_tokens ?? 0), outputTokens: Number(body.usage?.output_tokens ?? 0),
      model: body.model ?? this.model, providerRequestId: String(body.id ?? ''), provider: this.providerName,
    }
  }
}

export class AnthropicProvider implements AIProvider {
  readonly providerName = 'anthropic'
  readonly apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? ''
  readonly model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5'
  readonly effort = (process.env.ANTHROPIC_EFFORT?.trim() || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  readonly timeoutMs = seconds('ANTHROPIC_TIMEOUT_SECONDS', 120)

  async generateStructured({ systemPrompt, userPrompt, schema }: Input): Promise<AIResult> {
    if (!this.apiKey) throw new AIProviderError('AI provider is not configured.', 'not_configured')
    const client = new Anthropic({ apiKey: this.apiKey, timeout: this.timeoutMs, maxRetries: 1 })
    let message: Anthropic.Beta.Messages.BetaMessage
    try {
      message = await client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { effort: this.effort, format: { type: 'json_schema', schema } },
        // A safety decline is re-run server-side on Anthropic's recommended fallback model.
        fallbacks: 'default',
        betas: ['server-side-fallback-2026-07-01'],
      })
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        console.error('Anthropic credentials rejected', error.status)
        throw new AIProviderError('The AI provider rejected the credentials.', 'auth_failed')
      }
      if (error instanceof Anthropic.RateLimitError) throw new AIProviderError('The AI provider rate limit was reached.', 'rate_limited')
      if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AIProviderError('The AI provider timed out.', 'timeout')
      if (error instanceof Anthropic.APIConnectionError) throw new AIProviderError('The AI provider could not be reached.', 'transport_error')
      if (error instanceof Anthropic.APIError) {
        console.error('Anthropic request failed', error.status, error.type, error.message)
        if (error.type === 'billing_error' || error.status === 402) throw new AIProviderError('The AI provider account has no remaining credit.', 'quota_exhausted')
        if ((error.status ?? 0) >= 500) throw new AIProviderError('The AI provider is temporarily unavailable.', 'provider_unavailable')
        throw new AIProviderError('The AI provider rejected the request.', 'provider_rejected')
      }
      throw error
    }
    if (message.stop_reason === 'refusal') throw new AIProviderError('The AI provider declined this request.', 'refused')
    if (message.stop_reason === 'max_tokens') throw new AIProviderError('The AI provider returned an incomplete response.', 'invalid_structured_output')
    const text = message.content.find((block) => block.type === 'text')
    return {
      data: parseStructured(text && text.type === 'text' ? text.text : null), inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens,
      model: message.model, providerRequestId: message.id, provider: this.providerName,
    }
  }
}

/** Tries each configured provider in order, moving on whenever one cannot serve the request. */
export class FailoverProvider implements AIProvider {
  constructor(private readonly providers: AIProvider[]) {}

  get providerName() {
    return this.providers[0]?.providerName ?? 'none'
  }

  get model() {
    return this.providers[0]?.model ?? 'unknown'
  }

  async generateStructured(input: Input): Promise<AIResult> {
    let lastError: AIProviderError = new AIProviderError('AI provider is not configured.', 'not_configured')
    for (const provider of this.providers) {
      try {
        return await provider.generateStructured(input)
      } catch (error) {
        if (!(error instanceof AIProviderError)) throw error
        if (error.code !== 'not_configured') console.warn(`AI provider ${provider.providerName} failed (${error.code}); trying the next provider`)
        // Prefer reporting a real provider failure over a skipped, unconfigured one.
        if (error.code !== 'not_configured' || lastError.code === 'not_configured') lastError = error
      }
    }
    throw lastError
  }
}

const FACTORIES: Record<string, () => AIProvider> = { openai: () => new OpenAIProvider(), anthropic: () => new AnthropicProvider() }

let override: AIProvider | null = null

/** Tests substitute a deterministic provider; production uses the configured failover chain. */
export function setAIProvider(provider: AIProvider | null) {
  override = provider
}

export function aiProvider(): AIProvider {
  if (override) return override
  const order = (process.env.AI_PROVIDER_ORDER?.trim() || 'openai,anthropic').split(',').map((name) => name.trim().toLowerCase()).filter((name) => FACTORIES[name])
  return new FailoverProvider([...new Set(order)].map((name) => FACTORIES[name]()))
}

/** `_estimate_cost` for the provider that answered: decimal string with 8 places, or null when no rates are set. */
export function estimateCost(inputTokens: number, outputTokens: number, provider = 'openai'): string | null {
  const prefix = provider === 'anthropic' ? 'ANTHROPIC' : 'OPENAI'
  const parse = (value: string | undefined) => {
    const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec((value ?? '0').trim())
    return match ? BigInt(match[1]) * 10n ** 8n + BigInt((match[2] ?? '').padEnd(8, '0')) : 0n
  }
  const inputRate = parse(process.env[`${prefix}_INPUT_COST_PER_MILLION`])
  const outputRate = parse(process.env[`${prefix}_OUTPUT_COST_PER_MILLION`])
  if (!inputRate && !outputRate) return null
  const scaled = (BigInt(inputTokens) * inputRate + BigInt(outputTokens) * outputRate) / 1_000_000n
  return `${scaled / 10n ** 8n}.${String(scaled % 10n ** 8n).padStart(8, '0')}`
}
