import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

type ProviderName = 'gemini' | 'openai' | 'claude'
type RequestClass =
  | 'chat_general'
  | 'chat_action'
  | 'weekly_summary'
  | 'week_creator'
  | 'plan_builder_week'
  | 'plan_builder_pair'
  | 'import_extract'
  | 'coach_assistant_message'
type ErrorCode = 'timeout' | 'rate_limit' | 'parse_error' | 'server_error' | 'misconfigured' | 'unknown' | 'unauthorized'

interface CoachRequest {
  systemPrompt: string
  userMessage: string
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
  requestClass?: RequestClass
  traceId?: string
  maxTokens?: number
  temperature?: number
  responseMimeType?: 'application/json'
  responseSchema?: Record<string, unknown>
}

interface ProviderResult {
  text: string
  provider: ProviderName
  model: string
}

interface DevServerError extends Error {
  statusCode?: number
  errorCode?: ErrorCode
  retryable?: boolean
}

const FUNCTION_URL = '/.netlify/functions/coach'
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const DEFAULT_MODELS: Record<ProviderName, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-5-mini',
  claude: 'claude-sonnet-4-6',
}

export function devCoachProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'dev-coach-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(FUNCTION_URL, (req, res) => {
        void handleCoachRequest(req, res, env)
      })
    },
  }
}

async function handleCoachRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string>,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed', errorCode: 'unknown' })
    return
  }

  const startedAt = Date.now()
  try {
    const body = await readJsonBody(req)
    const coachRequest = validateRequest(body)
    const provider = resolveProvider(env, coachRequest.requestClass)
    const result = await callProvider(provider, coachRequest, env)

    sendJson(res, 200, {
      text: result.text,
      provider: result.provider,
      model: result.model,
      traceId: coachRequest.traceId,
      requestClass: coachRequest.requestClass ?? 'chat_general',
      durationMs: Date.now() - startedAt,
      retryUsed: false,
      fallbackUsed: false,
    })
  } catch (error) {
    const normalized = normalizeError(error)
    sendJson(res, normalized.statusCode ?? 500, {
      error: normalized.message,
      errorCode: normalized.errorCode ?? 'unknown',
      retryable: normalized.retryable ?? false,
    })
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let raw = ''

  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 1_000_000) throw makeError('Request too large', 413, 'server_error')
  }

  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw makeError('Invalid JSON body', 400, 'parse_error')
  }
}

function validateRequest(input: unknown): CoachRequest {
  if (!input || typeof input !== 'object') {
    throw makeError('Invalid JSON body', 400, 'parse_error')
  }

  const raw = input as Partial<CoachRequest>
  if (typeof raw.systemPrompt !== 'string' || raw.systemPrompt.trim().length === 0) {
    throw makeError('Missing required field: systemPrompt', 400, 'parse_error')
  }
  if (typeof raw.userMessage !== 'string' || raw.userMessage.trim().length === 0) {
    throw makeError('Missing required field: userMessage', 400, 'parse_error')
  }

  return {
    systemPrompt: raw.systemPrompt,
    userMessage: raw.userMessage,
    conversation: Array.isArray(raw.conversation) ? raw.conversation : undefined,
    requestClass: raw.requestClass,
    traceId: typeof raw.traceId === 'string' ? raw.traceId : `dev-${Date.now()}`,
    maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
    temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
    responseMimeType: raw.responseMimeType === 'application/json' ? raw.responseMimeType : undefined,
    responseSchema: raw.responseSchema && typeof raw.responseSchema === 'object' && !Array.isArray(raw.responseSchema)
      ? raw.responseSchema
      : undefined,
  }
}

async function callProvider(
  provider: ProviderName,
  request: CoachRequest,
  env: Record<string, string>,
): Promise<ProviderResult> {
  const apiKey = resolveApiKey(provider, env)
  const model = resolveModel(provider, env, request.requestClass)

  switch (provider) {
    case 'gemini':
      return callGemini(request, apiKey, model)
    case 'openai':
      return callOpenAI(request, apiKey, model)
    case 'claude':
      return callClaude(request, apiKey, model)
  }
}

async function callGemini(request: CoachRequest, apiKey: string, model: string): Promise<ProviderResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [
        ...(request.conversation ?? []).map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        { role: 'user', parts: [{ text: request.userMessage }] },
      ],
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.7,
        ...(request.responseMimeType ? { responseMimeType: request.responseMimeType } : {}),
        ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
      },
    }),
  })
  const data = await fetchJsonOrThrow(res) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw makeError('Gemini devolvió una respuesta vacía.', 500, 'parse_error')
  return { text, provider: 'gemini', model }
}

function normalizeJsonSchemaForOpenAI(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchemaForOpenAI)
  if (!value || typeof value !== 'object') return value

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input)) {
    if (key === 'type' && typeof child === 'string') {
      output[key] = child.toLowerCase()
      continue
    }
    output[key] = normalizeJsonSchemaForOpenAI(child)
  }
  return output
}

function buildOpenAIResponseFormat(request: CoachRequest): Record<string, unknown> | undefined {
  if (request.responseSchema) {
    return {
      type: 'json_schema',
      json_schema: {
        name: request.requestClass ?? 'chat_general',
        strict: false,
        schema: normalizeJsonSchemaForOpenAI(request.responseSchema),
      },
    }
  }
  if (request.responseMimeType === 'application/json') return { type: 'json_object' }
  return undefined
}

function supportsOpenAITemperature(model: string): boolean {
  return !model.toLowerCase().startsWith('gpt-5')
}

async function callOpenAI(request: CoachRequest, apiKey: string, model: string): Promise<ProviderResult> {
  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: request.maxTokens ?? 1024,
    messages: [
      { role: 'system', content: request.systemPrompt },
      ...(request.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: request.userMessage },
    ],
  }
  if (supportsOpenAITemperature(model)) {
    body.temperature = request.temperature ?? 0.7
  }
  const responseFormat = buildOpenAIResponseFormat(request)
  if (responseFormat) body.response_format = responseFormat

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  const data = await fetchJsonOrThrow(res) as { choices?: Array<{ message?: { content?: string } }>; model?: string }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw makeError('OpenAI devolvió una respuesta vacía.', 500, 'parse_error')
  return { text, provider: 'openai', model: data.model ?? model }
}

async function callClaude(request: CoachRequest, apiKey: string, model: string): Promise<ProviderResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.7,
      system: request.systemPrompt,
      messages: [
        ...(request.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: request.userMessage },
      ],
    }),
  })
  const data = await fetchJsonOrThrow(res) as { content?: Array<{ type?: string; text?: string }>; model?: string }
  const text = data.content?.find((item) => item.type === 'text')?.text
  if (!text) throw makeError('Claude devolvió una respuesta vacía.', 500, 'parse_error')
  return { text, provider: 'claude', model: data.model ?? model }
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
  if (res.status === 502 || res.status === 503 || res.status === 504) throw makeError(detail, res.status, 'timeout', true)
  throw makeError(detail, res.status, 'server_error')
}

function resolveProvider(env: Record<string, string>, requestClass: RequestClass | undefined): ProviderName {
  const classKey = requestClass ? `AI_PROVIDER_${requestClass.toUpperCase()}` : undefined
  const value = ((classKey ? env[classKey] : undefined) ?? env.AI_PROVIDER ?? 'gemini').toLowerCase()
  if (value === 'openai' || value === 'claude' || value === 'gemini') return value
  return 'gemini'
}

function resolveModel(provider: ProviderName, env: Record<string, string>, requestClass?: RequestClass): string {
  const classKey = requestClass ? `${provider.toUpperCase()}_MODEL_${requestClass.toUpperCase()}` : undefined
  const classModel = classKey ? env[classKey]?.trim() : undefined
  if (classModel) return classModel

  switch (provider) {
    case 'gemini':
      return env.GEMINI_MODEL || DEFAULT_MODELS.gemini
    case 'openai':
      return env.OPENAI_MODEL || DEFAULT_MODELS.openai
    case 'claude':
      return env.CLAUDE_MODEL || DEFAULT_MODELS.claude
  }
}

function resolveApiKey(provider: ProviderName, env: Record<string, string>): string {
  const key = provider === 'gemini'
    ? env.GEMINI_API_KEY
    : provider === 'openai'
      ? env.OPENAI_API_KEY
      : env.CLAUDE_API_KEY

  if (!key) {
    throw makeError(`${provider.toUpperCase()} API key no configurada en .env.local.`, 500, 'misconfigured')
  }
  return key
}

function makeError(message: string, statusCode: number, errorCode: ErrorCode, retryable = false): DevServerError {
  const error = new Error(message) as DevServerError
  error.statusCode = statusCode
  error.errorCode = errorCode
  error.retryable = retryable
  return error
}

function normalizeError(error: unknown): DevServerError {
  if (error instanceof Error) {
    const candidate = error as DevServerError
    if (candidate.statusCode) return candidate
    return makeError(candidate.message, 500, 'server_error')
  }
  return makeError('Error desconocido en dev coach proxy.', 500, 'unknown')
}

function sendJson(res: ServerResponse, statusCode: number, body: object): void {
  res.statusCode = statusCode
  for (const [key, value] of Object.entries(JSON_HEADERS)) {
    res.setHeader(key, value)
  }
  res.end(JSON.stringify(body))
}
