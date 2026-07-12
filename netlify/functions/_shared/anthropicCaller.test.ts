import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIRequest } from '../../../src/services/ai/types'
import { callAnthropicForWeek } from './anthropicCaller'

const originalFetch = globalThis.fetch

function makeRequest(): AIRequest {
  return {
    requestClass: 'plan_builder_week',
    traceId: 'trace-model-env',
    systemPrompt: 'system',
    userMessage: 'user',
    maxTokens: 5000,
    temperature: 0.2,
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env['CLAUDE_API_KEY']
  delete process.env['CLAUDE_MODEL']
  delete process.env['CLAUDE_MODEL_PLAN_BUILDER_WEEK']
  vi.restoreAllMocks()
})

describe('callAnthropicForWeek', () => {
  it('uses CLAUDE_MODEL_PLAN_BUILDER_WEEK without changing the default in code', async () => {
    process.env['CLAUDE_API_KEY'] = 'test-key'
    process.env['CLAUDE_MODEL'] = 'claude-sonnet-4-6'
    process.env['CLAUDE_MODEL_PLAN_BUILDER_WEEK'] = 'claude-haiku-4-5'
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      void _input
      void _init
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"type":"create_week","sessions":[]}' }],
        model: 'claude-haiku-4-5',
        stop_reason: 'end_turn',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    globalThis.fetch = fetchMock as typeof fetch

    const result = await callAnthropicForWeek(makeRequest())

    const init = fetchMock.mock.calls[0]?.[1]
    if (!init?.body) throw new Error('Expected Anthropic fetch body')
    const body = JSON.parse(init.body as string) as { model?: string }
    expect(body.model).toBe('claude-haiku-4-5')
    expect(result.model).toBe('claude-haiku-4-5')
  })

  it('returns Anthropic token and prompt-cache usage without retaining content', async () => {
    process.env['CLAUDE_API_KEY'] = 'test-key'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: '{"type":"create_week","sessions":[]}' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_creation_input_tokens: 900,
        cache_read_input_tokens: 250,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

    const result = await callAnthropicForWeek(makeRequest())

    expect(result).toMatchObject({
      promptTokens: 1200,
      completionTokens: 340,
      cacheCreationInputTokens: 900,
      cacheReadInputTokens: 250,
      finishReason: 'end_turn',
    })
    expect(result.raw).toBeUndefined()
  })
})
