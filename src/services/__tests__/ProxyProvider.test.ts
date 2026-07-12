import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AIRequest } from '../ai/types'
import { ProxyProvider } from '../ai/providers/ProxyProvider'

function makeRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    systemPrompt: 'Sistema',
    userMessage: 'Hola',
    requestClass: 'chat_general',
    traceId: 'trace-1',
    onChunk: vi.fn(),
    ...overrides,
  }
}

describe('ProxyProvider streaming fallback', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries chat requests without streaming when the streaming transport fails with gateway timeout', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: 'Gateway timeout', errorCode: 'timeout' }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ text: 'Hola de vuelta', provider: 'gemini', traceId: 'trace-1' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ))

    vi.stubGlobal('fetch', fetchMock)

    const provider = new ProxyProvider()
    const response = await provider.call(makeRequest())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
    })
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"stream":true')
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"stream":false')
    expect(response.text).toBe('Hola de vuelta')
  })

  it('normalizes unauthorized proxy responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Sesión requerida para usar el coach.', errorCode: 'unauthorized' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    )))

    const provider = new ProxyProvider()

    await expect(provider.call(makeRequest({ onChunk: undefined }))).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Sesión requerida para usar el coach.',
    })
  })

  it('normalizes rate limit proxy responses as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Demasiadas solicitudes al coach.', errorCode: 'rate_limit' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      },
    )))

    const provider = new ProxyProvider()

    await expect(provider.call(makeRequest({ onChunk: undefined }))).rejects.toMatchObject({
      code: 'rate_limit',
      retryable: true,
      message: 'Demasiadas solicitudes al coach.',
    })
  })

  it('preserves Claude usage returned by the proxy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        text: '{"ok":true}',
        provider: 'claude',
        promptTokens: 1200,
        completionTokens: 340,
        cacheCreationInputTokens: 900,
        cacheReadInputTokens: 250,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    const response = await new ProxyProvider().call(makeRequest({ onChunk: undefined }))

    expect(response).toMatchObject({
      provider: 'claude',
      promptTokens: 1200,
      completionTokens: 340,
      cacheCreationInputTokens: 900,
      cacheReadInputTokens: 250,
    })
  })

  it('preserves Claude usage from the streaming done event', async () => {
    const body = [
      JSON.stringify({ type: 'chunk', chunk: '{"ok":true}' }),
      JSON.stringify({
        type: 'done',
        provider: 'claude',
        promptTokens: 1200,
        completionTokens: 340,
        cacheCreationInputTokens: 900,
        cacheReadInputTokens: 250,
      }),
      '',
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })))

    const response = await new ProxyProvider().call(makeRequest())

    expect(response).toMatchObject({
      provider: 'claude',
      promptTokens: 1200,
      completionTokens: 340,
      cacheCreationInputTokens: 900,
      cacheReadInputTokens: 250,
    })
  })
})
