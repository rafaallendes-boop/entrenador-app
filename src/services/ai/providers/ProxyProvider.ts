/**
 * ProxyProvider — llama a /.netlify/functions/coach en vez de la API directamente.
 *
 * Es el único proveedor usado en producción (VITE_AI_PROVIDER=proxy o import.meta.env.PROD).
 * La API key vive únicamente en el servidor (Netlify Function) — nunca en el bundle.
 *
 * Para desarrollo local con IA real:
 *   1. Instala netlify-cli: npm install -g netlify-cli
 *   2. Pon VITE_AI_PROVIDER=proxy en .env
 *   3. Corre `netlify dev` en vez de `npm run dev`
 *      → levanta Vite + Functions en localhost:8888
 */

import type { AIProvider, AIRequest, AIRawResponse, AIErrorCode } from '../types'
import { AIProviderError, createProviderError } from '../types'
import type { AIProviderName, AIRequestClass } from '../../../types'
import { getAIRequestPolicy } from '../requestPolicy'

const FUNCTION_URL = '/.netlify/functions/coach'
type ProxyErrorPayload = {
  error?: string
  errorCode?: AIErrorCode
}

export class ProxyProvider implements AIProvider {
  // El servidor retorna el proveedor real en la respuesta (ej: 'gemini').
  // Este campo se usa para `getProviderName()` y el badge en dev.
  // En producción el badge se actualiza con el valor real de AIRawResponse.provider.
  readonly name = 'gemini' as const

  async call(request: AIRequest): Promise<AIRawResponse> {
    const t0 = Date.now()
    const policy = getAIRequestPolicy(request.requestClass)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), policy.timeoutMs + 2000)
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemPrompt: request.systemPrompt,
          userMessage: request.userMessage,
          conversation: request.conversation,
          requestClass: request.requestClass,
          traceId: request.traceId,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          allowFallback: request.allowFallback,
          stream: Boolean(request.onChunk),
        }),
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (request.onChunk && (contentType.includes('text/event-stream') || contentType.includes('application/x-ndjson'))) {
        return await this.readStreamingResponse(res, request, t0)
      }

      const data = await res.json().catch(() => ({})) as {
        text?: string
        provider?: string
        model?: string
        error?: string
        errorCode?: AIErrorCode
        traceId?: string
        retryUsed?: boolean
        fallbackUsed?: boolean
        requestClass?: AIRequestClass
        durationMs?: number
      }

      if (!res.ok) {
        this.throwHttpError(res, data)
      }

      if (!data.text) {
        throw createProviderError('gemini', 'parse_error', 'El servidor devolvió una respuesta vacía.')
      }

      // Usar el proveedor que retorna el servidor (puede ser gemini/openai/claude según AI_PROVIDER)
      const provider = (data.provider ?? 'gemini') as AIProviderName

      return {
        text: data.text,
        provider,
        model: data.model,
        raw: data,
        durationMs: data.durationMs ?? Date.now() - t0,
        traceId: data.traceId ?? request.traceId,
        requestClass: request.requestClass,
        retryUsed: data.retryUsed,
        fallbackUsed: data.fallbackUsed,
      }
    } catch (error) {
      if (error instanceof AIProviderError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw createProviderError(
          'gemini',
          'timeout',
          'El servidor del coach tardó demasiado en responder. Intenta de nuevo.',
          true,
        )
      }
      throw createProviderError(
        'gemini',
        'timeout',
        'No se pudo conectar con el servidor del coach. Verifica tu conexión.',
        true,
      )
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  private async readStreamingResponse(
    res: Response,
    request: AIRequest,
    t0: number,
  ): Promise<AIRawResponse> {
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as ProxyErrorPayload
      this.throwHttpError(res, data)
    }

    if (!res.body) {
      throw createProviderError('gemini', 'parse_error', 'El servidor devolvió un stream vacío.')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let provider: AIProviderName = 'gemini'
    let model: string | undefined
    let retryUsed = false
    let fallbackUsed = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed) as {
            type?: 'chunk' | 'done' | 'error'
            chunk?: string
            text?: string
            provider?: AIProviderName
            model?: string
            retryUsed?: boolean
            fallbackUsed?: boolean
            error?: string
            errorCode?: AIErrorCode
            traceId?: string
          }

          if (event.type === 'chunk' && event.chunk) {
            fullText += event.chunk
            request.onChunk?.(event.chunk)
            continue
          }

          if (event.type === 'done') {
            provider = event.provider ?? provider
            model = event.model
            retryUsed = event.retryUsed ?? retryUsed
            fallbackUsed = event.fallbackUsed ?? fallbackUsed
            fullText = event.text ?? fullText
            continue
          }

          if (event.type === 'error') {
            throw createProviderError('gemini', event.errorCode ?? 'unknown', event.error ?? 'Streaming falló.')
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AIProviderError') throw error
        }
      }
    }

    if (!fullText) {
      throw createProviderError('gemini', 'parse_error', 'El servidor devolvió una respuesta vacía.')
    }

    return {
      text: fullText,
      provider,
      model,
      durationMs: Date.now() - t0,
      traceId: request.traceId,
      requestClass: request.requestClass,
      retryUsed,
      fallbackUsed,
    }
  }

  private throwHttpError(res: Response, data: ProxyErrorPayload): never {
    const message = data.error ?? `Error del servidor (${res.status}).`

    if (res.status === 401 || res.status === 403) {
      throw createProviderError('gemini', data.errorCode === 'misconfigured' ? 'misconfigured' : 'unauthorized', message)
    }

    if (res.status === 429 || data.errorCode === 'rate_limit') {
      throw createProviderError('gemini', 'rate_limit', message, true)
    }

    if (res.status === 502 || res.status === 503 || res.status === 504 || data.errorCode === 'timeout') {
      throw createProviderError('gemini', 'timeout', message, true)
    }

    if (data.errorCode === 'misconfigured') {
      throw createProviderError('gemini', 'misconfigured', message)
    }

    if (data.errorCode === 'unauthorized') {
      throw createProviderError('gemini', 'unauthorized', message)
    }

    if (res.status >= 500 || data.errorCode === 'server_error') {
      throw createProviderError('gemini', 'server_error', message)
    }

    throw createProviderError('gemini', data.errorCode ?? 'unknown', message)
  }
}
