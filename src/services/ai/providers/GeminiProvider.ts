import type { AIProvider, AIRequest, AIRawResponse } from '../types'
import { createProviderError } from '../types'
import { normalizeJsonSchemaForGemini } from '../jsonSchema'
import { mapGeminiUsage } from '../providerUsage'

const DEFAULT_MODEL = 'gemini-2.5-flash'
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/'

function supportsThinkingConfig(model: string): boolean {
  return /gemini-2\.5-(flash|flash-lite)/i.test(model)
}

function getThinkingBudget(requestClass: AIRequest['requestClass']): number {
  switch (requestClass) {
    case 'plan_builder_week':
    case 'plan_builder_pair':
      return 1024
    case 'chat_action':
    case 'week_creator':
      return 256
    case 'chat_general':
    case 'weekly_summary':
    case 'import_extract':
    case 'coach_assistant_message':
      return 0
  }
}

function buildGenerationConfig(request: AIRequest, model: string): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: request.maxTokens ?? 1024,
    temperature: request.temperature ?? 0.7,
  }
  if (supportsThinkingConfig(model)) {
    generationConfig.thinkingConfig = {
      thinkingBudget: getThinkingBudget(request.requestClass),
    }
  }
  if (request.responseMimeType) generationConfig.responseMimeType = request.responseMimeType
  if (request.responseSchema) {
    generationConfig.responseSchema = normalizeJsonSchemaForGemini(request.responseSchema)
  }
  return generationConfig
}

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
    const t0 = Date.now()

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [
        ...(request.conversation ?? []).map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        { role: 'user', parts: [{ text: request.userMessage }] },
      ],
      generationConfig: buildGenerationConfig(request, model),
    })

    if (request.onChunk) {
      return this.callStream(request, body, apiKey, model, t0)
    }

    const url = `${BASE_URL}${model}:generateContent?key=${apiKey}`

    let res: Response
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    } catch {
      throw createProviderError('gemini', 'timeout', 'No se pudo conectar con la API de Gemini. Verifica tu conexión.', true)
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      const detail = (errBody as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`
      if (res.status === 400 && detail.includes('API key')) throw createProviderError('gemini', 'unauthorized', `API key inválida. ${detail}`)
      if (res.status === 429) throw createProviderError('gemini', 'rate_limit', `Rate limit alcanzado. ${detail}`, true)
      throw createProviderError('gemini', 'unknown', detail)
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      usageMetadata?: {
        promptTokenCount?: number
      candidatesTokenCount?: number
      thoughtsTokenCount?: number
      cachedContentTokenCount?: number
      }
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) throw createProviderError('gemini', 'parse_error', 'La API de Gemini devolvió una respuesta vacía o inesperada.')

    return {
      text,
      provider: 'gemini',
      model,
      raw: data,
      durationMs: Date.now() - t0,
      traceId: request.traceId,
      requestClass: request.requestClass,
      finishReason: data.candidates?.[0]?.finishReason,
      ...mapGeminiUsage(data.usageMetadata),
    }
  }

  private async callStream(
    request: AIRequest,
    body: string,
    apiKey: string,
    model: string,
    t0: number,
  ): Promise<AIRawResponse> {
    const url = `${BASE_URL}${model}:streamGenerateContent?alt=sse&key=${apiKey}`

    let res: Response
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    } catch {
      throw createProviderError('gemini', 'timeout', 'No se pudo conectar con la API de Gemini. Verifica tu conexión.', true)
    }

    if (!res.ok || !res.body) {
      const errBody = await res.json().catch(() => ({}))
      const detail = (errBody as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`
      if (res.status === 429) throw createProviderError('gemini', 'rate_limit', `Rate limit alcanzado. ${detail}`, true)
      throw createProviderError('gemini', 'unknown', detail)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    let finishReason: string | undefined
    let promptTokens: number | undefined
    let completionTokens: number | undefined
    let reasoningTokens: number | undefined
    let cacheReadInputTokens: number | undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue
        try {
          const data = JSON.parse(jsonStr) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
            usageMetadata?: {
              promptTokenCount?: number
              candidatesTokenCount?: number
              thoughtsTokenCount?: number
              cachedContentTokenCount?: number
            }
          }
          const chunk = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          if (chunk) { fullText += chunk; request.onChunk?.(chunk) }
          finishReason = data.candidates?.[0]?.finishReason ?? finishReason
          const usage = mapGeminiUsage(data.usageMetadata)
          promptTokens = usage.promptTokens ?? promptTokens
          completionTokens = usage.completionTokens ?? completionTokens
          reasoningTokens = usage.reasoningTokens ?? reasoningTokens
          cacheReadInputTokens = usage.cacheReadInputTokens ?? cacheReadInputTokens
        } catch { /* skip malformed SSE line */ }
      }
    }

    if (!fullText) throw createProviderError('gemini', 'parse_error', 'La API de Gemini devolvió una respuesta vacía.')

    return {
      text: fullText,
      provider: 'gemini',
      model,
      durationMs: Date.now() - t0,
      traceId: request.traceId,
      requestClass: request.requestClass,
      finishReason,
      promptTokens,
      completionTokens,
      reasoningTokens,
      cacheReadInputTokens,
    }
  }
}
