import { describe, it, expect, afterEach, vi } from 'vitest'

const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }
const input = { systemPrompt: 'system', userPrompt: 'Where is MavenHost?', schemaName: 'maven_assistant_answer', schema }
const realFetch = globalThis.fetch

function anthropicMessage(text: string, stop = 'end_turn') {
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('AI provider failover', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER_ORDER']) delete process.env[key]
  })

  async function run(openai: () => Response, anthropic: () => Response) {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url instanceof Request ? url.url : url)
      calls.push(target)
      if (target.startsWith('https://api.openai.com')) return openai()
      if (target.startsWith('https://api.anthropic.com')) {
        const body = JSON.parse(String(init?.body))
        expect(body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema', schema } } })
        return anthropic()
      }
      throw new Error(`unexpected ${target}`)
    }) as typeof fetch
    const { aiProvider } = await import('../server/ai/provider')
    return { result: aiProvider().generateStructured(input), calls }
  }

  it('uses OpenAI first when it succeeds', async () => {
    Object.assign(process.env, { OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant' })
    const { result, calls } = await run(() => new Response(JSON.stringify({ id: 'r1', model: 'gpt-5.6', output_text: '{"answer":"Nairobi"}', usage: { input_tokens: 5, output_tokens: 3 } })), () => anthropicMessage('{}'))
    expect(await result).toMatchObject({ provider: 'openai', data: { answer: 'Nairobi' } })
    expect(calls.every((call) => call.includes('openai'))).toBe(true)
  })

  it('falls back to Anthropic when OpenAI credit is exhausted or the key has expired', async () => {
    Object.assign(process.env, { OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant' })
    const quota = await run(() => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }), () => anthropicMessage('{"answer":"Karen Road"}'))
    expect(await quota.result).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', data: { answer: 'Karen Road' }, inputTokens: 12 })
    const expired = await run(() => new Response('{"error":"invalid_api_key"}', { status: 401 }), () => anthropicMessage('{"answer":"Kisumu"}'))
    expect(await expired.result).toMatchObject({ provider: 'anthropic', data: { answer: 'Kisumu' } })
  })

  it('uses Anthropic alone when OpenAI is not configured, and reports the real failure when both fail', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant'
    const only = await run(() => new Response('', { status: 500 }), () => anthropicMessage('{"answer":"ok"}'))
    expect((await only.result).provider).toBe('anthropic')
    expect(only.calls.some((call) => call.includes('openai'))).toBe(false)
    process.env.OPENAI_API_KEY = 'sk-openai'
    const down = await run(() => new Response('', { status: 503 }), () => new Response(JSON.stringify({ type: 'error', error: { type: 'billing_error', message: 'Credit balance is too low' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
    await expect(down.result).rejects.toMatchObject({ code: 'quota_exhausted' })
  })

  it('treats an Anthropic refusal as a failure rather than inventing output', async () => {
    Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-ant', AI_PROVIDER_ORDER: 'anthropic' })
    const refused = await run(() => new Response(''), () => anthropicMessage('', 'refusal'))
    await expect(refused.result).rejects.toMatchObject({ code: 'refused' })
  })
})
