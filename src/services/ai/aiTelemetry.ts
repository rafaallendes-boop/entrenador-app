import type { AIRequestClass, AITechnicalResult, CoachFeedback } from '../../types'
import { db } from '../../db/db'
import { AIProviderError } from './types'

const MAX_AI_REQUEST_LOGS = 500

export const DEFAULT_DAILY_AI_LIMITS: Record<AIRequestClass, number> = {
  chat_general: 80,
  chat_action: 40,
  weekly_summary: 10,
  week_creator: 8,
  plan_builder_week: 12,
  plan_builder_pair: 6,
  import_extract: 10,
}

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
): Promise<void> {
  try {
    const usage = await getDailyAIUsage(now)
    const limit = DEFAULT_DAILY_AI_LIMITS[requestClass]
    const used = usage[requestClass] ?? 0
    if (used >= limit) {
      throw new AIProviderError(
        'gemini',
        'rate_limit',
        `Límite diario beta alcanzado para ${requestClass} (${used}/${limit}). Vuelve a intentarlo mañana.`,
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
): Promise<Partial<Record<AIRequestClass, number>>> {
  const start = startOfLocalDay(now)
  const logs = await db.aiRequestLogs
    .where('startedAt')
    .aboveOrEqual(start)
    .toArray()

  return logs.reduce<Partial<Record<AIRequestClass, number>>>((acc, log) => {
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
