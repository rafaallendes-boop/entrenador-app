/**
 * Netlify Function: coach
 *
 * Secure proxy between the PWA frontend and the AI provider (Gemini / OpenAI / Claude).
 * Adds request-class policies, technical retry/fallback, trace propagation and
 * streaming NDJSON when the client requests chunks.
 */

interface LambdaEvent {
  httpMethod: string
  headers?: Record<string, string | undefined>
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
  | 'week_creator'
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

interface RequestValidationResult {
  ok: boolean
  req?: CoachRequest
  error?: string
}

interface AuthContext {
  userId: string
  rateLimitKey: string
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
  week_creator: 30000,
  plan_builder_week: 30000,
  plan_builder_pair: 45000,
  import_extract: 20000,
}
const REQUEST_MAX_TOKENS: Record<RequestClass, number> = {
  chat_general: 2400,
  chat_action: 4200,
  weekly_summary: 1600,
  week_creator: 3500,
  plan_builder_week: 3500,
  plan_builder_pair: 5500,
  import_extract: 2000,
}
const SYSTEM_PROMPT_MAX_CHARS: Record<RequestClass, number> = {
  chat_general: 24000,
  chat_action: 36000,
  weekly_summary: 18000,
  week_creator: 36000,
  plan_builder_week: 42000,
  plan_builder_pair: 64000,
  import_extract: 18000,
}
const USER_MESSAGE_MAX_CHARS = 8000
const CONVERSATION_MAX_MESSAGES = 30
const CONVERSATION_MESSAGE_MAX_CHARS = 4000
const CONVERSATION_TOTAL_MAX_CHARS = 30000
const TRACE_ID_MAX_CHARS = 160
// Netlify synchronous functions currently allow 60s; keep a small buffer for response finalization.
const MAX_FUNCTION_WALLCLOCK_MS = 55000
const MIN_PROVIDER_ATTEMPT_MS = 4000
const AUTH_REQUIRED = process.env['COACH_PROXY_REQUIRE_AUTH'] !== 'false'
const RATE_LIMIT_WINDOW_MS = parsePositiveInteger(process.env['COACH_RATE_LIMIT_WINDOW_MS'], 60_000)
const RATE_LIMIT_MAX = parsePositiveInteger(process.env['COACH_RATE_LIMIT_MAX'], 20)

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
}
const rateLimitBuckets = new Map<string, { windowStart: number; count: number }>()

function json(statusCode: number, body: object): LambdaResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeRequestClass(value: unknown): RequestClass {
  switch (value) {
    case 'chat_action':
    case 'weekly_summary':
    case 'week_creator':
    case 'plan_builder_week':
    case 'plan_builder_pair':
    case 'import_extract':
      return value
    default:
      return 'chat_general'
  }
}

function isKnownRequestClass(value: unknown): value is RequestClass {
  return value === 'chat_general'
    || value === 'chat_action'
    || value === 'weekly_summary'
    || value === 'week_creator'
    || value === 'plan_builder_week'
    || value === 'plan_builder_pair'
    || value === 'import_extract'
}

function validateCoachRequest(input: unknown): RequestValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Invalid JSON body' }
  }

  const raw = input as Partial<CoachRequest>
  if (raw.requestClass != null && !isKnownRequestClass(raw.requestClass)) {
    return { ok: false, error: 'Invalid requestClass' }
  }
  const requestClass = normalizeRequestClass(raw.requestClass)

  if (typeof raw.systemPrompt !== 'string' || raw.systemPrompt.trim().length === 0) {
    return { ok: false, error: 'Missing required field: systemPrompt' }
  }
  if (raw.systemPrompt.length > SYSTEM_PROMPT_MAX_CHARS[requestClass]) {
    return { ok: false, error: `systemPrompt too long for ${requestClass}` }
  }

  if (typeof raw.userMessage !== 'string' || raw.userMessage.trim().length === 0) {
    return { ok: false, error: 'Missing required field: userMessage' }
  }
  if (raw.userMessage.length > USER_MESSAGE_MAX_CHARS) {
    return { ok: false, error: 'userMessage too long' }
  }

  if (raw.conversation != null) {
    if (!Array.isArray(raw.conversation)) {
      return { ok: false, error: 'conversation must be an array' }
    }
    if (raw.conversation.length > CONVERSATION_MAX_MESSAGES) {
      return { ok: false, error: 'conversation too long' }
    }

    let totalChars = 0
    for (const message of raw.conversation) {
      if (
        !message
        || typeof message !== 'object'
        || !('role' in message)
        || !('content' in message)
      ) {
        return { ok: false, error: 'conversation contains invalid messages' }
      }
      const candidate = message as { role?: unknown; content?: unknown }
      if (candidate.role !== 'user' && candidate.role !== 'assistant') {
        return { ok: false, error: 'conversation contains invalid roles' }
      }
      if (typeof candidate.content !== 'string') {
        return { ok: false, error: 'conversation contains invalid content' }
      }
      if (candidate.content.length > CONVERSATION_MESSAGE_MAX_CHARS) {
        return { ok: false, error: 'conversation message too long' }
      }
      totalChars += candidate.content.length
    }
    if (totalChars > CONVERSATION_TOTAL_MAX_CHARS) {
      return { ok: false, error: 'conversation total too long' }
    }
  }

  if (raw.maxTokens != null) {
    if (!Number.isInteger(raw.maxTokens) || raw.maxTokens < 1 || raw.maxTokens > REQUEST_MAX_TOKENS[requestClass]) {
      return { ok: false, error: `maxTokens out of range for ${requestClass}` }
    }
  }

  if (raw.temperature != null) {
    if (typeof raw.temperature !== 'number' || !Number.isFinite(raw.temperature) || raw.temperature < 0 || raw.temperature > 1) {
      return { ok: false, error: 'temperature out of range' }
    }
  }

  if (raw.traceId != null && (typeof raw.traceId !== 'string' || raw.traceId.length > TRACE_ID_MAX_CHARS)) {
    return { ok: false, error: 'traceId invalid' }
  }

  if (raw.allowFallback != null && typeof raw.allowFallback !== 'boolean') {
    return { ok: false, error: 'allowFallback must be boolean' }
  }
  if (raw.stream != null && typeof raw.stream !== 'boolean') {
    return { ok: false, error: 'stream must be boolean' }
  }

  return {
    ok: true,
    req: {
      systemPrompt: raw.systemPrompt,
      userMessage: raw.userMessage,
      conversation: raw.conversation,
      requestClass,
      traceId: raw.traceId,
      maxTokens: raw.maxTokens,
      temperature: raw.temperature,
      allowFallback: raw.allowFallback,
      stream: raw.stream,
    },
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

function getHeader(headers: LambdaEvent['headers'], name: string): string | undefined {
  if (!headers) return undefined
  const direct = headers[name] ?? headers[name.toLowerCase()]
  if (direct) return direct
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return found?.[1]
}

function getClientIp(event: LambdaEvent): string {
  const forwardedFor = getHeader(event.headers, 'x-forwarded-for')
  const forwardedIp = forwardedFor?.split(',')[0]?.trim()
  return getHeader(event.headers, 'x-nf-client-connection-ip')
    ?? getHeader(event.headers, 'client-ip')
    ?? forwardedIp
    ?? 'unknown'
}

function getBearerToken(event: LambdaEvent): string | undefined {
  const authHeader = getHeader(event.headers, 'authorization')?.trim()
  if (!authHeader) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(authHeader)
  return match?.[1]?.trim()
}

function resolveSupabaseAuthConfig(): { url: string; anonKey: string } {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!url || !anonKey) {
    throw makeError('Autenticación del coach no configurada en el servidor.', 500, 'misconfigured')
  }
  return { url, anonKey }
}

async function resolveAuthContext(event: LambdaEvent): Promise<AuthContext> {
  const ip = getClientIp(event)
  if (!AUTH_REQUIRED) {
    return { userId: 'anonymous', rateLimitKey: `ip:${ip}` }
  }

  const token = getBearerToken(event)
  if (!token) {
    throw makeError('Sesión requerida para usar el coach.', 401, 'unauthorized')
  }

  const { url, anonKey } = resolveSupabaseAuthConfig()
  const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  })
  if (!res.ok) {
    throw makeError('Sesión inválida o expirada.', 401, 'unauthorized')
  }

  const user = await res.json().catch(() => ({})) as { id?: unknown; sub?: unknown }
  const userId = typeof user.id === 'string'
    ? user.id
    : typeof user.sub === 'string'
      ? user.sub
      : undefined
  if (!userId) {
    throw makeError('Sesión inválida o expirada.', 401, 'unauthorized')
  }

  return { userId, rateLimitKey: `user:${userId}` }
}

function enforceRateLimit(auth: AuthContext): void {
  const now = Date.now()
  const current = rateLimitBuckets.get(auth.rateLimitKey)
  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(auth.rateLimitKey, { windowStart: now, count: 1 })
    return
  }

  current.count += 1
  if (current.count > RATE_LIMIT_MAX) {
    throw makeError('Demasiadas solicitudes al coach. Espera un momento e intenta de nuevo.', 429, 'rate_limit', true)
  }
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
      try {
        const chunk = pickChunk(json)
        if (chunk) {
          fullText += chunk
          onChunk(chunk)
        }
      } catch {
        // Skip malformed SSE chunk — provider sent incomplete JSON fragment.
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
        let sentAnyChunk = false
        try {
          const result = await executeWithPolicy(req, (chunk) => {
            sentAnyChunk = true
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'chunk', chunk, traceId })}\n`))
          })
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done', ...result })}\n`))
        } catch (error) {
          const normalized = normalizeError(error)
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: 'error',
            truncated: sentAnyChunk,
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

  let body: unknown
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body', errorCode: 'unknown' })
  }

  const validation = validateCoachRequest(body)
  if (!validation.ok || !validation.req) {
    return json(400, { error: validation.error ?? 'Invalid request body', errorCode: 'unknown' })
  }
  const req = validation.req

  try {
    const auth = await resolveAuthContext(event)
    enforceRateLimit(auth)
  } catch (error) {
    const normalized = normalizeError(error)
    return json(normalized.statusCode ?? 500, {
      error: normalized.message,
      errorCode: normalized.errorCode ?? 'unknown',
      traceId: req.traceId,
      requestClass: normalizeRequestClass(req.requestClass),
    })
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
