/**
 * Netlify Function: coach
 *
 * Secure proxy between the PWA frontend and the AI provider (Gemini / OpenAI / Claude).
 * The API key NEVER reaches the browser — it lives only in Netlify's env vars.
 *
 * Environment variables (set in Netlify dashboard or local .env for netlify dev):
 *   AI_PROVIDER   — 'gemini' | 'openai' | 'claude'  (default: 'gemini')
 *   GEMINI_API_KEY  — required when AI_PROVIDER=gemini
 *   OPENAI_API_KEY  — required when AI_PROVIDER=openai
 *   CLAUDE_API_KEY  — required when AI_PROVIDER=claude
 *
 * Request body (JSON):
 *   { systemPrompt: string, userMessage: string, maxTokens?: number, temperature?: number }
 *
 * Response body (JSON):
 *   { text: string, provider: string, model: string }
 *   or on error: { error: string }
 */

// ─── Inline types (no external deps needed) ───────────────────────────────────

interface LambdaEvent {
  httpMethod: string
  body: string | null
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

interface CoachRequest {
  systemPrompt: string
  userMessage: string
  conversation?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  maxTokens?: number
  temperature?: number
}

// ─── Provider implementations ─────────────────────────────────────────────────

const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-4-6',
}

async function callGemini(req: CoachRequest, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: [
        ...(req.conversation ?? []).map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        { role: 'user', parts: [{ text: req.userMessage }] },
      ],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    const err = new Error(body.error?.message ?? `Gemini HTTP ${res.status}`) as Error & { statusCode: number }
    err.statusCode = res.status
    throw err
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini devolvió una respuesta vacía.')
  return text
}

async function callOpenAI(req: CoachRequest, apiKey: string, model: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...(req.conversation ?? []).map(message => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: req.userMessage },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    const err = new Error(body.error?.message ?? `OpenAI HTTP ${res.status}`) as Error & { statusCode: number }
    err.statusCode = res.status
    throw err
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> }
  const text = data.choices[0]?.message?.content
  if (!text) throw new Error('OpenAI devolvió una respuesta vacía.')
  return text
}

async function callClaude(req: CoachRequest, apiKey: string, model: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      system: req.systemPrompt,
      messages: [
        ...(req.conversation ?? []).map(message => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: req.userMessage },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    const err = new Error(body.error?.message ?? `Claude HTTP ${res.status}`) as Error & { statusCode: number }
    err.statusCode = res.status
    throw err
  }
  const data = await res.json() as { content: Array<{ type: string; text: string }>; model: string }
  const text = data.content.find(c => c.type === 'text')?.text
  if (!text) throw new Error('Claude devolvió una respuesta vacía.')
  return text
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEADERS = { 'Content-Type': 'application/json' }

function json(statusCode: number, body: object): LambdaResponse {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  let req: CoachRequest
  try {
    req = JSON.parse(event.body ?? '{}') as CoachRequest
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!req.systemPrompt || !req.userMessage) {
    return json(400, { error: 'Missing required fields: systemPrompt, userMessage' })
  }

  const provider = (process.env['AI_PROVIDER'] ?? 'gemini').toLowerCase()
  const model =
    (provider === 'gemini' ? process.env['GEMINI_MODEL'] : undefined) ??
    (provider === 'openai' ? process.env['OPENAI_MODEL'] : undefined) ??
    (provider === 'claude' ? process.env['CLAUDE_MODEL'] : undefined) ??
    DEFAULT_MODELS[provider] ??
    DEFAULT_MODELS['gemini']!

  try {
    let text: string

    if (provider === 'gemini') {
      const key = process.env['GEMINI_API_KEY']
      if (!key) return json(500, { error: 'GEMINI_API_KEY no configurada en el servidor.' })
      text = await callGemini(req, key, model)

    } else if (provider === 'openai') {
      const key = process.env['OPENAI_API_KEY']
      if (!key) return json(500, { error: 'OPENAI_API_KEY no configurada en el servidor.' })
      text = await callOpenAI(req, key, model)

    } else if (provider === 'claude') {
      const key = process.env['CLAUDE_API_KEY']
      if (!key) return json(500, { error: 'CLAUDE_API_KEY no configurada en el servidor.' })
      text = await callClaude(req, key, model)

    } else {
      return json(500, { error: `Proveedor desconocido: ${provider}` })
    }

    return json(200, { text, provider, model })

  } catch (e) {
    const err = e as Error & { statusCode?: number }
    const normalizedMessage = (err.message ?? '').toLowerCase()
    const status = err.statusCode === 429 ? 429
      : err.statusCode === 401 ? 401
      : err.statusCode === 502 ? 502
      : err.statusCode === 503 ? 503
      : err.statusCode === 504 ? 504
      : normalizedMessage.includes('deadline') || normalizedMessage.includes('timed out') || normalizedMessage.includes('timeout')
        ? 504
        : 500
    return json(status, { error: err.message ?? 'Error interno del servidor.' })
  }
}
