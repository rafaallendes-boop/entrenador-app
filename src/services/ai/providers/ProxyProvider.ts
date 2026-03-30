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

import type { AIProvider, AIRequest, AIRawResponse } from '../types'
import { createProviderError } from '../types'
import type { AIProviderName } from '../../../types'

const FUNCTION_URL = '/.netlify/functions/coach'

export class ProxyProvider implements AIProvider {
  // El servidor retorna el proveedor real en la respuesta (ej: 'gemini').
  // Este campo se usa para `getProviderName()` y el badge en dev.
  // En producción el badge se actualiza con el valor real de AIRawResponse.provider.
  readonly name = 'gemini' as const

  async call(request: AIRequest): Promise<AIRawResponse> {
    const t0 = Date.now()

    let res: Response
    try {
      res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: request.systemPrompt,
          userMessage: request.userMessage,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        }),
      })
    } catch {
      throw createProviderError(
        'gemini',
        'timeout',
        'No se pudo conectar con el servidor del coach. Verifica tu conexión.',
        true,
      )
    }

    const data = await res.json().catch(() => ({})) as {
      text?: string
      provider?: string
      model?: string
      error?: string
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw createProviderError('gemini', 'unauthorized', data.error ?? 'No autorizado por el servidor.')
      }
      if (res.status === 429) {
        throw createProviderError('gemini', 'rate_limit', data.error ?? 'Demasiadas solicitudes. Intenta en unos minutos.', true)
      }
      throw createProviderError('gemini', 'unknown', data.error ?? `Error del servidor (${res.status})`)
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
      durationMs: Date.now() - t0,
    }
  }
}
