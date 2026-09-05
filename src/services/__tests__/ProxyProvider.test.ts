import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AIRequest } from '../ai/types'
import { ProxyProvider } from '../ai/providers/ProxyProvider'

function makeRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    systemPrompt: 'Sistema',
    userMessage: 'Hola',
    requestClass: 'chat_general',
    traceId: 'trace-1',
    generationId: 'generation-1',
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
    const response = await provider.call(makeRequest({ logicalAttempt: 2 }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
    })
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"stream":true')
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"stream":false')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"logicalAttempt":2')
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"logicalAttempt":2')
    expect(response.text).toBe('Hola de vuelta')
    expect(response.streamed).toBe(false)
  })

  it('retries without streaming when the server reports an empty provider stream', async () => {
    const emptyStreamError = [
      JSON.stringify({
        type: 'error',
        error: 'El provider devolvió una respuesta vacía.',
        errorCode: 'parse_error',
      }),
      '',
    ].join('\n')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(emptyStreamError, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ text: 'Whoop registró una carga baja.', provider: 'gemini', traceId: 'trace-1' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ))

    vi.stubGlobal('fetch', fetchMock)

    const response = await new ProxyProvider().call(makeRequest())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"stream":true')
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"stream":false')
    expect(response).toMatchObject({
      text: 'Whoop registró una carga baja.',
      streamed: false,
    })
  })

  it('does not retry a parse error after streaming visible content', async () => {
    const partialStream = [
      JSON.stringify({ type: 'chunk', chunk: 'Respuesta parcial' }),
      JSON.stringify({
        type: 'error',
        truncated: true,
        error: 'El provider devolvió una respuesta incompleta.',
        errorCode: 'parse_error',
      }),
      '',
    ].join('\n')
    const fetchMock = vi.fn().mockResolvedValue(new Response(partialStream, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    }))

    vi.stubGlobal('fetch', fetchMock)

    const response = await new ProxyProvider().call(makeRequest())

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response).toMatchObject({
      text: 'Respuesta parcial',
      streamed: true,
      truncated: true,
      errorClass: 'parse_error',
    })
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
        finishReason: 'stop',
        promptTokens: 1200,
        completionTokens: 340,
        reasoningTokens: 120,
        cacheCreationInputTokens: 900,
        cacheReadInputTokens: 250,
        serviceTier: 'priority',
        reasoningEffort: 'none',
        generationId: 'generation-1',
        serverDurationMs: 4400,
        authDurationMs: 80,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    const response = await new ProxyProvider().call(makeRequest({ onChunk: undefined }))

    expect(response).toMatchObject({
      provider: 'claude',
      streamed: false,
      finishReason: 'stop',
      promptTokens: 1200,
      completionTokens: 340,
      reasoningTokens: 120,
      cacheCreationInputTokens: 900,
      cacheReadInputTokens: 250,
      serviceTier: 'priority',
      reasoningEffort: 'none',
      generationId: 'generation-1',
      serverDurationMs: 4400,
      authDurationMs: 80,
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
        reasoningTokens: 120,
        cacheCreationInputTokens: 900,
        cacheReadInputTokens: 250,
        serviceTier: 'priority',
        reasoningEffort: 'none',
        serverDurationMs: 4400,
        authDurationMs: 80,
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
      streamed: true,
      promptTokens: 1200,
      completionTokens: 340,
      reasoningTokens: 120,
      cacheCreationInputTokens: 900,
      cacheReadInputTokens: 250,
      serviceTier: 'priority',
      reasoningEffort: 'none',
      serverDurationMs: 4400,
      authDurationMs: 80,
    })
  })
})

describe('ProxyProvider — transporte de targetAthleteId', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubOkFetch() {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ text: 'ok', provider: 'gemini', traceId: 'trace-1' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('propone el objetivo cuando la request lo trae', async () => {
    const fetchMock = stubOkFetch()

    await new ProxyProvider().call(makeRequest({
      onChunk: undefined,
      targetAthleteId: 'ath_m_1',
    }))

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body['targetAthleteId']).toBe('ath_m_1')
  })

  it('omite la clave cuando la acción es sobre el propio actor', async () => {
    const fetchMock = stubOkFetch()

    await new ProxyProvider().call(makeRequest({
      onChunk: undefined,
      targetAthleteId: null,
    }))

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('targetAthleteId')
  })
})
