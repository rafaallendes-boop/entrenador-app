/**
 * OpenAI provider - calls OpenAI Chat Completions API from the browser.
 *
 * STATUS: Ready to use - same contract as ClaudeProvider.
 *
 * Required env vars:
 *   VITE_OPENAI_API_KEY - your OpenAI API key (sk-...)
 *
 * Optional env vars:
 *   VITE_OPENAI_MODEL - model ID (default: gpt-4.1-mini)
 *
 * To activate: set VITE_AI_PROVIDER=openai in your .env file.
 *
 * Note on prompt format:
 *   OpenAI uses 'system' + 'user' messages.
 *   The system prompt from promptBuilder works identically for both providers.
 *
 * Note on actions:
 *   The <actions>...</actions> block in the system prompt works with GPT-4.1 mini.
 *   For higher reliability, consider OpenAI tool calling in a future upgrade.
 *
 * Security: the key is embedded in the bundle.
 * Proxy through a backend for public deployments.
 */

import type { AIProvider, AIRequest, AIRawResponse } from '../types'
import { createProviderError } from '../types'

const DEFAULT_MODEL = 'gpt-4.1-mini'
const API_URL = 'https://api.openai.com/v1/chat/completions'

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const

  async call(request: AIRequest): Promise<AIRawResponse> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY

    if (!apiKey) {
      throw createProviderError(
        'openai',
        'unauthorized',
        'VITE_OPENAI_API_KEY no esta configurada. Anadela a tu archivo .env.',
      )
    }

    const model = import.meta.env.VITE_OPENAI_MODEL ?? DEFAULT_MODEL
    const t0 = Date.now()

    let res: Response
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? 1024,
          temperature: request.temperature ?? 0.7,
          messages: [
            { role: 'system', content: request.systemPrompt },
            ...(request.conversation ?? []).map(message => ({
              role: message.role,
              content: message.content,
            })),
            { role: 'user', content: request.userMessage },
          ],
        }),
      })
    } catch {
      throw createProviderError('openai', 'timeout', 'No se pudo conectar con la API de OpenAI. Verifica tu conexion.', true)
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`

      if (res.status === 401) {
        throw createProviderError('openai', 'unauthorized', `API key invalida. ${detail}`)
      }
      if (res.status === 429) {
        throw createProviderError('openai', 'rate_limit', `Rate limit alcanzado. ${detail}`, true)
      }
      throw createProviderError('openai', 'unknown', detail)
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>
      model: string
    }

    const text = data.choices[0]?.message?.content ?? ''
    if (!text) {
      throw createProviderError('openai', 'parse_error', 'La API de OpenAI devolvio una respuesta vacia.')
    }

    return {
      text,
      provider: 'openai',
      model: data.model ?? model,
      raw: data,
      durationMs: Date.now() - t0,
    }
  }
}
