/**
 * Netlify Function: coach
 *
 * Secure proxy between the PWA frontend and the AI provider (Gemini / OpenAI / Claude).
 * Adds request-class policies, technical retry/fallback, trace propagation and
 * streaming NDJSON when the client requests chunks.
 */

interface LambdaEvent {
  httpMethod: string
  body: string | null
}

type LambdaResponse = Response | {
  statusCode: number
  headers: Record<string, string>
  body: string
}

type ProviderName = 'gemini' | 'openai' | 'claude'
type RequestClass =
  | 'chat_general'
  | 'chat_action'
  | 'weekly_summary'
  | 'plan_builder_week'
  | 'plan_builder_pair'
  | 'import_extract'
type TechnicalErrorCode = 'timeout' | 'rate_limit' | 'parse_error' | 'server_error' | 'misconfigured' | 'unknown' | 'unauthorized'

interface CoachRequest {
  systemPrompt: string
  userMessage: string
  conversation?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  requestClass?: RequestClass
  traceId?: string
  maxTokens?: number
  temperature?: number
  allowFallback?: boolean
  stream?: boolean
}

interface NormalizedServerError extends Error {
  statusCode?: number
  errorCode?: TechnicalErrorCode
  retryable?: boolean
}

interface ProviderExecutionResult {
  text: string
  provider: ProviderName
  model: string
  traceId: string
  requestClass: RequestClass
  retryUsed: boolean
  fallbackUsed: boolean
  durationMs: number
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-4-6',
}

// Timeouts aligned with client-side requestPolicy.ts.
const REQUEST_TIMEOUTS: Record<RequestClass, number> = {
  chat_general: 15000,
  chat_action: 25000,
  weekly_summary: 20000,
  plan_builder_week: 30000,
  plan_builder_pair: 45000,
  import_extract: 20000,
}
// Netlify synchronous functions currently allow 60s; keep a small buffer for response finalization.
const MAX_FUNCTION_WALLCLOCK_MS = 55000
const MIN_PROVIDER_ATTEMPT_MS = 4000

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
}

function json(statusCode: number, body: object): LambdaResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }
}

function normalizeRequestClass(value: unknown): RequestClass {
  switch (value) {
    case 'chat_action':
    case 'weekly_summary':
    case 'plan_builder_week':
    case 'plan_builder_pair':
    case 'import_extract':
      return value
    default:
      return 'chat_general'
  }
}

function makeError(
  message: string,
  statusCode: number,
  errorCode: TechnicalErrorCode,
  retryable = false,
): NormalizedServerError {
  const error = new Error(message) as NormalizedServerError
  error.statusCode = statusCode
  error.errorCode = errorCode
  error.retryable = retryable
  return error
}

function normalizeError(error: unknown): NormalizedServerError {
  const err = error as NormalizedServerError
  const message = err.message ?? 'Error interno del servidor.'
  const statusCode = err.statusCode
  if (statusCode === 401 || statusCode === 403) {
    return makeError(message, statusCode, 'unauthorized')
  }
  if (statusCode === 429) {
    return makeError(message, 429, 'rate_limit', true)
  }
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return makeError(message, statusCode, 'timeout', true)
  }
  if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out')) {
    return makeError(message, 504, 'timeout', true)
  }
  return makeError(message, 500, err.errorCode ?? 'server_error')
}

function parseProviderName(value: string | undefined, envName: string): ProviderName | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'gemini' || normalized === 'openai' || normalized === 'claude') {
    return normalized
  }
  throw makeError(
    `Configuracion invalida: ${envName}=${value}. Usa gemini, openai o claude.`,
    500,
    'misconfigured',
  )
}

function computeAttemptTimeoutMs(deadline: number, attemptsRemaining: number): number {
  const remainingBudget = deadline - Date.now()
  if (remainingBudget <= 0) {
    throw makeError('Se agotó el presupuesto total de tiempo del request.', 504, 'timeout', true)
  }

  const fairShare = Math.floor(remainingBudget / attemptsRemaining)
  return Math.max(
    1000,
    Math.min(remainingBudget, Math.max(MIN_PROVIDER_ATTEMPT_MS, fairShare)),
  )
}

function shouldUseTechnicalRetry(requestClass: RequestClass): boolean {
  return requestClass === 'chat_general' || requestClass === 'weekly_summary' || requestClass === 'import_extract'
}

async function fetchJsonOrThrow(res: Response): Promise<unknown> {
  const body = await res.json().catch(() => ({}))
  if (res.ok) return body
  const errorField = (body as { error?: unknown }).error
  const detail = typeof errorField === 'object' && errorField != null
    ? ((errorField as { message?: string }).message ?? `HTTP ${res.status}`)
    : ((body as { message?: string }).message ?? (typeof errorField === 'string' ? errorField : `HTTP ${res.status}`))
  if (res.status === 401 || res.status === 403) throw makeError(detail, res.status, 'unauthorized')
  if (res.status === 429) throw makeError(detail, 429, 'rate_limit', true)
  if (res.status === 400 && detail.toLowerCase().includes('api key')) throw makeError(detail, 401, 'unauthorized')
  if (res.status === 502 || res.status === 503 || res.status === 504) throw makeError(detail, res.status, 'timeout', true)
  throw makeError(detail, res.status, 'server_error')
}

async function callGemini(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<{ text: string; model: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [
          ...(req.conversation ?? []).map((message) => ({
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
    },
  )
  const data = await fetchJsonOrThrow(res) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw makeError('Gemini devolvió una respuesta vacía.', 500, 'parse_error')
  return { text, model }
}

async function callOpenAI(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<{ text: string; model: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...(req.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: req.userMessage },
      ],
    }),
  })
  const data = await fetchJsonOrThrow(res) as {
    choices?: Array<{ message?: { content?: string } }>
    model?: string
  }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw makeError('OpenAI devolvió una respuesta vacía.', 500, 'parse_error')
  return { text, model: data.model ?? model }
}

async function callClaude(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<{ text: string; model: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      system: req.systemPrompt,
      messages: [
        ...(req.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: req.userMessage },
      ],
    }),
  })
  const data = await fetchJsonOrThrow(res) as {
    content?: Array<{ type?: string; text?: string }>
    model?: string
  }
  const text = data.content?.find((item) => item.type === 'text')?.text
  if (!text) throw makeError('Claude devolvió una respuesta vacía.', 500, 'parse_error')
  return { text, model: data.model ?? model }
}

async function streamGemini(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<{ text: string; model: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [
          ...(req.conversation ?? []).map((message) => ({
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
    },
  )
  if (!res.ok || !res.body) {
    await fetchJsonOrThrow(res)
    throw makeError('Gemini streaming falló.', 500, 'server_error')
  }
  return readSseStream(res.body, model, (json) => {
    const data = JSON.parse(json) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }, onChunk)
}

async function streamOpenAI(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<{ text: string; model: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      stream: true,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...(req.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: req.userMessage },
      ],
    }),
  })
  if (!res.ok || !res.body) {
    await fetchJsonOrThrow(res)
    throw makeError('OpenAI streaming falló.', 500, 'server_error')
  }
  return readSseStream(res.body, model, (json) => {
    const data = JSON.parse(json) as { choices?: Array<{ delta?: { content?: string } }> }
    return data.choices?.[0]?.delta?.content ?? ''
  }, onChunk)
}

async function streamClaude(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<{ text: string; model: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      system: req.systemPrompt,
      stream: true,
      messages: [
        ...(req.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: req.userMessage },
      ],
    }),
  })
  if (!res.ok || !res.body) {
    await fetchJsonOrThrow(res)
    throw makeError('Claude streaming falló.', 500, 'server_error')
  }
  return readSseStream(res.body, model, (json) => {
    const data = JSON.parse(json) as { type?: string; delta?: { type?: string; text?: string } }
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
      return data.delta.text ?? ''
    }
    return ''
  }, onChunk)
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  model: string,
  pickChunk: (json: string) => string,
  onChunk: (chunk: string) => void,
): Promise<{ text: string; model: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (!json || json === '[DONE]') continue
      const chunk = pickChunk(json)
      if (chunk) {
        fullText += chunk
        onChunk(chunk)
      }
    }
  }

  if (!fullText) throw makeError('El provider devolvió una respuesta vacía.', 500, 'parse_error')
  return { text: fullText, model }
}

function resolveModel(provider: ProviderName): string {
  switch (provider) {
    case 'gemini':
      return process.env['GEMINI_MODEL'] ?? DEFAULT_MODELS.gemini
    case 'openai':
      return process.env['OPENAI_MODEL'] ?? DEFAULT_MODELS.openai
    case 'claude':
      return process.env['CLAUDE_MODEL'] ?? DEFAULT_MODELS.claude
  }
}

function resolveApiKey(provider: ProviderName): string {
  const key = provider === 'gemini'
    ? process.env['GEMINI_API_KEY']
    : provider === 'openai'
      ? process.env['OPENAI_API_KEY']
      : process.env['CLAUDE_API_KEY']
  if (!key) {
    throw makeError(`${provider.toUpperCase()} API key no configurada en el servidor.`, 500, 'misconfigured')
  }
  return key
}

async function invokeProvider(
  provider: ProviderName,
  req: CoachRequest,
  signal: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<{ text: string; provider: ProviderName; model: string }> {
  const model = resolveModel(provider)
  const key = resolveApiKey(provider)

  switch (provider) {
    case 'gemini': {
      const result = onChunk
        ? await streamGemini(req, key, model, signal, onChunk)
        : await callGemini(req, key, model, signal)
      return { ...result, provider }
    }
    case 'openai': {
      const result = onChunk
        ? await streamOpenAI(req, key, model, signal, onChunk)
        : await callOpenAI(req, key, model, signal)
      return { ...result, provider }
    }
    case 'claude': {
      const result = onChunk
        ? await streamClaude(req, key, model, signal, onChunk)
        : await callClaude(req, key, model, signal)
      return { ...result, provider }
    }
  }
}

async function executeWithPolicy(
  req: CoachRequest,
  onChunk?: (chunk: string) => void,
): Promise<ProviderExecutionResult> {
  const requestClass = normalizeRequestClass(req.requestClass)
  const traceId = req.traceId ?? `srv-${Date.now()}`
  const startedAt = Date.now()
  const primary = parseProviderName(process.env['AI_PROVIDER'] ?? 'gemini', 'AI_PROVIDER') ?? 'gemini'
  const fallback = parseProviderName(process.env['AI_FALLBACK_PROVIDER'], 'AI_FALLBACK_PROVIDER')
  const timeoutMs = REQUEST_TIMEOUTS[requestClass]
  const totalBudgetMs = Math.min(timeoutMs, MAX_FUNCTION_WALLCLOCK_MS)
  const deadline = startedAt + totalBudgetMs
  const allowTechnicalRetry = shouldUseTechnicalRetry(requestClass)
  const maxAttempts = allowTechnicalRetry
    ? (req.allowFallback && fallback && fallback !== primary ? 3 : 2)
    : 1
  let retryUsed = false
  let fallbackUsed = false
  let partialChunks = false

  const runAttempt = async (provider: ProviderName, attemptsRemaining: number) => {
    const attemptTimeoutMs = computeAttemptTimeoutMs(deadline, attemptsRemaining)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs)
    try {
      return await invokeProvider(
        provider,
        req,
        controller.signal,
        onChunk ? (chunk) => {
          partialChunks = true
          onChunk(chunk)
        } : undefined,
      )
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw makeError(`Timeout del proveedor ${provider} (${attemptTimeoutMs}ms).`, 504, 'timeout', true)
      }
      throw normalizeError(error)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  try {
    const first = await runAttempt(primary, maxAttempts)
    return {
      ...first,
      traceId,
      requestClass,
      retryUsed,
      fallbackUsed,
      durationMs: Date.now() - startedAt,
    }
  } catch (firstError) {
    const normalizedFirstError = normalizeError(firstError)
    if (!normalizedFirstError.retryable || partialChunks || maxAttempts <= 1) throw normalizedFirstError
    retryUsed = true
  }

  try {
    const second = await runAttempt(primary, maxAttempts - 1)
    return {
      ...second,
      traceId,
      requestClass,
      retryUsed,
      fallbackUsed,
      durationMs: Date.now() - startedAt,
    }
  } catch (retryError) {
    const normalizedRetryError = normalizeError(retryError)
    if (
      maxAttempts <= 2
      || !req.allowFallback
      || !fallback
      || fallback === primary
      || !normalizedRetryError.retryable
      || partialChunks
    ) {
      throw normalizedRetryError
    }
    fallbackUsed = true
  }

  const fallbackResult = await runAttempt(fallback!, 1)
  return {
    ...fallbackResult,
    traceId,
    requestClass,
    retryUsed,
    fallbackUsed,
    durationMs: Date.now() - startedAt,
  }
}

function streamResponse(req: CoachRequest): Response {
  const traceId = req.traceId ?? `srv-${Date.now()}`
  const requestClass = normalizeRequestClass(req.requestClass)
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const result = await executeWithPolicy(req, (chunk) => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'chunk', chunk, traceId })}\n`))
          })
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done', ...result })}\n`))
        } catch (error) {
          const normalized = normalizeError(error)
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: 'error',
            traceId,
            requestClass,
            error: normalized.message,
            errorCode: normalized.errorCode ?? 'unknown',
          })}\n`))
        } finally {
          controller.close()
        }
      })()
    },
  })

  return new Response(stream, { status: 200, headers: STREAM_HEADERS })
}

export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed', errorCode: 'unknown' })
  }

  let req: CoachRequest
  try {
    req = JSON.parse(event.body ?? '{}') as CoachRequest
  } catch {
    return json(400, { error: 'Invalid JSON body', errorCode: 'unknown' })
  }

  if (!req.systemPrompt || !req.userMessage) {
    return json(400, { error: 'Missing required fields: systemPrompt, userMessage', errorCode: 'unknown' })
  }

  if (req.stream) {
    return streamResponse(req)
  }

  try {
    const result = await executeWithPolicy(req)
    return json(200, result)
  } catch (error) {
    const normalized = normalizeError(error)
    return json(normalized.statusCode ?? 500, {
      error: normalized.message,
      errorCode: normalized.errorCode ?? 'unknown',
      traceId: req.traceId,
      requestClass: normalizeRequestClass(req.requestClass),
    })
  }
}
