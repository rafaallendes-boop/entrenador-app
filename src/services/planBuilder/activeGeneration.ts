import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { countReadyWeeks } from './weekUtils'

/**
 * Guard compartido entre el cliente y la Netlify function para decidir si un plan
 * tiene una generación realmente en curso. Mantener este módulo libre de
 * import.meta/env: lo importa también el bundle de functions.
 */
export const ACTIVE_GENERATION_TTL_MS = 16 * 60_000

export function isActivePlanGeneration(
  plan: TrainingPlan | null,
  now: number,
  ttlMs: number = ACTIVE_GENERATION_TTL_MS,
): plan is TrainingPlan {
  if (!plan || plan.generationState !== 'generating') return false
  if (!plan.generationSummary?.jobId) return false
  if (plan.generationSummary?.cancelRequested) return false
  // Un run terminado nunca está activo: el worker setea completedAt al cerrar.
  // Esto evita que un summary viejo re-publicado por el cliente bloquee el retrigger.
  if (plan.generationSummary?.completedAt != null) return false
  const heartbeatAt = plan.generationSummary?.heartbeatAt
    ?? plan.generationSummary?.startedAt
    ?? plan.updatedAt
  return typeof heartbeatAt === 'number' && now - heartbeatAt < ttlMs
}

/**
 * Decide si el worker background debe dedupearse contra una generación ya activa.
 * Solo dedupea cuando hay un run activo cuyo jobId difiere del que arranca: así el
 * background invocado por `enqueue` (que ya escribió este jobId de forma durable)
 * reconoce su propio trabajo y procede, en vez de bloquearse contra sí mismo.
 */
export function shouldDedupeActiveGeneration(
  existingPlan: TrainingPlan | null,
  resolvedJobId: string,
  now: number,
  ttlMs: number = ACTIVE_GENERATION_TTL_MS,
): boolean {
  if (!isActivePlanGeneration(existingPlan, now, ttlMs)) return false
  return existingPlan.generationSummary?.jobId !== resolvedJobId
}

/**
 * Estado 'generating' que el cliente publica ANTES de disparar la función background.
 * Crítico: NO debe arrastrar jobId/completedAt del run anterior — si lo hace, la función
 * se dedupea contra ese run terminado y la regeneración nunca ocurre (el cliente queda
 * esperando hasta marcar "sin señales de progreso").
 */
export function buildRetriggerPlan(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  updatedAt: number,
): TrainingPlan {
  const previous = plan.generationSummary
  return {
    ...plan,
    generationState: 'generating',
    updatedAt,
    generationSummary: {
      startedAt: updatedAt,
      strategy: previous?.strategy ?? 'single',
      completedWeeks: countReadyWeeks(weeks),
      failedWeeks: [],
      totalAttempts: previous?.totalAttempts ?? 0,
      heartbeatAt: updatedAt,
      acceptedAt: previous?.acceptedAt,
      discardedAt: previous?.discardedAt,
      qualityReview: previous?.qualityReview,
    },
  }
}
