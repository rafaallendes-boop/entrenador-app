import type { HandlerEvent } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import type { AthleteProfile, PlanWizardConfig } from '../../../src/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../src/types/planBuilder'
import type { AsyncPlanGenerationWriter } from '../../../src/services/planBuilder/asyncGenerationLoop'
import { rowToTrainingPlan, trainingPlanToRow, trainingPlanWeekToRow } from '../../../src/services/planBuilder/planRows'

export interface GeneratePlanPayload {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: unknown
  targetWeekIndexes?: number[]
  repairInstructions?: Record<number, string>
  /** Set by the enqueue endpoint so the background worker adopts the durable jobId. */
  jobId?: string
}

export interface AuthContext {
  userId: string
  token: string
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' }
export const MAX_WEEKS = 40
export const AUTH_TIMEOUT_MS = 10_000
export const SUPABASE_OP_TIMEOUT_MS = 15_000

export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export function json(statusCode: number, body: object) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }
}

export function getHeader(headers: HandlerEvent['headers'], name: string): string | undefined {
  const direct = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (direct) return direct
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

export function getBearerToken(event: HandlerEvent): string | undefined {
  const authHeader = getHeader(event.headers, 'authorization')?.trim()
  const match = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader) : null
  return match?.[1]?.trim()
}

export function getSupabaseUrl(): string {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  if (!url) throw new Error('SUPABASE_URL no configurada.')
  return url
}

export function getSupabaseAnonKey(): string {
  const key = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!key) throw new Error('SUPABASE_ANON_KEY no configurada.')
  return key
}

export async function resolveAuthContext(event: HandlerEvent): Promise<AuthContext> {
  const token = getBearerToken(event)
  if (!token) throw Object.assign(new Error('Sesión requerida.'), { statusCode: 401 })

  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  const response = await withTimeout(
    fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    }),
    AUTH_TIMEOUT_MS,
    'auth.getUser',
  )
  if (!response.ok) throw Object.assign(new Error('Sesión inválida o expirada.'), { statusCode: 401 })
  const user = await response.json().catch(() => ({})) as { id?: unknown; sub?: unknown }
  const userId = typeof user.id === 'string'
    ? user.id
    : typeof user.sub === 'string'
      ? user.sub
      : undefined
  if (!userId) throw Object.assign(new Error('Sesión inválida o expirada.'), { statusCode: 401 })
  return { userId, token }
}

export function isGeneratePlanPayload(input: unknown): input is GeneratePlanPayload {
  if (!input || typeof input !== 'object') return false
  const candidate = input as Partial<GeneratePlanPayload>
  return Boolean(
    candidate.plan
    && typeof candidate.plan.id === 'string'
    && Array.isArray(candidate.weeks)
    && candidate.weeks.length > 0
    && candidate.weeks.length <= MAX_WEEKS
    && candidate.weeks.every((week) => week && week.planId === candidate.plan?.id),
  )
}

export function createJobId(planId: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `plan-bg-${crypto.randomUUID()}`
  }
  return `plan-bg-${planId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createSupabaseWriter(userId: string, token: string): AsyncPlanGenerationWriter {
  const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  return {
    async checkCancelled(planId) {
      const { data, error } = await withTimeout(
        supabase.from('training_plans').select('generation_summary').eq('user_id', userId).eq('id', planId).maybeSingle(),
        SUPABASE_OP_TIMEOUT_MS,
        'checkCancelled',
      )
      if (error) throw error
      return Boolean(
        (data?.generation_summary as { cancelRequested?: boolean } | null)?.cancelRequested,
      )
    },
    async getPlan(planId) {
      const { data, error } = await withTimeout(
        supabase.from('training_plans').select('*').eq('user_id', userId).eq('id', planId).maybeSingle(),
        SUPABASE_OP_TIMEOUT_MS,
        'getPlan',
      )
      if (error) throw error
      return data ? rowToTrainingPlan(data as Record<string, unknown>) : null
    },
    async putPlan(plan) {
      const { error } = await withTimeout(
        supabase.from('training_plans').upsert(trainingPlanToRow(plan, userId), { onConflict: 'id' }),
        SUPABASE_OP_TIMEOUT_MS,
        'putPlan',
      )
      if (error) throw error
    },
    async putWeek(week) {
      const { error } = await withTimeout(
        supabase.from('training_plan_weeks').upsert(trainingPlanWeekToRow(week, userId), { onConflict: 'id' }),
        SUPABASE_OP_TIMEOUT_MS,
        'putWeek',
      )
      if (error) throw error
      console.log(`[generate-plan] week checkpoint planId=${week.planId} week=${week.weekIndex} status=${week.status} sessions=${week.sessions.length} attempts=${week.generationMeta.attempts ?? 0} errorClass=${week.generationMeta.errorClass ?? 'none'}`)
    },
  }
}

/**
 * Resolves the site base URL so one function can invoke another over HTTP.
 * Prefers the inbound request host so deploy previews call their own worker;
 * falls back to Netlify-provided env vars only when host headers are missing.
 */
export function resolveSelfBaseUrl(event: HandlerEvent): string {
  const proto = getHeader(event.headers, 'x-forwarded-proto') ?? 'https'
  const host = getHeader(event.headers, 'x-forwarded-host') ?? getHeader(event.headers, 'host')
  if (host) return `${proto}://${host}`.replace(/\/$/, '')

  const fromEnv = process.env['URL'] ?? process.env['DEPLOY_PRIME_URL'] ?? process.env['DEPLOY_URL']
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  throw new Error('No se pudo resolver la URL base para invocar el worker.')
}
