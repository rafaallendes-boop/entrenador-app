/**
 * Netlify Function: coach
 *
 * Secure proxy between the PWA frontend and the AI provider (Gemini / OpenAI / Claude).
 * Adds request-class policies, technical retry/fallback, trace propagation and
 * streaming NDJSON when the client requests chunks.
 */

import { stream, type HandlerEvent, type StreamingResponse } from '@netlify/functions'
import {
  normalizeJsonSchemaForGemini,
  normalizeJsonSchemaForStandardProvider,
} from '../../src/services/ai/jsonSchema'
import { mapGeminiUsage, mapOpenAIUsage } from '../../src/services/ai/providerUsage'
import { CORS_HEADERS, corsPreflight } from './_shared/cors'

export { mapGeminiUsage, mapOpenAIUsage } from '../../src/services/ai/providerUsage'

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
type ResponseSchema = Record<string, unknown>

interface CoachRequest {
  systemPrompt: string
  userMessage: string
  conversation?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  requestClass?: RequestClass
  traceId?: string
  generationId?: string
  logicalAttempt?: number
  maxTokens?: number
  temperature?: number
  responseMimeType?: 'application/json'
  responseSchema?: ResponseSchema
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
  finishReason?: string
  traceId: string
  generationId?: string
  requestClass: RequestClass
  retryUsed: boolean
  fallbackUsed: boolean
  durationMs: number
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

interface ProviderCallResult {
  text: string
  model: string
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

interface ProviderUsage {
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

export function parseClaudeStreamEvent(json: string): {
  chunk: string
  finishReason?: string
  usage?: ProviderUsage
} {
  const data = JSON.parse(json) as {
    type?: string
    delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
    message?: {
      stop_reason?: string
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
    }
    usage?: { output_tokens?: number }
  }
  const finishReason = data.delta?.stop_reason ?? data.message?.stop_reason
  const usage: ProviderUsage | undefined = data.type === 'message_start'
    ? {
        promptTokens: data.message?.usage?.input_tokens,
        cacheCreationInputTokens: data.message?.usage?.cache_creation_input_tokens,
        cacheReadInputTokens: data.message?.usage?.cache_read_input_tokens,
      }
    : data.type === 'message_delta'
      ? { completionTokens: data.usage?.output_tokens }
      : undefined
  const chunk = data.type === 'content_block_delta'
    ? data.delta?.type === 'text_delta'
      ? data.delta.text ?? ''
      : data.delta?.type === 'input_json_delta'
        ? data.delta.partial_json ?? ''
        : ''
    : ''
  return { chunk, finishReason, usage }
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
  openai: 'gpt-5-mini',
  claude: 'claude-sonnet-4-6',
}

// Timeouts aligned with client-side requestPolicy.ts.
const REQUEST_TIMEOUTS: Record<RequestClass, number> = {
  chat_general: 15000,
  chat_action: 18000,
  weekly_summary: 18000,
  week_creator: 23000,
  plan_builder_week: 22000,
  plan_builder_pair: 23000,
  import_extract: 18000,
}
const REQUEST_MAX_TOKENS: Record<RequestClass, number> = {
  chat_general: 2400,
  chat_action: 4200,
  weekly_summary: 1600,
  week_creator: 8000,
  plan_builder_week: 3500,
  plan_builder_pair: 4200,
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
const CONVERSATION_MESSAGE_MAX_CHARS = 4000
const TRACE_ID_MAX_CHARS = 160
const GENERATION_ID_MAX_CHARS = 160
const RESPONSE_SCHEMA_MAX_CHARS = 20000
// Netlify Pro synchronous functions cut off at 26s; keep 2s for response finalization.
const MAX_FUNCTION_WALLCLOCK_MS = 24000
const MIN_PROVIDER_ATTEMPT_MS = 4000
const AUTH_REQUIRED = process.env['COACH_PROXY_REQUIRE_AUTH'] !== 'false'
const RATE_LIMIT_WINDOW_MS = parsePositiveInteger(process.env['COACH_RATE_LIMIT_WINDOW_MS'], 60_000)
const RATE_LIMIT_MAX = parsePositiveInteger(process.env['COACH_RATE_LIMIT_MAX'], 20)

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS }
const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  ...CORS_HEADERS,
}
const rateLimitBuckets = new Map<string, { windowStart: number; count: number }>()

function json(statusCode: number, body: object): StreamingResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export function trimConversationHistory(
  conversation: ConversationMessage[] | undefined,
  maxMessages = 8,
  maxChars = 8000,
): ConversationMessage[] {
  if (!conversation || conversation.length === 0) return []

  const limit = maxMessages % 2 === 0 ? maxMessages : maxMessages - 1
  const trimmed = conversation.slice(-limit)

  let totalLength = 0
  const result: ConversationMessage[] = []

  for (let i = trimmed.length - 1; i >= 0; i--) {
    const msg = trimmed[i]
    if (totalLength + msg.content.length > maxChars) {
      break
    }
    totalLength += msg.content.length
    result.unshift(msg)
  }

  return result
}

function getISOForWeekdayOrRelative(dayKeyword: string): string {
  const now = new Date()
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))

  if (dayKeyword === 'hoy') {
    return today.toISOString().split('T')[0]
  }
  if (dayKeyword === 'manana') {
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    return tomorrow.toISOString().split('T')[0]
  }

  const dayLabels = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
  const targetIndex = dayLabels.indexOf(dayKeyword.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
  if (targetIndex === -1) return ''

  const currentDay = today.getUTCDay()
  const currentWeekdayOffset = currentDay === 0 ? 6 : currentDay - 1

  const diff = targetIndex - currentWeekdayOffset
  const targetDate = new Date(today.getTime() + diff * 24 * 60 * 60 * 1000)

  return targetDate.toISOString().split('T')[0]
}

export interface DeterministicAction {
  type: string
  reason: string
  sessionId?: string
  targetDate?: string
  [key: string]: unknown
}

export function tryDeterministicBypass(userMessage: string): DeterministicAction[] | null {
  const msg = userMessage.trim().toLowerCase()
  const normalized = msg.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const daysRegexStr = '(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)'

  // Caso 1: Insertar descanso
  const restPatterns = [
    new RegExp(`(?:descanso|recuperacion|libre|off)\\s+(?:el\\s+|de\\s+|este\\s+|para\\s+el\\s+)?${daysRegexStr}`, 'i'),
    new RegExp(`${daysRegexStr}\\s+(?:de\\s+)?(?:descanso|recuperacion|libre|off)`, 'i'),
    new RegExp(`(?:pon|marca|inserta|agrega|deja|quiero)\\s+(?:un\\s+)?(?:descanso|recuperacion|libre|off)\\s*(?:el\\s+|para\\s+el\\s+|este\\s+)?${daysRegexStr}?`, 'i')
  ]

  for (const pattern of restPatterns) {
    const match = normalized.match(pattern)
    if (match) {
      const day = match[1] || 'hoy'
      const targetDate = getISOForWeekdayOrRelative(day)
      return [{
        type: 'insert_recovery',
        reason: 'Solicitado por el usuario mediante atajo directo de descanso.',
        targetDate: targetDate || '2026-01-01',
      }]
    }
  }

  // Caso 2: Borrar sesión
  const deletePatterns = [
    new RegExp(`(?:borra|elimina|quita|suspende)\\s+(?:el\\s+)?(?:entreno|entrenamiento|sesion)\\s+(?:del\\s+|de\\s+|este\\s+)?${daysRegexStr}`, 'i'),
    new RegExp(`${daysRegexStr}\\s+(?:no\\s+entreno|sin\\s+entreno|eliminar\\s+entreno|borrar\\s+entreno)`, 'i')
  ]

  for (const pattern of deletePatterns) {
    const match = normalized.match(pattern)
    if (match) {
      const day = match[1]
      const targetDate = getISOForWeekdayOrRelative(day)
      return [{
        type: 'delete_session',
        reason: 'Eliminación directa solicitada por el usuario.',
        sessionId: 'placeholder-id',
        targetDate: targetDate || '2026-01-01',
      }]
    }
  }

  return null
}

export function shouldUseDeterministicBypass(requestClass: RequestClass): boolean {
  return requestClass === 'chat_action'
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

  let processedConversation: ConversationMessage[] | undefined
  if (raw.conversation != null) {
    if (!Array.isArray(raw.conversation)) {
      return { ok: false, error: 'conversation must be an array' }
    }

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
    }

    processedConversation = trimConversationHistory(raw.conversation as ConversationMessage[], 8, 8000)
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

  if (raw.responseMimeType != null && raw.responseMimeType !== 'application/json') {
    return { ok: false, error: 'responseMimeType unsupported' }
  }

  if (raw.responseSchema != null) {
    if (!raw.responseSchema || typeof raw.responseSchema !== 'object' || Array.isArray(raw.responseSchema)) {
      return { ok: false, error: 'responseSchema must be an object' }
    }
    if (JSON.stringify(raw.responseSchema).length > RESPONSE_SCHEMA_MAX_CHARS) {
      return { ok: false, error: 'responseSchema too long' }
    }
  }

  if (raw.traceId != null && (typeof raw.traceId !== 'string' || raw.traceId.length > TRACE_ID_MAX_CHARS)) {
    return { ok: false, error: 'traceId invalid' }
  }
  if (raw.generationId != null && (typeof raw.generationId !== 'string' || raw.generationId.length > GENERATION_ID_MAX_CHARS)) {
    return { ok: false, error: 'generationId invalid' }
  }
  if (raw.logicalAttempt != null && (!Number.isInteger(raw.logicalAttempt) || raw.logicalAttempt < 1 || raw.logicalAttempt > 10)) {
    return { ok: false, error: 'logicalAttempt invalid' }
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
      conversation: processedConversation,
      requestClass,
      traceId: raw.traceId,
      generationId: raw.generationId,
      logicalAttempt: raw.logicalAttempt,
      maxTokens: raw.maxTokens,
      temperature: raw.temperature,
      responseMimeType: raw.responseMimeType,
      responseSchema: raw.responseSchema,
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

export function providerEnvKey(prefix: 'AI_PROVIDER' | 'AI_FALLBACK_PROVIDER', requestClass: RequestClass): string {
  return `${prefix}_${requestClass.toUpperCase()}`
}

export function resolvePrimaryProvider(requestClass: RequestClass): ProviderName {
  const classKey = providerEnvKey('AI_PROVIDER', requestClass)
  return parseProviderName(process.env[classKey] ?? process.env['AI_PROVIDER'] ?? 'gemini', classKey) ?? 'gemini'
}

export function resolveFallbackProvider(requestClass: RequestClass): ProviderName | undefined {
  const classKey = providerEnvKey('AI_FALLBACK_PROVIDER', requestClass)
  return parseProviderName(process.env[classKey] ?? process.env['AI_FALLBACK_PROVIDER'], classKey)
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

const RETRY_BACKOFF_MS = 600

function logCoachAttempt(payload: {
  traceId: string
  generationId?: string
  logicalAttempt?: number
  requestClass: RequestClass
  attempt: number
  outcome: 'ok' | 'error'
  provider: ProviderName
  attemptTimeoutMs: number
  durationMs: number
  model?: string
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  responseCharCount?: number
  systemPromptCharCount?: number
  userPromptCharCount?: number
  responseSchemaCharCount?: number
  maxTokens?: number
  errorCode?: TechnicalErrorCode
  message?: string
}): void {
  if (typeof console === 'undefined' || typeof console.info !== 'function') return
  try {
    console.info(JSON.stringify({ event: 'coach.attempt', ...payload }))
  } catch {
    /* noop */
  }
}

function logCoachRequest(payload: {
  traceId: string
  generationId?: string
  logicalAttempt?: number
  requestClass: RequestClass
  outcome: 'ok' | 'error'
  provider?: ProviderName
  model?: string
  authDurationMs: number
  providerDurationMs?: number
  serverDurationMs: number
  retryUsed?: boolean
  fallbackUsed?: boolean
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  responseCharCount?: number
  finishReason?: string
  errorCode?: TechnicalErrorCode
}): void {
  if (typeof console === 'undefined' || typeof console.info !== 'function') return
  try {
    console.info(JSON.stringify({ event: 'coach.request.completed', ...payload }))
  } catch {
    /* noop */
  }
}

function getHeader(headers: HandlerEvent['headers'], name: string): string | undefined {
  if (!headers) return undefined
  const direct = headers[name] ?? headers[name.toLowerCase()]
  if (direct) return direct
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return found?.[1]
}

function getClientIp(event: HandlerEvent): string {
  const forwardedFor = getHeader(event.headers, 'x-forwarded-for')
  const forwardedIp = forwardedFor?.split(',')[0]?.trim()
  return getHeader(event.headers, 'x-nf-client-connection-ip')
    ?? getHeader(event.headers, 'client-ip')
    ?? forwardedIp
    ?? 'unknown'
}

function getBearerToken(event: HandlerEvent): string | undefined {
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

async function resolveAuthContext(event: HandlerEvent): Promise<AuthContext> {
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

function supportsGeminiThinkingConfig(model: string): boolean {
  return /gemini-2\.5-(flash|flash-lite)/i.test(model)
}

function getGeminiThinkingBudget(requestClass: RequestClass): number {
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
      return 0
  }
}

function buildGeminiGenerationConfig(req: CoachRequest, model: string): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? 0.7,
  }
  if (supportsGeminiThinkingConfig(model)) {
    generationConfig.thinkingConfig = {
      thinkingBudget: getGeminiThinkingBudget(normalizeRequestClass(req.requestClass)),
    }
  }
  if (req.responseMimeType) generationConfig.responseMimeType = req.responseMimeType
  if (req.responseSchema) {
    generationConfig.responseSchema = normalizeJsonSchemaForGemini(req.responseSchema)
  }
  return generationConfig
}

function buildOpenAIResponseFormat(req: CoachRequest): Record<string, unknown> | undefined {
  const requestClass = normalizeRequestClass(req.requestClass)
  if (req.responseSchema) {
    return {
      type: 'json_schema',
      json_schema: {
        name: requestClass,
        strict: false,
        schema: normalizeJsonSchemaForStandardProvider(req.responseSchema),
      },
    }
  }
  if (req.responseMimeType === 'application/json') {
    return { type: 'json_object' }
  }
  return undefined
}

function supportsOpenAITemperature(model: string): boolean {
  return !model.toLowerCase().startsWith('gpt-5')
}

function supportsOpenAIReasoningEffort(model: string): boolean {
  return model.toLowerCase().startsWith('gpt-5')
}

// Análogo a getGeminiThinkingBudget: todas las clases corren bajo el techo
// síncrono de 26s, así que el esfuerzo alto nunca aplica aquí.
function getOpenAIReasoningEffort(requestClass: RequestClass): 'minimal' | 'low' {
  switch (requestClass) {
    case 'chat_action':
    case 'week_creator':
    case 'plan_builder_week':
    case 'plan_builder_pair':
      return 'low'
    case 'chat_general':
    case 'weekly_summary':
    case 'import_extract':
      return 'minimal'
  }
}

export function buildOpenAIBody(req: CoachRequest, model: string, streamOutput = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: req.maxTokens ?? 1024,
    messages: [
      { role: 'system', content: req.systemPrompt },
      ...(req.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: req.userMessage },
    ],
  }
  if (supportsOpenAITemperature(model)) {
    body.temperature = req.temperature ?? 0.7
  }
  if (supportsOpenAIReasoningEffort(model)) {
    body.reasoning_effort = getOpenAIReasoningEffort(normalizeRequestClass(req.requestClass))
  }
  const responseFormat = buildOpenAIResponseFormat(req)
  if (responseFormat) body.response_format = responseFormat
  if (streamOutput) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  return body
}

// Claude no expone un `response_format` JSON como OpenAI/Gemini. La forma soportada
// de forzar salida estructurada es declarar una tool con `input_schema` y obligar al
// modelo a invocarla con tool_choice. El `input` del bloque tool_use es el JSON final,
// equivalente a lo que devuelven OpenAI/Gemini con responseSchema.
const CLAUDE_STRUCTURED_TOOL_NAME = 'emit_structured_result'

function buildClaudeToolConfig(req: CoachRequest): Record<string, unknown> | undefined {
  if (!req.responseSchema) return undefined
  return {
    tools: [
      {
        name: CLAUDE_STRUCTURED_TOOL_NAME,
        description: 'Devuelve el resultado estructurado solicitado siguiendo el schema exacto.',
        input_schema: normalizeJsonSchemaForStandardProvider(req.responseSchema),
      },
    ],
    tool_choice: { type: 'tool', name: CLAUDE_STRUCTURED_TOOL_NAME },
  }
}

export function buildClaudeBody(req: CoachRequest, model: string, streamOutput = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? 0.7,
    system: req.systemPrompt,
    messages: [
      ...(req.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: req.userMessage },
    ],
  }
  const toolConfig = buildClaudeToolConfig(req)
  if (toolConfig) Object.assign(body, toolConfig)
  if (streamOutput) body.stream = true
  return body
}

// Extrae el texto de una respuesta Claude no-streaming: prioriza el bloque tool_use
// (salida estructurada) y cae al bloque de texto plano para requests sin schema.
function extractClaudeText(content: Array<{ type?: string; text?: string; input?: unknown }> | undefined): string | undefined {
  const toolBlock = content?.find((item) => item.type === 'tool_use')
  if (toolBlock && toolBlock.input !== undefined) {
    return JSON.stringify(toolBlock.input)
  }
  return content?.find((item) => item.type === 'text')?.text
}

async function callGemini(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<ProviderCallResult> {
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
        generationConfig: buildGeminiGenerationConfig(req, model),
      }),
    },
  )
  const data = await fetchJsonOrThrow(res) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      thoughtsTokenCount?: number
      cachedContentTokenCount?: number
    }
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw makeError('Gemini devolvió una respuesta vacía.', 500, 'parse_error')
  return {
    text,
    model,
    finishReason: data.candidates?.[0]?.finishReason,
    ...mapGeminiUsage(data.usageMetadata),
  }
}

async function callOpenAI(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<ProviderCallResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify(buildOpenAIBody(req, model)),
  })
  const data = await fetchJsonOrThrow(res) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    model?: string
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_tokens_details?: { cached_tokens?: number }
      completion_tokens_details?: { reasoning_tokens?: number }
    }
  }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw makeError('OpenAI devolvió una respuesta vacía.', 500, 'parse_error')
  return {
    text,
    model: data.model ?? model,
    finishReason: data.choices?.[0]?.finish_reason,
    ...mapOpenAIUsage(data.usage),
  }
}

async function callClaude(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<ProviderCallResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify(buildClaudeBody(req, model)),
  })
  const data = await fetchJsonOrThrow(res) as {
    content?: Array<{ type?: string; text?: string; input?: unknown }>
    model?: string
    stop_reason?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  const text = extractClaudeText(data.content)
  if (!text) throw makeError('Claude devolvió una respuesta vacía.', 500, 'parse_error')
  return {
    text,
    model: data.model ?? model,
    finishReason: data.stop_reason,
    promptTokens: data.usage?.input_tokens,
    completionTokens: data.usage?.output_tokens,
    cacheCreationInputTokens: data.usage?.cache_creation_input_tokens,
    cacheReadInputTokens: data.usage?.cache_read_input_tokens,
  }
}

async function streamGemini(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<ProviderCallResult> {
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
        generationConfig: buildGeminiGenerationConfig(req, model),
      }),
    },
  )
  if (!res.ok || !res.body) {
    await fetchJsonOrThrow(res)
    throw makeError('Gemini streaming falló.', 500, 'server_error')
  }
  return readSseStream(res.body, model, (json) => {
    const data = JSON.parse(json) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        thoughtsTokenCount?: number
        cachedContentTokenCount?: number
      }
    }
    const candidate = data.candidates?.[0]
    return {
      chunk: candidate?.content?.parts?.[0]?.text ?? '',
      finishReason: candidate?.finishReason,
      usage: mapGeminiUsage(data.usageMetadata),
    }
  }, onChunk)
}

async function streamOpenAI(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<ProviderCallResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify(buildOpenAIBody(req, model, true)),
  })
  if (!res.ok || !res.body) {
    await fetchJsonOrThrow(res)
    throw makeError('OpenAI streaming falló.', 500, 'server_error')
  }
  return readSseStream(res.body, model, (json) => {
    const data = JSON.parse(json) as {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    }
    const choice = data.choices?.[0]
    return {
      chunk: choice?.delta?.content ?? '',
      finishReason: choice?.finish_reason,
      usage: mapOpenAIUsage(data.usage),
    }
  }, onChunk)
}

async function streamClaude(
  req: CoachRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<ProviderCallResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify(buildClaudeBody(req, model, true)),
  })
  if (!res.ok || !res.body) {
    await fetchJsonOrThrow(res)
    throw makeError('Claude streaming falló.', 500, 'server_error')
  }
  return readSseStream(res.body, model, parseClaudeStreamEvent, onChunk)
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  model: string,
  pickChunk: (json: string) => string | { chunk?: string; finishReason?: string; usage?: ProviderUsage },
  onChunk: (chunk: string) => void,
): Promise<ProviderCallResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let finishReason: string | undefined
  let usage: ProviderUsage = {}

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
        const picked = pickChunk(json)
        const chunk = typeof picked === 'string' ? picked : picked.chunk ?? ''
        finishReason = typeof picked === 'string' ? finishReason : picked.finishReason ?? finishReason
        if (typeof picked !== 'string' && picked.usage) {
          usage = {
            promptTokens: picked.usage.promptTokens ?? usage.promptTokens,
            completionTokens: picked.usage.completionTokens ?? usage.completionTokens,
            reasoningTokens: picked.usage.reasoningTokens ?? usage.reasoningTokens,
            cacheCreationInputTokens: picked.usage.cacheCreationInputTokens ?? usage.cacheCreationInputTokens,
            cacheReadInputTokens: picked.usage.cacheReadInputTokens ?? usage.cacheReadInputTokens,
          }
        }
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
  return { text: fullText, model, finishReason, ...usage }
}

function modelEnvKey(provider: ProviderName, requestClass: RequestClass): string {
  return `${provider.toUpperCase()}_MODEL_${requestClass.toUpperCase()}`
}

export function resolveModel(provider: ProviderName, requestClass: RequestClass): string {
  const classModel = process.env[modelEnvKey(provider, requestClass)]
  if (classModel?.trim()) return classModel.trim()

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
): Promise<ProviderCallResult & { provider: ProviderName }> {
  const model = resolveModel(provider, normalizeRequestClass(req.requestClass))
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
  const primary = resolvePrimaryProvider(requestClass)
  const fallback = resolveFallbackProvider(requestClass)
  const timeoutMs = REQUEST_TIMEOUTS[requestClass]
  const totalBudgetMs = Math.min(timeoutMs, MAX_FUNCTION_WALLCLOCK_MS)
  const deadline = startedAt + totalBudgetMs
  const allowTechnicalRetry = shouldUseTechnicalRetry(requestClass)
  const responseSchemaCharCount = req.responseSchema ? JSON.stringify(req.responseSchema).length : 0
  const maxAttempts = allowTechnicalRetry
    ? (req.allowFallback && fallback && fallback !== primary ? 3 : 2)
    : 1
  let retryUsed = false
  let fallbackUsed = false
  let partialChunks = false

  let attemptIndex = 0
  const runAttempt = async (provider: ProviderName, attemptsRemaining: number) => {
    attemptIndex += 1
    const thisAttempt = attemptIndex
    let attemptTimeoutMs = computeAttemptTimeoutMs(deadline, attemptsRemaining)
    const attemptStartedAt = Date.now()
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let streamingDeadlineExtended = false
    const armTimeout = (ms: number) => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => controller.abort(), ms)
    }
    const extendTimeoutForStreaming = () => {
      if (streamingDeadlineExtended) return
      streamingDeadlineExtended = true
      const remainingBudget = deadline - Date.now()
      if (remainingBudget <= 0) {
        controller.abort()
        return
      }
      attemptTimeoutMs = Date.now() - attemptStartedAt + remainingBudget
      armTimeout(remainingBudget)
    }
    armTimeout(attemptTimeoutMs)
    try {
      const result = await invokeProvider(
        provider,
        req,
        controller.signal,
        onChunk ? (chunk) => {
          extendTimeoutForStreaming()
          partialChunks = true
          onChunk(chunk)
        } : undefined,
      )
      logCoachAttempt({
        traceId,
        generationId: req.generationId,
        logicalAttempt: req.logicalAttempt,
        requestClass,
        attempt: thisAttempt,
        outcome: 'ok',
        provider,
        attemptTimeoutMs,
        durationMs: Date.now() - attemptStartedAt,
        model: result.model,
        finishReason: result.finishReason,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        reasoningTokens: result.reasoningTokens,
        cacheCreationInputTokens: result.cacheCreationInputTokens,
        cacheReadInputTokens: result.cacheReadInputTokens,
        responseCharCount: result.text.length,
        systemPromptCharCount: req.systemPrompt.length,
        userPromptCharCount: req.userMessage.length,
        responseSchemaCharCount,
        maxTokens: req.maxTokens,
      })
      return result
    } catch (error) {
      const normalized = (error as Error).name === 'AbortError'
        ? makeError(`Timeout del proveedor ${provider} (${attemptTimeoutMs}ms).`, 504, 'timeout', true)
        : normalizeError(error)
      logCoachAttempt({
        traceId,
        generationId: req.generationId,
        logicalAttempt: req.logicalAttempt,
        requestClass,
        attempt: thisAttempt,
        outcome: 'error',
        provider,
        attemptTimeoutMs,
        durationMs: Date.now() - attemptStartedAt,
        errorCode: normalized.errorCode,
        message: normalized.message,
        systemPromptCharCount: req.systemPrompt.length,
        userPromptCharCount: req.userMessage.length,
        responseSchemaCharCount,
        maxTokens: req.maxTokens,
      })
      throw normalized
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  const sleepIfBudget = async (ms: number) => {
    if (ms <= 0) return
    if (Date.now() + ms >= deadline) return
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  try {
    const first = await runAttempt(primary, maxAttempts)
    return {
      ...first,
      traceId,
      generationId: req.generationId,
      requestClass,
      retryUsed,
      fallbackUsed,
      durationMs: Date.now() - startedAt,
    }
  } catch (firstError) {
    const normalizedFirstError = normalizeError(firstError)
    if (!normalizedFirstError.retryable || partialChunks || maxAttempts <= 1) throw normalizedFirstError
    retryUsed = true
    await sleepIfBudget(RETRY_BACKOFF_MS)
  }

  try {
    const second = await runAttempt(primary, maxAttempts - 1)
    return {
      ...second,
      traceId,
      generationId: req.generationId,
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
    await sleepIfBudget(RETRY_BACKOFF_MS)
  }

  const fallbackResult = await runAttempt(fallback!, 1)
  return {
    ...fallbackResult,
    traceId,
    generationId: req.generationId,
    requestClass,
    retryUsed,
    fallbackUsed,
    durationMs: Date.now() - startedAt,
  }
}

function streamResponse(
  req: CoachRequest,
  timing: { requestReceivedAt: number; authDurationMs: number },
): StreamingResponse {
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
          const serverDurationMs = Date.now() - timing.requestReceivedAt
          const response = {
            ...result,
            authDurationMs: timing.authDurationMs,
            serverDurationMs,
          }
          logCoachRequest({
            traceId: result.traceId,
            generationId: req.generationId,
            logicalAttempt: req.logicalAttempt,
            requestClass,
            outcome: 'ok',
            provider: result.provider,
            model: result.model,
            authDurationMs: timing.authDurationMs,
            providerDurationMs: result.durationMs,
            serverDurationMs,
            retryUsed: result.retryUsed,
            fallbackUsed: result.fallbackUsed,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            reasoningTokens: result.reasoningTokens,
            cacheCreationInputTokens: result.cacheCreationInputTokens,
            cacheReadInputTokens: result.cacheReadInputTokens,
            responseCharCount: result.text.length,
            finishReason: result.finishReason,
          })
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done', ...response })}\n`))
        } catch (error) {
          const normalized = normalizeError(error)
          const serverDurationMs = Date.now() - timing.requestReceivedAt
          logCoachRequest({
            traceId,
            generationId: req.generationId,
            logicalAttempt: req.logicalAttempt,
            requestClass,
            outcome: 'error',
            authDurationMs: timing.authDurationMs,
            serverDurationMs,
            errorCode: normalized.errorCode,
          })
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: 'error',
            truncated: sentAnyChunk,
            traceId,
            generationId: req.generationId,
            requestClass,
            error: normalized.message,
            errorCode: normalized.errorCode ?? 'unknown',
            authDurationMs: timing.authDurationMs,
            serverDurationMs,
          })}\n`))
        } finally {
          controller.close()
        }
      })()
    },
  })

  return { statusCode: 200, headers: STREAM_HEADERS, body: stream }
}

export const handler = stream(async (event: HandlerEvent): Promise<StreamingResponse> => {
  const requestReceivedAt = Date.now()
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
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

  const authStartedAt = Date.now()
  let authDurationMs = 0
  try {
    const auth = await resolveAuthContext(event)
    enforceRateLimit(auth)
    authDurationMs = Date.now() - authStartedAt
  } catch (error) {
    authDurationMs = Date.now() - authStartedAt
    const normalized = normalizeError(error)
    logCoachRequest({
      traceId: req.traceId ?? `srv-${requestReceivedAt}`,
      generationId: req.generationId,
      logicalAttempt: req.logicalAttempt,
      requestClass: normalizeRequestClass(req.requestClass),
      outcome: 'error',
      authDurationMs,
      serverDurationMs: Date.now() - requestReceivedAt,
      errorCode: normalized.errorCode,
    })
    return json(normalized.statusCode ?? 500, {
      error: normalized.message,
      errorCode: normalized.errorCode ?? 'unknown',
      traceId: req.traceId,
      requestClass: normalizeRequestClass(req.requestClass),
      generationId: req.generationId,
      authDurationMs,
      serverDurationMs: Date.now() - requestReceivedAt,
    })
  }

  const requestClass = normalizeRequestClass(req.requestClass)
  const bypassActions = shouldUseDeterministicBypass(requestClass)
    ? tryDeterministicBypass(req.userMessage)
    : null
  if (bypassActions) {
    const text = `He procesado tu comando directamente.\n\n<actions>\n${JSON.stringify(bypassActions, null, 2)}\n</actions>`
    const result = {
      text,
      provider: 'gemini' as ProviderName,
      model: 'local_regex (deterministic_bypass)',
      finishReason: 'stop',
      traceId: req.traceId ?? `srv-direct-${Date.now()}`,
      generationId: req.generationId,
      requestClass,
      retryUsed: false,
      fallbackUsed: false,
      durationMs: 1,
      authDurationMs,
      serverDurationMs: Date.now() - requestReceivedAt,
    }

    logCoachRequest({
      traceId: result.traceId,
      generationId: req.generationId,
      logicalAttempt: req.logicalAttempt,
      requestClass,
      outcome: 'ok',
      provider: result.provider,
      model: result.model,
      authDurationMs,
      providerDurationMs: result.durationMs,
      serverDurationMs: result.serverDurationMs,
      retryUsed: false,
      fallbackUsed: false,
      responseCharCount: text.length,
      finishReason: result.finishReason,
    })

    if (req.stream) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'chunk', chunk: text, traceId: result.traceId })}\n`))
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done', ...result })}\n`))
          controller.close()
        }
      })
      return { statusCode: 200, headers: STREAM_HEADERS, body: stream }
    } else {
      return json(200, result)
    }
  }

  if (req.stream) {
    return streamResponse(req, { requestReceivedAt, authDurationMs })
  }

  try {
    const result = await executeWithPolicy(req)
    const serverDurationMs = Date.now() - requestReceivedAt
    const response = { ...result, authDurationMs, serverDurationMs }
    logCoachRequest({
      traceId: result.traceId,
      generationId: req.generationId,
      logicalAttempt: req.logicalAttempt,
      requestClass,
      outcome: 'ok',
      provider: result.provider,
      model: result.model,
      authDurationMs,
      providerDurationMs: result.durationMs,
      serverDurationMs,
      retryUsed: result.retryUsed,
      fallbackUsed: result.fallbackUsed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      reasoningTokens: result.reasoningTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      responseCharCount: result.text.length,
      finishReason: result.finishReason,
    })
    return json(200, response)
  } catch (error) {
    const normalized = normalizeError(error)
    const serverDurationMs = Date.now() - requestReceivedAt
    logCoachRequest({
      traceId: req.traceId ?? `srv-${requestReceivedAt}`,
      generationId: req.generationId,
      logicalAttempt: req.logicalAttempt,
      requestClass,
      outcome: 'error',
      authDurationMs,
      serverDurationMs,
      errorCode: normalized.errorCode,
    })
    return json(normalized.statusCode ?? 500, {
      error: normalized.message,
      errorCode: normalized.errorCode ?? 'unknown',
      traceId: req.traceId,
      requestClass: normalizeRequestClass(req.requestClass),
      generationId: req.generationId,
      authDurationMs,
      serverDurationMs,
    })
  }
})
