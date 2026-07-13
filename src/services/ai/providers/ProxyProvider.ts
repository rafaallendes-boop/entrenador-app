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
import { isSupabaseConfigured, supabase } from '../../auth'
import { ApiUrlConfigurationError, resolveApiUrl } from '../../apiUrl'

const FUNCTION_PATH = '/.netlify/functions/coach'
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
    const allowStreaming = Boolean(request.onChunk)
    let streamedAnyChunk = false

    const t0 = Date.now()
    try {
      return await this.executeRequest(
        {
          ...request,
          onChunk: request.onChunk ? (chunk) => {
            streamedAnyChunk = true
            request.onChunk?.(chunk)
          } : undefined,
        },
        { stream: allowStreaming, startedAt: t0 },
      )
    } catch (error) {
      if (allowStreaming && !streamedAnyChunk && this.shouldRetryWithoutStreaming(error)) {
        return this.executeRequest(
          {
            ...request,
            onChunk: undefined,
          },
          { stream: false, startedAt: t0 },
        )
      }

      if (error instanceof AIProviderError) throw error
      throw this.normalizeUnexpectedError(error)
    }
  }

  private async executeRequest(
    request: AIRequest,
    options: { stream: boolean; startedAt: number },
  ): Promise<AIRawResponse> {
    const policy = getAIRequestPolicy(request.requestClass)
    const controller = new AbortController()
    let abortedByTimeout = false
    const abortFromCaller = () => controller.abort()
    if (request.signal?.aborted) {
      controller.abort()
    } else {
      request.signal?.addEventListener('abort', abortFromCaller, { once: true })
    }
    const timeoutId = window.setTimeout(() => {
      abortedByTimeout = true
      controller.abort()
    }, policy.timeoutMs + 2000)

    try {
      const res = await fetch(resolveApiUrl(FUNCTION_PATH), {
        method: 'POST',
        headers: await buildProxyHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          systemPrompt: request.systemPrompt,
          userMessage: request.userMessage,
          conversation: request.conversation,
          requestClass: request.requestClass,
          traceId: request.traceId,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          responseMimeType: request.responseMimeType,
          responseSchema: request.responseSchema,
          allowFallback: request.allowFallback,
          stream: options.stream,
        }),
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (options.stream && request.onChunk && (contentType.includes('text/event-stream') || contentType.includes('application/x-ndjson'))) {
        return await this.readStreamingResponse(res, request, options.startedAt)
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
        promptTokens?: number
        completionTokens?: number
        cacheCreationInputTokens?: number
        cacheReadInputTokens?: number
      }

      if (!res.ok) {
        this.throwHttpError(res, data)
      }

      if (!data.text) {
        throw createProviderError('gemini', 'parse_error', 'El servidor devolvió una respuesta vacía.')
      }

      const provider = (data.provider ?? 'gemini') as AIProviderName

      return {
        text: data.text,
        provider,
        model: data.model,
        raw: data,
        durationMs: data.durationMs ?? Date.now() - options.startedAt,
        traceId: data.traceId ?? request.traceId,
        requestClass: request.requestClass,
        retryUsed: data.retryUsed,
        fallbackUsed: data.fallbackUsed,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        cacheCreationInputTokens: data.cacheCreationInputTokens,
        cacheReadInputTokens: data.cacheReadInputTokens,
      }
    } catch (error) {
      if (error instanceof AIProviderError) throw error
      throw this.normalizeUnexpectedError(error, {
        abortedByCaller: request.signal?.aborted === true && !abortedByTimeout,
      })
    } finally {
      window.clearTimeout(timeoutId)
      request.signal?.removeEventListener('abort', abortFromCaller)
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
    let truncated = false
    let truncatedErrorClass: AIErrorCode | undefined
    let finishReason: string | undefined
    let promptTokens: number | undefined
    let completionTokens: number | undefined
    let cacheCreationInputTokens: number | undefined
    let cacheReadInputTokens: number | undefined

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
            truncated?: boolean
            finishReason?: string
            promptTokens?: number
            completionTokens?: number
            cacheCreationInputTokens?: number
            cacheReadInputTokens?: number
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
            finishReason = event.finishReason ?? finishReason
            promptTokens = event.promptTokens ?? promptTokens
            completionTokens = event.completionTokens ?? completionTokens
            cacheCreationInputTokens = event.cacheCreationInputTokens ?? cacheCreationInputTokens
            cacheReadInputTokens = event.cacheReadInputTokens ?? cacheReadInputTokens
            continue
          }

          if (event.type === 'error') {
            if (event.truncated && fullText) {
              // Stream was cut after emitting partial content. Return what we got
              // and let responseNormalizer mark it as truncated — no proposal created.
              truncated = true
              truncatedErrorClass = event.errorCode
              break
            }
            throw createProviderError('gemini', event.errorCode ?? 'unknown', event.error ?? 'Streaming falló.')
          }
        } catch (error) {
          if (error instanceof AIProviderError) throw error
        }
      }
      if (truncated) break
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
      truncated,
      finishReason,
      errorClass: truncatedErrorClass,
      promptTokens,
      completionTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
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

  private shouldRetryWithoutStreaming(error: unknown): boolean {
    return error instanceof AIProviderError
      && error.retryable
      && (
        error.code === 'timeout'
        || error.code === 'server_error'
        || error.code === 'unknown'
      )
  }

  private normalizeUnexpectedError(
    error: unknown,
    options?: { abortedByCaller?: boolean },
  ): AIProviderError {
    if (error instanceof AIProviderError) return error
    if (error instanceof ApiUrlConfigurationError) {
      return createProviderError('gemini', 'misconfigured', error.message)
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return createProviderError(
        'gemini',
        'timeout',
        options?.abortedByCaller
          ? 'Solicitud de RallyIQ cancelada.'
          : 'El servidor de RallyIQ tardó demasiado en responder. Intenta de nuevo.',
        !options?.abortedByCaller,
      )
    }

    return createProviderError(
      'gemini',
      'timeout',
      'No se pudo conectar con el servidor de RallyIQ. Verifica tu conexión.',
      true,
    )
  }
}

async function buildProxyHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!isSupabaseConfigured || !supabase) return headers

  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    // Let the proxy return a controlled 401 if the session cannot be read.
  }

  return headers
}
