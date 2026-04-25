/**
 * Pure helpers for retry/backoff and tier-aware queue ordering.
 *
 * Kept pure (no module-level state, no side effects) so that `drainQueue`
 * and tests can use them in isolation.
 *
 * `scheduleRetry` and the `retryTimer` lifecycle stay in `syncService.ts`
 * for now — they are tightly coupled to `runFullSync` orchestration.
 */

import { ENTITY_TIER, type SyncTier } from '../../types/syncDiagnostics'
import { MAX_RETRIES_PER_OP, type OfflineOp, type SupabaseTable } from '../syncUtils'

/**
 * Max retries por tier. Tier C (chat history) se dropea rápido para no consumir
 * presupuesto de fiabilidad del core. Coach proposals are Tier B because their
 * accepted/rejected state has product impact.
 */
export const MAX_RETRIES_BY_TIER: Record<SyncTier, number> = {
  A: MAX_RETRIES_PER_OP,
  B: MAX_RETRIES_PER_OP,
  C: 2,
}

export const TIER_ORDER: Record<SyncTier, number> = { A: 0, B: 1, C: 2 }

/**
 * Backoff exponencial con jitter: 5s, 15s, 45s, 120s, 300s (topado en 300s).
 * El jitter evita hammer sincronizado cuando múltiples tabs/devices vuelven
 * online al mismo tiempo.
 */
export const RETRY_BACKOFF_STEPS_MS = [5_000, 15_000, 45_000, 120_000, 300_000]
export const RETRY_JITTER_MAX_MS = 1_000

export function computeRetryDelayMs(failureCount: number): number {
  const index = Math.min(Math.max(failureCount - 1, 0), RETRY_BACKOFF_STEPS_MS.length - 1)
  const base = RETRY_BACKOFF_STEPS_MS[index]
  const jitter = Math.floor(Math.random() * RETRY_JITTER_MAX_MS)
  return base + jitter
}

export function sortQueueByTier(ops: OfflineOp[]): OfflineOp[] {
  return [...ops].sort((a, b) => {
    const ta = TIER_ORDER[ENTITY_TIER[a.table] ?? 'C']
    const tb = TIER_ORDER[ENTITY_TIER[b.table] ?? 'C']
    return ta - tb
  })
}

export function getMaxRetriesForTable(table: SupabaseTable): number {
  const tier = ENTITY_TIER[table] ?? 'C'
  return MAX_RETRIES_BY_TIER[tier]
}
