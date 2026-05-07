/**
 * Sync diagnostics — ring buffers locales para observabilidad de sync.
 *
 * - Nunca fallan el sync (try/catch defensivo en todas las escrituras).
 * - Se persisten en Dexie (v10+) para sobrevivir reloads.
 * - Tamaños acotados: 100 eventos / 20 errores.
 */

import { db } from '../db/db'
import type {
  SyncDiagnosticEvent,
  SyncErrorLogEntry,
  SyncTier,
  SyncTierHealth,
  SyncTierHealthMap,
  SyncEventKind,
  SyncEventStatus,
} from '../types/syncDiagnostics'
import { getEntityTier } from '../types/syncDiagnostics'
import type { SupabaseTable, SyncErrorCategory, SyncErrorInfo } from './syncUtils'

const MAX_EVENTS = 100
const MAX_ERROR_LOG = 20

interface TrackEventParams {
  kind: SyncEventKind
  status: SyncEventStatus
  entity?: SupabaseTable | null
  userId?: string | null
  durationMs?: number | null
  errorCategory?: SyncErrorCategory | null
  detail?: string | null
}

export function trackSyncEvent(params: TrackEventParams): void {
  const event: SyncDiagnosticEvent = {
    timestamp: Date.now(),
    userId: params.userId ?? null,
    kind: params.kind,
    entity: params.entity ?? null,
    tier: getEntityTier(params.entity ?? null),
    status: params.status,
    durationMs: params.durationMs ?? null,
    errorCategory: params.errorCategory ?? null,
    detail: params.detail ?? null,
  }

  void writeEvent(event).catch(() => {
    // swallow — diagnostics never break sync
  })
}

async function writeEvent(event: SyncDiagnosticEvent): Promise<void> {
  try {
    await db.syncDiagnostics.add(event)
    const count = await db.syncDiagnostics.count()
    if (count > MAX_EVENTS) {
      const toDrop = count - MAX_EVENTS
      const oldest = await db.syncDiagnostics.orderBy('id').limit(toDrop).primaryKeys()
      if (oldest.length > 0) {
        await db.syncDiagnostics.bulkDelete(oldest)
      }
    }
  } catch {
    // ignore — writes are best-effort
  }
}

interface RecordErrorParams {
  entity: SupabaseTable | null
  errorInfo: SyncErrorInfo
  userId?: string | null
}

export function recordSyncError(params: RecordErrorParams): void {
  const entry: SyncErrorLogEntry = {
    timestamp: Date.now(),
    userId: params.userId ?? null,
    entity: params.entity,
    tier: getEntityTier(params.entity),
    errorCategory: params.errorInfo.category,
    userMessage: params.errorInfo.userMessage,
    technicalMessage: params.errorInfo.technicalMessage,
    retriable: params.errorInfo.retriable,
    autoRepairable: params.errorInfo.autoRepairable,
  }

  void writeError(entry).catch(() => {
    // swallow
  })
}

async function writeError(entry: SyncErrorLogEntry): Promise<void> {
  try {
    await db.syncErrorLog.add(entry)
    const count = await db.syncErrorLog.count()
    if (count > MAX_ERROR_LOG) {
      const toDrop = count - MAX_ERROR_LOG
      const oldest = await db.syncErrorLog.orderBy('id').limit(toDrop).primaryKeys()
      if (oldest.length > 0) {
        await db.syncErrorLog.bulkDelete(oldest)
      }
    }
  } catch {
    // ignore
  }
}

export async function getRecentSyncEvents(limit = 50): Promise<SyncDiagnosticEvent[]> {
  try {
    return await db.syncDiagnostics.orderBy('id').reverse().limit(limit).toArray()
  } catch {
    return []
  }
}

export async function getRecentSyncErrors(limit = 20): Promise<SyncErrorLogEntry[]> {
  try {
    return await db.syncErrorLog.orderBy('id').reverse().limit(limit).toArray()
  } catch {
    return []
  }
}

export async function clearSyncDiagnostics(): Promise<void> {
  try {
    await Promise.all([
      db.syncDiagnostics.clear(),
      db.syncErrorLog.clear(),
    ])
  } catch {
    // ignore
  }
}

/**
 * Compute tier health from pending tables + last error entity.
 *
 * - blocked: pendingTables incluye alguna de ese tier con error reciente
 * - degraded: pendingTables incluye alguna de ese tier sin error visible
 * - healthy: sin pendientes de ese tier
 */
export function computeTierHealthMap(params: {
  pendingTables: SupabaseTable[]
  lastErrorEntity: SupabaseTable | null
}): SyncTierHealthMap {
  const byTier: Record<SyncTier, SupabaseTable[]> = { A: [], B: [], C: [] }
  for (const table of params.pendingTables) {
    const tier = getEntityTier(table)
    if (tier) byTier[tier].push(table)
  }

  const blockedTier = params.lastErrorEntity ? getEntityTier(params.lastErrorEntity) : null

  const deriveHealth = (tier: SyncTier): SyncTierHealth => {
    if (blockedTier === tier) return 'blocked'
    if (byTier[tier].length === 0) return 'healthy'
    return 'degraded'
  }

  return {
    A: deriveHealth('A'),
    B: deriveHealth('B'),
    C: deriveHealth('C'),
  }
}
