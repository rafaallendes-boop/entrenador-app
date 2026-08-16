import type { AIRequestClass, AITechnicalResult, CoachFeedback } from '../../types'
import { db } from '../../db/db'
import { getEntitlementTier } from '../../store/useEntitlementStore'
import { useAuthStore } from '../../store/useAuthStore'
import type { Tier } from '../entitlements/entitlementPolicy'
import {
  bucketForClass,
  bucketLimitForTier,
  QUOTA_BUCKETS,
} from '../entitlements/quotaBuckets'
import { AIProviderError } from './types'

const MAX_AI_REQUEST_LOGS = 500

export async function upsertAIRequestLog(entry: AITechnicalResult): Promise<void> {
  try {
    await db.aiRequestLogs.put(entry)
    await pruneAIRequestLogs()
  } catch {
    // Observability must never break the product flow.
  }
}

export async function getRecentAIRequestLogs(limit = 100): Promise<AITechnicalResult[]> {
  return db.aiRequestLogs
    .orderBy('startedAt')
    .reverse()
    .limit(limit)
    .toArray()
}

export async function assertDailyAIRequestLimit(
  requestClass: AIRequestClass,
  now = Date.now(),
  ctx?: { userId?: string | null; tier?: Tier },
): Promise<void> {
  try {
    const bucket = bucketForClass(requestClass)
    if (!bucket) return

    const tier = ctx?.tier ?? getEntitlementTier()
    const limit = bucketLimitForTier(bucket, tier)
    // Una clase bloqueada no tiene cuota cero: el gate de entitlement es quien
    // debe rechazarla y presentar la oferta correspondiente.
    if (limit == null) return

    const userId = ctx?.userId !== undefined
      ? ctx.userId
      : useAuthStore.getState().user?.id ?? null
    const usage = await getDailyAIUsage(now, userId)
    const used = bucket.classes.reduce((total, cls) => total + (usage[cls] ?? 0), 0)
    if (used >= limit) {
      throw new AIProviderError(
        'gemini',
        'rate_limit',
        `Límite diario alcanzado (${used}/${limit}). Vuelve a intentarlo mañana.`,
        false,
      )
    }
  } catch (error) {
    if (error instanceof AIProviderError) throw error
    // If local telemetry cannot be read, do not block the coach.
  }
}

export async function getDailyAIUsage(
  now = Date.now(),
  userId: string | null = null,
): Promise<Partial<Record<AIRequestClass, number>>> {
  const start = startOfLocalDay(now)
  const logs = await db.aiRequestLogs
    .where('startedAt')
    .aboveOrEqual(start)
    .toArray()

  // Dos cuentas en el mismo navegador no comparten cupo. Las filas legacy sin
  // userId no pertenecen a nadie y quedan fuera deliberadamente.
  const owned = logs.filter((log) => log.userId != null && log.userId === userId)

  // Quota is spent per logical generation, not per telemetry row. One Week
  // Creator request can log several rows -- a provider attempt, a retry, and the
  // local fallback that costs no provider call -- and charging each of them let
  // usage run past the declared daily cap. Rows without a `generationId` (chat,
  // Plan Builder reservations) keep counting individually.
  const counted = new Set<string>()
  return owned.reduce<Partial<Record<AIRequestClass, number>>>((acc, log) => {
    const generationKey = `${log.requestClass}:${log.generationId ?? log.traceId}`
    if (counted.has(generationKey)) return acc
    counted.add(generationKey)
    acc[log.requestClass] = (acc[log.requestClass] ?? 0) + 1
    return acc
  }, {})
}

export async function recordCoachFeedback(input: {
  targetType: CoachFeedback['targetType']
  targetId: string
  rating: CoachFeedback['rating']
  comment?: string
  traceId?: string
  chatMessageId?: string
  proposalId?: string
  requestClass?: AIRequestClass
}): Promise<CoachFeedback> {
  const now = Date.now()
  const id = `feedback:${input.targetType}:${input.targetId}`
  const existing = await db.coachFeedback.get(id)
  const feedback: CoachFeedback = {
    id,
    targetType: input.targetType,
    targetId: input.targetId,
    rating: input.rating,
    comment: input.comment?.trim() || undefined,
    traceId: input.traceId,
    chatMessageId: input.chatMessageId,
    proposalId: input.proposalId,
    requestClass: input.requestClass,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.coachFeedback.put(feedback)
  return feedback
}

export async function getCoachFeedbackByTarget(
  targetType: CoachFeedback['targetType'],
  targetId: string,
): Promise<CoachFeedback | undefined> {
  return db.coachFeedback.get(`feedback:${targetType}:${targetId}`)
}

export interface BetaQualitySnapshot {
  exportedAt: string
  dailyUsage: Partial<Record<AIRequestClass, number>>
  dailyLimits: Partial<Record<AIRequestClass, number>>
  requestCount: number
  feedbackCount: number
  positiveFeedback: number
  negativeFeedback: number
  recentRequests: AITechnicalResult[]
  recentFeedback: CoachFeedback[]
}

export async function getBetaQualitySnapshot(limit = 100): Promise<BetaQualitySnapshot> {
  const tier = getEntitlementTier()
  const userId = useAuthStore.getState().user?.id ?? null
  const [recentRequests, recentFeedback, dailyUsage] = await Promise.all([
    getRecentAIRequestLogs(limit),
    getRecentCoachFeedback(limit),
    getDailyAIUsage(Date.now(), userId),
  ])

  return {
    exportedAt: new Date().toISOString(),
    dailyUsage,
    dailyLimits: getDailyAILimits(tier),
    requestCount: recentRequests.length,
    feedbackCount: recentFeedback.length,
    positiveFeedback: recentFeedback.filter((item) => item.rating === 1).length,
    negativeFeedback: recentFeedback.filter((item) => item.rating === -1).length,
    recentRequests,
    recentFeedback,
  }
}

/** Límites visibles del tier actual; las clases bloqueadas se omiten. */
export function getDailyAILimits(tier: Tier): Partial<Record<AIRequestClass, number>> {
  return QUOTA_BUCKETS.reduce<Partial<Record<AIRequestClass, number>>>((limits, bucket) => {
    const limit = bucketLimitForTier(bucket, tier)
    if (limit == null) return limits
    for (const requestClass of bucket.classes) limits[requestClass] = limit
    return limits
  }, {})
}

export async function getRecentCoachFeedback(limit = 100): Promise<CoachFeedback[]> {
  return db.coachFeedback
    .orderBy('createdAt')
    .reverse()
    .limit(limit)
    .toArray()
}

export async function downloadBetaQualitySnapshot(): Promise<string> {
  const snapshot = await getBetaQualitySnapshot(200)
  const filename = `entrenador-beta-quality-${snapshot.exportedAt.replace(/[:.]/g, '-')}.json`
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return filename
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function resetDailyAIUsageForClasses(requestClasses: readonly AIRequestClass[], now = Date.now()): Promise<number> {
  const start = startOfLocalDay(now)
  const classSet = new Set(requestClasses)
  const logs = await db.aiRequestLogs
    .where('startedAt')
    .aboveOrEqual(start)
    .toArray()
  const logsToDelete = logs.filter((log) => classSet.has(log.requestClass))
  if (logsToDelete.length === 0) return 0
  await db.aiRequestLogs.bulkDelete(logsToDelete.map((log) => log.traceId))
  return logsToDelete.length
}

export function resetPlanBuilderDailyUsage(now = Date.now()): Promise<number> {
  return resetDailyAIUsageForClasses(['plan_builder_pair', 'plan_builder_week'], now)
}

function startOfLocalDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

async function pruneAIRequestLogs(): Promise<void> {
  const count = await db.aiRequestLogs.count()
  if (count <= MAX_AI_REQUEST_LOGS) return

  const excess = count - MAX_AI_REQUEST_LOGS
  const oldLogs = await db.aiRequestLogs
    .orderBy('startedAt')
    .limit(excess)
    .toArray()

  await db.aiRequestLogs.bulkDelete(oldLogs.map((log) => log.traceId))
}
