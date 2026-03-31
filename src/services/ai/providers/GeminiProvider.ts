import type { AIProvider, AIRequest, AIRawResponse } from '../types'
import { createProviderError } from '../types'

const DEFAULT_MODEL = 'gemini-2.5-flash'
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/'

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const

  async call(request: AIRequest): Promise<AIRawResponse> {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY

    if (!apiKey) {
      throw createProviderError(
        'gemini',
        'unauthorized',
        'VITE_GEMINI_API_KEY no está configurada. Añádela a tu archivo .env.',
      )
    }

    const model = import.meta.env.VITE_GEMINI_MODEL ?? DEFAULT_MODEL
    const url = `${BASE_URL}${model}:generateContent?key=${apiKey}`
    const t0 = Date.now()

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: request.systemPrompt }],
          },
          contents: [
            ...(request.conversation ?? []).map(message => ({
              role: message.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: message.content }],
            })),
            { role: 'user', parts: [{ text: request.userMessage }] },
          ],
          generationConfig: {
            maxOutputTokens: request.maxTokens ?? 1024,
            temperature: request.temperature ?? 0.7,
          },
        }),
      })
    } catch {
      throw createProviderError('gemini', 'timeout', 'No se pudo conectar con la API de Gemini. Verifica tu conexión.', true)
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`

      if (res.status === 400 && detail.includes('API key')) {
        throw createProviderError('gemini', 'unauthorized', `API key inválida. ${detail}`)
      }
      if (res.status === 429) {
        throw createProviderError('gemini', 'rate_limit', `Rate limit alcanzado. ${detail}`, true)
      }
      throw createProviderError('gemini', 'unknown', detail)
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
      }>
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) {
      throw createProviderError('gemini', 'parse_error', 'La API de Gemini devolvió una respuesta vacía o inesperada.')
    }

    return {
      text,
      provider: 'gemini',
      model,
      raw: data,
      durationMs: Date.now() - t0,
    }
  }
}
