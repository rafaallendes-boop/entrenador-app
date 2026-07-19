/// <reference types="node" />
// Este test importa la Netlify function (contexto Node) y manipula process.env.
// No lo cubre ningún tsconfig del proyecto (app excluye *.test.ts; node solo
// incluye netlify/functions), así que declaramos los tipos de node explícitamente
// para que el language server reconozca `process`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

import { getAIRequestPolicy } from '../ai/requestPolicy'
import {
  buildClaudeBody,
  buildOpenAIBody,
  handler,
  mapGeminiUsage,
  mapOpenAIUsage,
  parseClaudeStreamEvent,
  providerEnvKey,
  resolveFallbackProvider,
  resolveModel,
  resolvePrimaryProvider,
  shouldUseDeterministicBypass,
  trimConversationHistory,
  tryDeterministicBypass,
  type ConversationMessage,
} from '../../../netlify/functions/coach'

describe('streaming coach telemetry', () => {
  const managedKeys = [
    'AI_PROVIDER_CHAT_GENERAL',
    'OPENAI_API_KEY',
    'OPENAI_MODEL_CHAT_GENERAL',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
  ]
  let snapshot: Record<string, string | undefined>

  beforeEach(() => {
    snapshot = {}
    for (const key of managedKeys) snapshot[key] = process.env[key]
    process.env.AI_PROVIDER_CHAT_GENERAL = 'openai'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_MODEL_CHAT_GENERAL = 'gpt-5-mini'
    process.env.SUPABASE_URL = 'https://supabase.test'
    process.env.SUPABASE_ANON_KEY = 'anon-key'
  })

  afterEach(() => {
    for (const key of managedKeys) {
      const value = snapshot[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('emits request completion telemetry and timing fields in the done event', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"Respuesta final"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":30,"completion_tokens_details":{"reasoning_tokens":10}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const invoke = handler as unknown as (event: {
      httpMethod: string
      headers: Record<string, string>
      body: string
    }) => Promise<{ body: ReadableStream<Uint8Array> }>
    const response = await invoke({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: JSON.stringify({
        systemPrompt: 'Sistema',
        userMessage: 'Hola',
        requestClass: 'chat_general',
        traceId: 'trace-stream-1',
        generationId: 'generation-stream-1',
        logicalAttempt: 2,
        maxTokens: 100,
        stream: true,
      }),
    })
    const body = await new Response(response.body).text()
    const events = body.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    const done = events.find((event) => event.type === 'done')
    const completedLogs = infoSpy.mock.calls
      .map(([entry]) => typeof entry === 'string' ? JSON.parse(entry) as Record<string, unknown> : null)
      .filter((entry) => entry?.event === 'coach.request.completed')
    const attemptLogs = infoSpy.mock.calls
      .map(([entry]) => typeof entry === 'string' ? JSON.parse(entry) as Record<string, unknown> : null)
      .filter((entry) => entry?.event === 'coach.attempt')

    expect(done).toMatchObject({
      type: 'done',
      traceId: 'trace-stream-1',
      generationId: 'generation-stream-1',
      provider: 'openai',
      model: 'gpt-5-mini',
      promptTokens: 120,
      completionTokens: 30,
      reasoningTokens: 10,
    })
    expect(done?.authDurationMs).toEqual(expect.any(Number))
    expect(done?.serverDurationMs).toEqual(expect.any(Number))
    expect(completedLogs).toHaveLength(1)
    expect(completedLogs[0]).toMatchObject({
      traceId: 'trace-stream-1',
      generationId: 'generation-stream-1',
      logicalAttempt: 2,
      requestClass: 'chat_general',
      outcome: 'ok',
      provider: 'openai',
      model: 'gpt-5-mini',
      responseCharCount: 'Respuesta final'.length,
    })
    expect(attemptLogs).toHaveLength(1)
    expect(attemptLogs[0]).toMatchObject({
      traceId: 'trace-stream-1',
      generationId: 'generation-stream-1',
      logicalAttempt: 2,
      attempt: 1,
    })
  })

  it('rejects invalid logical attempt metadata before authentication', async () => {
    const invoke = handler as unknown as (event: {
      httpMethod: string
      headers: Record<string, string>
      body: string
    }) => Promise<{ statusCode: number; body: string }>
    const response = await invoke({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: JSON.stringify({
        systemPrompt: 'Sistema',
        userMessage: 'Hola',
        requestClass: 'week_creator',
        logicalAttempt: 0,
      }),
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'logicalAttempt invalid' })
  })
})

describe('trimConversationHistory', () => {
  it('returns empty array when conversation is undefined or empty', () => {
    expect(trimConversationHistory(undefined)).toEqual([])
    expect(trimConversationHistory([])).toEqual([])
  })

  it('keeps last N messages (even number)', () => {
    const conversation: ConversationMessage[] = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }))

    const trimmed = trimConversationHistory(conversation, 8)
    // maxMessages = 8, which is even, so it should keep 8 messages.
    expect(trimmed.length).toBe(8)
    expect(trimmed[0].content).toBe('Message 7')
    expect(trimmed[7].content).toBe('Message 14')
  })

  it('truncates messages exceeding character limit', () => {
    const conversation: ConversationMessage[] = [
      { role: 'user', content: 'Short message' },
      { role: 'assistant', content: 'Very '.repeat(2000) + 'long message' }, // ~10000 chars
      { role: 'user', content: 'Next message' },
      { role: 'assistant', content: 'Final message' },
    ]

    const trimmed = trimConversationHistory(conversation, 8, 2000)
    // Characters limit is 2000.
    // The very long message won't fit, so it should be truncated, keeping only the messages after it.
    expect(trimmed.length).toBe(2)
    expect(trimmed[0].content).toBe('Next message')
    expect(trimmed[1].content).toBe('Final message')
  })
})

describe('tryDeterministicBypass', () => {
  it('returns null for non-bypassable messages', () => {
    expect(tryDeterministicBypass('Hola coach, ¿cómo estás?')).toBeNull()
    expect(commentMatches('Necesito un plan de entrenamiento para correr 10k')).toBeNull()
  })

  it('returns insert_recovery action for rest commands', () => {
    const match1 = tryDeterministicBypass('pon descanso el lunes')
    expect(match1).not.toBeNull()
    expect(match1?.[0]).toMatchObject({
      type: 'insert_recovery',
      reason: 'Solicitado por el usuario mediante atajo directo de descanso.',
    })
    expect(match1?.[0].targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const match2 = tryDeterministicBypass('descanso manana')
    expect(match2).not.toBeNull()
    expect(match2?.[0].type).toBe('insert_recovery')
  })

  it('returns delete_session action for delete commands', () => {
    const match1 = tryDeterministicBypass('borra el entreno del jueves')
    expect(match1).not.toBeNull()
    expect(match1?.[0]).toMatchObject({
      type: 'delete_session',
      reason: 'Eliminación directa solicitada por el usuario.',
      sessionId: 'placeholder-id',
    })
    expect(match1?.[0].targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('plan builder request policy', () => {
  it('keeps client-side caps aligned with the coach proxy caps', () => {
    expect(getAIRequestPolicy('week_creator')).toMatchObject({
      maxTokens: 8000,
      timeoutMs: 23000,
    })
    expect(getAIRequestPolicy('plan_builder_week')).toMatchObject({
      maxTokens: 3500,
      timeoutMs: 22000,
    })
    expect(getAIRequestPolicy('plan_builder_pair')).toMatchObject({
      maxTokens: 4200,
      timeoutMs: 23000,
    })
  })
})

describe('shouldUseDeterministicBypass', () => {
  it('only allows local regex shortcuts for chat_action requests', () => {
    expect(shouldUseDeterministicBypass('chat_action')).toBe(true)
    expect(shouldUseDeterministicBypass('chat_general')).toBe(false)
    expect(shouldUseDeterministicBypass('plan_builder_week')).toBe(false)
    expect(shouldUseDeterministicBypass('plan_builder_pair')).toBe(false)
  })
})

describe('provider routing by request class', () => {
  const managedKeys = [
    'AI_PROVIDER',
    'AI_FALLBACK_PROVIDER',
    'OPENAI_MODEL',
    'OPENAI_MODEL_WEEK_CREATOR',
    providerEnvKey('AI_PROVIDER', 'week_creator'),
    providerEnvKey('AI_PROVIDER', 'plan_builder_week'),
    providerEnvKey('AI_PROVIDER', 'plan_builder_pair'),
    providerEnvKey('AI_FALLBACK_PROVIDER', 'plan_builder_week'),
  ]
  let snapshot: Record<string, string | undefined>

  beforeEach(() => {
    snapshot = {}
    for (const key of managedKeys) {
      snapshot[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of managedKeys) {
      const value = snapshot[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('routes only week_creator to OpenAI when the class override is configured', () => {
    process.env.AI_PROVIDER = 'gemini'
    process.env.AI_PROVIDER_WEEK_CREATOR = 'openai'

    expect(resolvePrimaryProvider('week_creator')).toBe('openai')
    expect(resolvePrimaryProvider('chat_action')).toBe('gemini')
    expect(resolvePrimaryProvider('chat_general')).toBe('gemini')
    expect(resolvePrimaryProvider('weekly_summary')).toBe('gemini')
    expect(resolvePrimaryProvider('plan_builder_week')).toBe('gemini')
    expect(resolvePrimaryProvider('plan_builder_pair')).toBe('gemini')
    expect(resolvePrimaryProvider('import_extract')).toBe('gemini')
  })

  it('keeps Plan Builder fallback pinned to Gemini when configured', () => {
    process.env.AI_PROVIDER = 'gemini'
    process.env.AI_PROVIDER_WEEK_CREATOR = 'openai'
    process.env.AI_FALLBACK_PROVIDER_PLAN_BUILDER_WEEK = 'gemini'

    expect(resolveFallbackProvider('week_creator')).toBeUndefined()
    expect(resolveFallbackProvider('plan_builder_week')).toBe('gemini')
  })

  it('honors request-class model overrides before the provider default model', () => {
    process.env.OPENAI_MODEL = 'gpt-5-mini'
    process.env.OPENAI_MODEL_WEEK_CREATOR = 'gpt-4.1-mini'

    expect(resolveModel('openai', 'week_creator')).toBe('gpt-4.1-mini')
    expect(resolveModel('openai', 'chat_general')).toBe('gpt-5-mini')
  })
})

describe('OpenAI request body', () => {
  const baseRequest = {
    systemPrompt: 'Sistema',
    userMessage: 'Usuario',
    requestClass: 'week_creator' as const,
    maxTokens: 1200,
    temperature: 0.15,
  }

  it('omits temperature for GPT-5 models that only accept the default value', () => {
    const body = buildOpenAIBody(baseRequest, 'gpt-5-mini')
    expect(body).not.toHaveProperty('temperature')
    expect(body).toMatchObject({ reasoning_effort: 'low' })
  })

  it('uses minimal reasoning effort for fast request classes on GPT-5', () => {
    const body = buildOpenAIBody({ ...baseRequest, requestClass: 'chat_general' as const }, 'gpt-5-mini')
    expect(body).toMatchObject({ reasoning_effort: 'minimal' })
  })

  it('keeps temperature for older Chat Completions models', () => {
    expect(buildOpenAIBody(baseRequest, 'gpt-4.1-mini')).toMatchObject({
      temperature: 0.15,
    })
    expect(buildOpenAIBody(baseRequest, 'gpt-4.1-mini')).not.toHaveProperty('reasoning_effort')
  })

  it('requests the final usage event when streaming', () => {
    expect(buildOpenAIBody(baseRequest, 'gpt-5-mini', true)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    })
  })
})

describe('Claude request body', () => {
  const baseRequest = {
    systemPrompt: 'Sistema',
    userMessage: 'Usuario',
    requestClass: 'plan_builder_week' as const,
    maxTokens: 3500,
    temperature: 0.35,
  }

  it('sends a plain message body when no responseSchema is provided', () => {
    const body = buildClaudeBody(baseRequest, 'claude-sonnet-4-6')
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).toMatchObject({ model: 'claude-sonnet-4-6', max_tokens: 3500, temperature: 0.35 })
  })

  it('forces structured output via tool_use when responseSchema is present', () => {
    const responseSchema = {
      type: 'object',
      properties: { week: { type: 'object' } },
      required: ['week'],
    }
    const body = buildClaudeBody({ ...baseRequest, responseSchema }, 'claude-sonnet-4-6')
    expect(body.tool_choice).toMatchObject({ type: 'tool' })
    const tools = body.tools as Array<{ name: string; input_schema: unknown }>
    expect(tools).toHaveLength(1)
    expect(tools[0].input_schema).toMatchObject({ type: 'object' })
    expect((body.tool_choice as { name: string }).name).toBe(tools[0].name)
  })

  it('sets stream flag when streaming', () => {
    expect(buildClaudeBody(baseRequest, 'claude-sonnet-4-6', true)).toMatchObject({ stream: true })
  })
})

describe('Claude stream usage', () => {
  it('does not treat message_start output_tokens as completed output', () => {
    const event = parseClaudeStreamEvent(JSON.stringify({
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 1200,
          output_tokens: 1,
          cache_creation_input_tokens: 900,
          cache_read_input_tokens: 250,
        },
      },
    }))

    expect(event.usage).toEqual({
      promptTokens: 1200,
      cacheCreationInputTokens: 900,
      cacheReadInputTokens: 250,
    })
    expect(event.usage).not.toHaveProperty('completionTokens')
  })

  it('captures completion tokens only from message_delta', () => {
    expect(parseClaudeStreamEvent(JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 340 },
    }))).toMatchObject({
      finishReason: 'end_turn',
      usage: { completionTokens: 340 },
    })
  })
})

describe('proxy provider usage mapping', () => {
  it('maps Gemini usage metadata into the shared telemetry fields', () => {
    expect(mapGeminiUsage({
      promptTokenCount: 1200,
      candidatesTokenCount: 340,
      thoughtsTokenCount: 160,
      cachedContentTokenCount: 250,
    })).toEqual({
      promptTokens: 950,
      completionTokens: 500,
      reasoningTokens: 160,
      cacheReadInputTokens: 250,
    })
  })

  it('maps OpenAI usage and cached prompt tokens', () => {
    expect(mapOpenAIUsage({
      prompt_tokens: 1200,
      completion_tokens: 340,
      prompt_tokens_details: { cached_tokens: 250 },
      completion_tokens_details: { reasoning_tokens: 120 },
    })).toEqual({
      promptTokens: 950,
      completionTokens: 340,
      reasoningTokens: 120,
      cacheReadInputTokens: 250,
    })
  })
})

function commentMatches(msg: string) {
  return tryDeterministicBypass(msg)
}
