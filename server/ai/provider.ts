import 'server-only'

/** Port of apps/ai/providers: the OpenAI Responses API with strict JSON-schema output. */

export type AIResult = { data: Record<string, unknown>; inputTokens: number; outputTokens: number; model: string; providerRequestId: string }

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

export class OpenAIProvider implements AIProvider {
  readonly providerName = 'openai'
  readonly endpoint = 'https://api.openai.com/v1/responses'
  readonly apiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
  readonly model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6'
  readonly timeoutMs = (Number.parseInt(process.env.OPENAI_TIMEOUT_SECONDS ?? '', 10) || 45) * 1000

  async generateStructured({ systemPrompt, userPrompt, schemaName, schema }: Parameters<AIProvider['generateStructured']>[0]): Promise<AIResult> {
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
    if (response.status === 429) throw new AIProviderError('The AI provider rate limit was reached.', 'rate_limited')
    if (response.status >= 500) throw new AIProviderError('The AI provider is temporarily unavailable.', 'provider_unavailable')
    if (response.status >= 400) {
      // The body explains rejections such as an unknown model; log it server-side, never return it to the browser.
      console.error('OpenAI rejected the request', response.status, (await response.text().catch(() => '')).slice(0, 500))
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
    if (!outputText) throw new AIProviderError('The AI provider returned no structured output.', 'empty_response')
    let data: Record<string, unknown>
    try {
      data = JSON.parse(outputText)
    } catch {
      throw new AIProviderError('The AI provider returned malformed structured output.', 'invalid_structured_output')
    }
    return {
      data,
      inputTokens: Number(body.usage?.input_tokens ?? 0),
      outputTokens: Number(body.usage?.output_tokens ?? 0),
      model: body.model ?? this.model,
      providerRequestId: String(body.id ?? ''),
    }
  }
}

let override: AIProvider | null = null

/** Tests substitute a deterministic provider; production always uses OpenAI. */
export function setAIProvider(provider: AIProvider | null) {
  override = provider
}

export function aiProvider(): AIProvider {
  return override ?? new OpenAIProvider()
}

/** `_estimate_cost`: decimal string with 8 places, or null when no rates are configured. */
export function estimateCost(inputTokens: number, outputTokens: number): string | null {
  const parse = (value: string | undefined) => {
    const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec((value ?? '0').trim())
    return match ? BigInt(match[1]) * 10n ** 8n + BigInt((match[2] ?? '').padEnd(8, '0')) : 0n
  }
  const inputRate = parse(process.env.OPENAI_INPUT_COST_PER_MILLION)
  const outputRate = parse(process.env.OPENAI_OUTPUT_COST_PER_MILLION)
  if (!inputRate && !outputRate) return null
  const scaled = (BigInt(inputTokens) * inputRate + BigInt(outputTokens) * outputRate) / 1_000_000n
  return `${scaled / 10n ** 8n}.${String(scaled % 10n ** 8n).padStart(8, '0')}`
}
