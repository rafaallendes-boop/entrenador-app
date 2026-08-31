import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AIRequest } from '../../types'
import { ProxyProvider } from '../ProxyProvider'
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError } from '../../../entitlements/usageGateError'

/**
 * Construye una Response real cuyo body es un ReadableStream<Uint8Array> que
 * emite las líneas NDJSON dadas, una por chunk. Esto ejercita el parser de
 * streaming real de ProxyProvider (el bucle `reader.read()` + `JSON.parse`
 * línea a línea), no solo la lógica de clasificación fuera de contexto.
 */
function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

function rawStreamResponse(body: string, contentType: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': contentType },
  })
}

function request(): AIRequest {
  return {
    systemPrompt: 'Sistema',
    userMessage: 'Hola',
    requestClass: 'chat_general',
    traceId: 'trace-usage-gate-stream',
    onChunk: vi.fn(),
  }
}

describe('ProxyProvider — streaming reconoce los códigos del usage gate', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('un chunk de error streaming con quota_exceeded lanza QuotaExceededError con detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      JSON.stringify({
        type: 'error',
        errorCode: 'quota_exceeded',
        detail: { bucketId: 'chat', limit: 15, remaining: 0 },
        error: 'Alcanzaste el cupo diario.',
      }),
    ])))

    const provider = new ProxyProvider()
    let thrown: unknown
    try {
      await provider.call(request())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(QuotaExceededError)
    expect((thrown as QuotaExceededError).detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
  })

  it('un chunk de error streaming con spend_cap_exceeded lanza SpendCapExceededError con detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      JSON.stringify({
        type: 'error',
        errorCode: 'spend_cap_exceeded',
        detail: { scope: 'global', capUsd: 5 },
        error: 'Presupuesto diario alcanzado.',
      }),
    ])))

    const provider = new ProxyProvider()
    let thrown: unknown
    try {
      await provider.call(request())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SpendCapExceededError)
    expect((thrown as SpendCapExceededError).detail).toEqual({ scope: 'global', capUsd: 5 })
  })

  it('un chunk de error streaming con kill_switch_active lanza KillSwitchActiveError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      JSON.stringify({
        type: 'error',
        errorCode: 'kill_switch_active',
        error: 'IA pausada.',
      }),
    ])))

    const provider = new ProxyProvider()
    await expect(provider.call(request())).rejects.toBeInstanceOf(KillSwitchActiveError)
  })

  it('un chunk de error streaming con quota_exceeded y detail malformado NO usa el error tipado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      JSON.stringify({
        type: 'error',
        errorCode: 'quota_exceeded',
        detail: { bucketId: 'chat' },
        error: 'Alcanzaste el cupo diario.',
      }),
    ])))

    const provider = new ProxyProvider()
    let thrown: unknown
    try {
      await provider.call(request())
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(QuotaExceededError)
    expect(thrown).toMatchObject({ code: 'quota_exceeded' })
  })

  it('un chunk de chat_general normal (sin error) sigue funcionando igual', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      JSON.stringify({ type: 'chunk', chunk: 'Hola ' }),
      JSON.stringify({ type: 'chunk', chunk: 'mundo' }),
      JSON.stringify({ type: 'done', text: 'Hola mundo', provider: 'gemini' }),
    ])))

    const provider = new ProxyProvider()
    const result = await provider.call(request())
    expect(result.text).toBe('Hola mundo')
    expect(result.streamed).toBe(true)
  })

  it('procesa la cola NDJSON aunque no termine en salto de línea', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawStreamResponse(
      JSON.stringify({ type: 'done', text: '¿Cómo estás?', provider: 'gemini' }),
      'application/x-ndjson',
    )))

    const result = await new ProxyProvider().call(request())

    expect(result.text).toBe('¿Cómo estás?')
    expect(result.streamed).toBe(true)
  })

  it('acepta framing SSE cuando la respuesta declara text/event-stream', async () => {
    const event = JSON.stringify({ type: 'done', text: 'Algún día', provider: 'gemini' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawStreamResponse(
      `data: ${event}\n\ndata: [DONE]`,
      'text/event-stream',
    )))

    const result = await new ProxyProvider().call(request())

    expect(result.text).toBe('Algún día')
    expect(result.streamed).toBe(true)
  })
})
