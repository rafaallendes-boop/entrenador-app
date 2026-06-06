import type { Handler, HandlerEvent } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import type { AthleteProfile, PlanWizardConfig } from '../../src/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../src/types/planBuilder'
import { runAsyncPlanGeneration, type AsyncPlanGenerationWriter } from '../../src/services/planBuilder/asyncGenerationLoop'
import { rowToTrainingPlan, trainingPlanToRow, trainingPlanWeekToRow } from '../../src/services/planBuilder/planRows'
import { callAnthropicForWeek } from './_shared/anthropicCaller'

interface GeneratePlanPayload {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: unknown
  targetWeekIndexes?: number[]
  repairInstructions?: Record<number, string>
}

interface AuthContext {
  userId: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const MAX_WEEKS = 40

function json(statusCode: number, body: object) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }
}

function getHeader(headers: HandlerEvent['headers'], name: string): string | undefined {
  const direct = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (direct) return direct
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

function getBearerToken(event: HandlerEvent): string | undefined {
  const authHeader = getHeader(event.headers, 'authorization')?.trim()
  const match = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader) : null
  return match?.[1]?.trim()
}

function getSupabaseUrl(): string {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  if (!url) throw new Error('SUPABASE_URL no configurada.')
  return url
}

function getSupabaseAnonKey(): string {
  const key = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!key) throw new Error('SUPABASE_ANON_KEY no configurada.')
  return key
}

function getSupabaseServiceRoleKey(): string {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada.')
  return key
}

async function resolveAuthContext(event: HandlerEvent): Promise<AuthContext> {
  const token = getBearerToken(event)
  if (!token) throw Object.assign(new Error('Sesión requerida.'), { statusCode: 401 })

  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  })
  if (!response.ok) throw Object.assign(new Error('Sesión inválida o expirada.'), { statusCode: 401 })
  const user = await response.json().catch(() => ({})) as { id?: unknown; sub?: unknown }
  const userId = typeof user.id === 'string'
    ? user.id
    : typeof user.sub === 'string'
      ? user.sub
      : undefined
  if (!userId) throw Object.assign(new Error('Sesión inválida o expirada.'), { statusCode: 401 })
  return { userId }
}

function isPayload(input: unknown): input is GeneratePlanPayload {
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

function createJobId(planId: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `plan-bg-${crypto.randomUUID()}`
  }
  return `plan-bg-${planId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createSupabaseWriter(userId: string): AsyncPlanGenerationWriter {
  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return {
    async getPlan(planId) {
      const { data, error } = await supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', userId)
        .eq('id', planId)
        .maybeSingle()
      if (error) throw error
      return data ? rowToTrainingPlan(data as Record<string, unknown>) : null
    },
    async putPlan(plan) {
      const { error } = await supabase
        .from('training_plans')
        .upsert(trainingPlanToRow(plan, userId), { onConflict: 'id' })
      if (error) throw error
    },
    async putWeek(week) {
      const { error } = await supabase
        .from('training_plan_weeks')
        .upsert(trainingPlanWeekToRow(week, userId), { onConflict: 'id' })
      if (error) throw error
    },
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  let body: unknown
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!isPayload(body)) {
    return json(400, { error: 'Payload inválido para generar plan.' })
  }

  try {
    const auth = await resolveAuthContext(event)
    const writer = createSupabaseWriter(auth.userId)
    const jobId = createJobId(body.plan.id)
    const startedAt = Date.now()
    const plan: TrainingPlan = {
      ...body.plan,
      generationState: 'generating',
      updatedAt: startedAt,
      generationSummary: {
        startedAt,
        jobId,
        strategy: 'single',
        completedWeeks: body.weeks.filter((week) => week.status === 'draft' && week.sessions.length > 0).length,
        failedWeeks: body.weeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
        totalAttempts: body.weeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
        heartbeatAt: startedAt,
      },
    }

    await writer.putPlan(plan)
    await Promise.all(body.weeks.map((week) => writer.putWeek(week)))

    await runAsyncPlanGeneration({
      plan,
      weeks: body.weeks,
      profile: body.profile,
      wizardConfig: body.wizardConfig,
      recentContext: body.recentContext,
      targetWeekIndexes: body.targetWeekIndexes,
      repairInstructions: body.repairInstructions,
      jobId,
      writer,
      callLLM: callAnthropicForWeek,
    })

    return json(202, { ok: true, jobId })
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500
    const message = error instanceof Error ? error.message : String(error)
    return json(statusCode, { error: message })
  }
}
