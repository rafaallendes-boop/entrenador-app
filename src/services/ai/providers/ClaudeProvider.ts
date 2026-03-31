/**
 * Claude provider — calls Anthropic API directly from the browser.
 *
 * Required env vars:
 *   VITE_CLAUDE_API_KEY  — your Anthropic API key (sk-ant-...)
 *
 * Optional env vars:
 *   VITE_CLAUDE_MODEL    — model ID (default: claude-sonnet-4-6)
 *
 * Note: VITE_AI_API_KEY is supported as a fallback for backwards compatibility.
 *
 * Security: the API key is embedded in the JS bundle at build time (Vite).
 * This is acceptable for a personal PWA installed on your own device.
 * Do NOT publish this build publicly — anyone could extract the key.
 * For public deployment, proxy calls through a backend.
 */

import type { AIProvider, AIRequest, AIRawResponse } from '../types'
import { createProviderError } from '../types'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude' as const

  async call(request: AIRequest): Promise<AIRawResponse> {
    const apiKey =
      import.meta.env.VITE_CLAUDE_API_KEY ??
      import.meta.env.VITE_AI_API_KEY  // backwards compat

    if (!apiKey) {
      throw createProviderError(
        'claude',
        'unauthorized',
        'VITE_CLAUDE_API_KEY no está configurada. Añádela a tu archivo .env.',
      )
    }

    const model = import.meta.env.VITE_CLAUDE_MODEL ?? DEFAULT_MODEL
    const t0 = Date.now()

    const HEADERS = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for direct browser calls — without this Anthropic rejects CORS requests
      'anthropic-dangerous-direct-browser-access': 'true',
    }

    const messages = [
      ...(request.conversation ?? []).map(message => ({ role: message.role, content: message.content })),
      { role: 'user', content: request.userMessage },
    ]

    if (request.onChunk) {
      return this.callStream(request.onChunk, apiKey, model, HEADERS, messages, request, t0)
    }

    let res: Response
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ model, max_tokens: request.maxTokens ?? 1024, temperature: request.temperature ?? 0.7, system: request.systemPrompt, messages }),
      })
    } catch {
      throw createProviderError('claude', 'timeout', 'No se pudo conectar con la API de Claude. Verifica tu conexión.', true)
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`
      if (res.status === 401) throw createProviderError('claude', 'unauthorized', `API key inválida o sin permisos. ${detail}`)
      if (res.status === 429) throw createProviderError('claude', 'rate_limit', `Rate limit alcanzado. ${detail}`, true)
      throw createProviderError('claude', 'unknown', detail)
    }

    const data = await res.json() as { content: Array<{ type: string; text: string }>; model: string }
    const text = data.content.find(c => c.type === 'text')?.text ?? ''
    if (!text) throw createProviderError('claude', 'parse_error', 'La API de Claude devolvió una respuesta vacía.')

    return { text, provider: 'claude', model: data.model ?? model, raw: data, durationMs: Date.now() - t0 }
  }

  private async callStream(
    onChunk: (chunk: string) => void,
    _apiKey: string,
    model: string,
    headers: Record<string, string>,
    messages: Array<{ role: string; content: string }>,
    request: AIRequest,
    t0: number,
  ): Promise<AIRawResponse> {
    let res: Response
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? 1024,
          temperature: request.temperature ?? 0.7,
          system: request.systemPrompt,
          stream: true,
          messages,
        }),
      })
    } catch {
      throw createProviderError('claude', 'timeout', 'No se pudo conectar con la API de Claude. Verifica tu conexión.', true)
    }

    if (!res.ok || !res.body) {
      const errBody = await res.json().catch(() => ({}))
      const detail = (errBody as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`
      if (res.status === 401) throw createProviderError('claude', 'unauthorized', `API key inválida. ${detail}`)
      if (res.status === 429) throw createProviderError('claude', 'rate_limit', `Rate limit alcanzado. ${detail}`, true)
      throw createProviderError('claude', 'unknown', detail)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue
        try {
          const event = JSON.parse(jsonStr) as { type?: string; delta?: { type?: string; text?: string } }
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const chunk = event.delta.text ?? ''
            if (chunk) { fullText += chunk; onChunk(chunk) }
          }
        } catch { /* skip malformed SSE line */ }
      }
    }

    if (!fullText) throw createProviderError('claude', 'parse_error', 'La API de Claude devolvió una respuesta vacía.')

    return { text: fullText, provider: 'claude', model, durationMs: Date.now() - t0 }
  }
}
