import { db } from '../../db/db'
import type { AIProviderName, AITechnicalResult } from '../../types'
import type { TrainingPlanWeek } from '../../types/planBuilder'
import { DEFAULT_DAILY_AI_LIMITS, getDailyAIUsage, upsertAIRequestLog } from '../ai/aiTelemetry'
import { AIProviderError } from '../ai/types'
import { PlanBuilderDailyQuotaError } from './dailyQuotaError'

const REQUEST_CLASS = 'plan_builder_week' as const
const SURFACE = 'plan_builder' as const
const RESERVATION_PREFIX = 'plan-builder-week-reservation'
const RESERVATION_WARNING = 'async_plan_builder_reserved'
const VALID_PROVIDERS = new Set<AIProviderName>(['claude', 'openai', 'mock', 'gemini'])

export function buildPlanBuilderWeekReservationTraceId(
  planId: string,
  weekIndex: number,
  timestamp: number,
): string {
  return `${RESERVATION_PREFIX}:${planId}:${weekIndex}:${timestamp}`
}

export async function assertPlanBuilderWeekRateLimit(
  weekIndexes: readonly number[],
  now = Date.now(),
): Promise<void> {
  const requested = uniqueWeekIndexes(weekIndexes).length
  if (requested === 0) return

  try {
    const usage = await getDailyAIUsage(now)
    const limit = DEFAULT_DAILY_AI_LIMITS[REQUEST_CLASS]
    const used = usage[REQUEST_CLASS] ?? 0
    const remaining = Math.max(0, limit - used)
    if (requested > remaining) {
      throw new PlanBuilderDailyQuotaError({ requested, remaining, limit })
    }
  } catch (error) {
    if (error instanceof AIProviderError) throw error
    // If local telemetry cannot be read, do not block generation.
  }
}

export async function reservePlanBuilderWeekUsage(input: {
  planId: string
  weekIndexes: readonly number[]
  now?: number
}): Promise<string[]> {
  const timestamp = input.now ?? Date.now()
  const weekIndexes = uniqueWeekIndexes(input.weekIndexes)
  const traceIds = weekIndexes.map((weekIndex) =>
    buildPlanBuilderWeekReservationTraceId(input.planId, weekIndex, timestamp)
  )

  await Promise.all(traceIds.map((traceId, index) => upsertAIRequestLog({
    traceId,
    surface: SURFACE,
    requestClass: REQUEST_CLASS,
    status: 'started',
    startedAt: timestamp,
    warnings: [
      RESERVATION_WARNING,
      `plan:${input.planId}`,
      `week:${weekIndexes[index] + 1}`,
    ],
  })))

  return traceIds
}

export async function releasePlanBuilderWeekReservations(input: {
  planId: string
  weekIndexes?: readonly number[]
  now?: number
}): Promise<number> {
  try {
    const reservations = await getTodayReservations(input.planId, input.weekIndexes, input.now)
    if (reservations.length === 0) return 0
    await db.aiRequestLogs.bulkDelete(reservations.map((log) => log.traceId))
    return reservations.length
  } catch {
    return 0
  }
}

export async function syncPlanBuilderWeekUsageFromWeeks(
  planId: string,
  weeks: readonly TrainingPlanWeek[],
  now = Date.now(),
): Promise<void> {
  const finalizedWeeks = weeks.filter((week) =>
    (week.status === 'draft' || week.status === 'accepted' || week.status === 'error') &&
    (week.generationMeta.attempts ?? 0) > 0
  )
  if (finalizedWeeks.length === 0) return

  await Promise.all(finalizedWeeks.map(async (week) => {
    const meta = week.generationMeta
    if (meta.requestClass && meta.requestClass !== REQUEST_CLASS) return

    const completedAt = meta.lastAttemptAt ?? week.updatedAt ?? now
    const startedAt = meta.durationMs && meta.durationMs > 0
      ? Math.max(0, completedAt - meta.durationMs)
      : completedAt
    const status: AITechnicalResult['status'] = week.status === 'error' ? 'failed' : 'completed'
    const warnings = buildWeekWarnings(planId, week)

    await releasePlanBuilderWeekReservations({
      planId,
      weekIndexes: [week.weekIndex],
      now,
    })

    if (!meta.traceId) {
      return
    }

    await upsertAIRequestLog({
      traceId: meta.traceId,
      surface: SURFACE,
      requestClass: REQUEST_CLASS,
      provider: normalizeProvider(meta.provider),
      model: meta.model,
      durationMs: meta.durationMs,
      status,
      errorCode: week.status === 'error' ? meta.errorClass ?? meta.lastError : meta.errorClass,
      retryUsed: meta.retryUsed,
      fallbackUsed: meta.fallbackUsed,
      warnings: warnings.length ? warnings : undefined,
      startedAt,
      completedAt,
    })
  }))
}

function uniqueWeekIndexes(weekIndexes: readonly number[]): number[] {
  return Array.from(new Set(weekIndexes.filter((weekIndex) =>
    Number.isInteger(weekIndex) && weekIndex >= 0
  ))).sort((a, b) => a - b)
}

async function getTodayReservations(
  planId: string,
  weekIndexes?: readonly number[],
  now = Date.now(),
): Promise<AITechnicalResult[]> {
  try {
    const start = startOfLocalDay(now)
    const weekSet = weekIndexes ? new Set(uniqueWeekIndexes(weekIndexes)) : null
    const prefix = `${RESERVATION_PREFIX}:${planId}:`
    const logs = await db.aiRequestLogs
      .where('startedAt')
      .aboveOrEqual(start)
      .toArray()
    return logs.filter((log) => {
      if (!log.traceId.startsWith(prefix)) return false
      if (!log.warnings?.includes(RESERVATION_WARNING)) return false
      if (!weekSet) return true
      const weekIndex = extractReservationWeekIndex(log.traceId)
      return weekIndex != null && weekSet.has(weekIndex)
    })
  } catch {
    return []
  }
}

function extractReservationWeekIndex(traceId: string): number | null {
  const parts = traceId.split(':')
  const value = Number(parts[2])
  return Number.isInteger(value) ? value : null
}

function normalizeProvider(provider: string | undefined): AIProviderName | undefined {
  return provider && VALID_PROVIDERS.has(provider as AIProviderName)
    ? provider as AIProviderName
    : undefined
}

function buildWeekWarnings(planId: string, week: TrainingPlanWeek): string[] {
  const meta = week.generationMeta
  return [
    'async_plan_builder_synced',
    `plan:${planId}`,
    `week:${week.weekIndex + 1}`,
    ...(meta.lastError ? [`last_error:${meta.lastError}`] : []),
    ...(meta.repairWarnings ?? []).map((warning) => `${warning.code}:${warning.message}`),
  ]
}

function startOfLocalDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
