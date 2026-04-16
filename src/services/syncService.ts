/**
 * Sync layer between local Dexie and Supabase.
 *
 * Strategy:
 * - UI always reads from Dexie.
 * - Local writes trigger fire-and-forget pushes to Supabase.
 * - After auth, pullAll() merges remote data into Dexie using last-write-wins.
 * - If offline or Supabase errors, ops are queued in localStorage and retried.
 */

import { supabase } from './auth'
import { db } from '../db/db'
import { useAuthStore } from '../store/useAuthStore'
import type {
  Session,
  DayLog,
  WeekSummary,
  ChatMessage,
  CoachProposal,
  AthleteProfile,
} from '../types'
import type { AppDataExport } from './dataExport'
import { clearAllLocalAppData } from './appMaintenance'
import {
  athleteProfileRowsEqual,
  athleteProfileToRow,
  classifyAthleteProfileSyncError,
  classifySyncError,
  coalesceAthleteProfileRows,
  compactQueue,
  getSyncErrorMessage,
  normalizeAthleteProfilePayload,
  rowToAthleteProfile,
  scoreEntityData,
  toAthleteProfileSyncRow,
  MAX_RETRIES_PER_OP,
  type AthleteProfileSyncRow,
  type OfflineOp,
  type SyncErrorCategory,
  type SyncErrorInfo,
  type SupabaseTable,
} from './syncUtils'
const QUEUE_KEY = 'entrenador_sync_queue_v1'
const LAST_SYNC_USER_KEY = 'entrenador_sync_user_v1'
const MIGRATION_KEY_PREFIX = 'entrenador_migrated_v1'
const SESSION_DELETE_TOMBSTONES_KEY = 'entrenador_sync_session_tombstones_v1'
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days
const MAX_QUEUE_SIZE = 500
let activeDrainQueuePromise: Promise<boolean> | null = null
let activePullAllPromise: Promise<void> | null = null
let activeFullSyncPromise: Promise<void> | null = null
let syncAttemptCounter = 0

/**
 * Safe accessor for the Supabase client. Throws a typed SyncError
 * instead of crashing with a null-reference TypeError.
 */
function getSupabase() {
  if (!supabase) {
    throw Object.assign(
      new TypeError('Supabase client is null — VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing'),
      { category: 'supabase_not_configured' as SyncErrorCategory },
    )
  }
  return supabase
}

/**
 * Structured sync logger. All sync events go through here for
 * consistent format and easy debugging.
 */
function syncLog(
  event: string,
  details: Record<string, unknown>,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const entry = {
    event,
    timestamp: Date.now(),
    userId: getUserId(),
    ...details,
  }
  if (level === 'error') console.error('[sync]', event, entry)
  else if (level === 'warn') console.warn('[sync]', event, entry)
  else console.info('[sync]', event, entry)
}

interface QueueSummary {
  pendingOps: number
  pendingUpserts: number
  pendingDeletes: number
  oldestPendingOpAt: number | null
  pendingTables: SupabaseTable[]
}

interface MergeContext {
  allowDeletes: boolean
  deleteBeforeTs: number | null
}

interface MergeResolution<T extends { id: string }> {
  winner: T
  loserId?: string
}

function syncStoreState() {
  return useAuthStore.getState()
}

function getQueueSummary(queue = loadQueue()): QueueSummary {
  const pendingUpserts = queue.filter((op) => op.action === 'upsert').length
  const pendingDeletes = queue.filter((op) => op.action === 'delete').length
  const oldestPendingOpAt = queue.reduce<number | null>((oldest, op) => {
    if (oldest == null) return op.enqueuedAt
    return Math.min(oldest, op.enqueuedAt)
  }, null)
  const pendingTables = [...new Set(queue.map((op) => op.table))]

  return {
    pendingOps: queue.length,
    pendingUpserts,
    pendingDeletes,
    oldestPendingOpAt,
    pendingTables,
  }
}

function refreshQueueDiagnostics(): void {
  const queue = loadQueue()
  const summary = getQueueSummary(queue)

  syncStoreState().setSyncDetails({
    ...summary,
  })
}

function startSyncAttempt(): void {
  syncStoreState().setSyncDetails({
    syncAttemptInFlight: true,
    lastSyncAt: Date.now(),
    retryScheduledAt: null,
  })
  if (navigator.onLine) {
    syncStoreState().setSyncStatus('syncing')
  }
}

function finishSyncAttempt(status: 'idle' | 'offline' | 'error' = 'idle'): void {
  refreshQueueDiagnostics()
  syncStoreState().setSyncDetails({ syncAttemptInFlight: false })
  syncStoreState().setSyncStatus(status)
}

function markSyncRecovered(): void {
  refreshQueueDiagnostics()
  syncStoreState().setSyncStatus('idle')
  syncStoreState().setSyncDetails({
    syncAttemptInFlight: false,
    lastSuccessfulSyncAt: Date.now(),
    lastRecoveredSyncAt: Date.now(),
    lastErrorAt: null,
    lastErrorMessage: null,
    lastErrorCategory: null,
    lastBlockedTable: null,
    retryScheduledAt: null,
    consecutiveFailures: 0,
    autoRepairInProgress: false,
  })
}

function markSyncHealthy(): void {
  refreshQueueDiagnostics()
  syncStoreState().setSyncStatus('idle')
  syncStoreState().setSyncDetails({
    syncAttemptInFlight: false,
    lastSuccessfulSyncAt: Date.now(),
    lastErrorAt: null,
    lastErrorMessage: null,
    lastErrorCategory: null,
    lastBlockedTable: null,
    retryScheduledAt: null,
    consecutiveFailures: 0,
    autoRepairInProgress: false,
  })
}

function scheduleRetry(ms: number): void {
  syncStoreState().setSyncDetails({ retryScheduledAt: Date.now() + ms })
}

function loadQueue(): OfflineOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item): item is OfflineOp => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as OfflineOp).userId === 'string' &&
        typeof (item as OfflineOp).table === 'string' &&
        typeof (item as OfflineOp).action === 'string' &&
        typeof (item as OfflineOp).payload === 'object' &&
        (item as OfflineOp).payload !== null &&
        typeof (item as OfflineOp).enqueuedAt === 'number'
      )
    })
  } catch {
    return []
  }
}

function saveQueue(queue: OfflineOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Ignore storage quota failures.
  }
  refreshQueueDiagnostics()
}

function enqueue(op: OfflineOp): void {
  const queue = compactQueue(loadQueue(), op)
  if (queue.length >= MAX_QUEUE_SIZE) {
    const dropped = queue.shift()
    syncLog('queue:overflow', {
      maxQueueSize: MAX_QUEUE_SIZE,
      droppedTable: dropped?.table,
      droppedAction: dropped?.action,
      droppedId: typeof dropped?.payload?.id === 'string' ? dropped.payload.id : null,
      droppedEnqueuedAt: dropped?.enqueuedAt ?? null,
    }, 'warn')
  }
  saveQueue(queue)
}

function getMigrationKey(userId: string): string {
  return `${MIGRATION_KEY_PREFIX}:${userId}`
}

function getUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null
}

function isEnabled(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  return Boolean(url)
}


function applySyncFailure(error: unknown, fallbackMessage: string, blockedTable?: SupabaseTable | null): void {
  const errorInfo = classifySyncError(error, (blockedTable ?? undefined) as SupabaseTable | undefined)
  const message = errorInfo.userMessage || getSyncErrorMessage(error, fallbackMessage)
  const status = errorInfo.category === 'network_error'
    ? 'offline' as const
    : 'error' as const
  const failureCount = (syncStoreState().syncDetails.consecutiveFailures ?? 0) + 1
  const retryMs = errorInfo.retriable
    ? Math.min(60000, failureCount <= 1 ? 15000 : failureCount <= 3 ? 30000 : 60000)
    : null

  syncLog('sync:failure', {
    errorCategory: errorInfo.category,
    retriable: errorInfo.retriable,
    autoRepairable: errorInfo.autoRepairable,
    technicalMessage: errorInfo.technicalMessage,
    blockedTable,
    failureCount,
    retryMs,
  }, 'error')

  refreshQueueDiagnostics()
  syncStoreState().setSyncStatus(status, message)
  syncStoreState().setSyncDetails({
    syncAttemptInFlight: false,
    lastErrorAt: Date.now(),
    lastErrorMessage: message,
    lastErrorCategory: errorInfo.category,
    lastBlockedTable: blockedTable ?? null,
    retryScheduledAt: retryMs != null ? Date.now() + retryMs : null,
    consecutiveFailures: failureCount,
    autoRepairInProgress: false,
  })
}

function logAthleteProfileSync(event: string, details: Record<string, unknown>): void {
  syncLog(`athlete_profiles:${event}`, details)
}

async function drainQueue(): Promise<boolean> {
  if (activeDrainQueuePromise) {
    return activeDrainQueuePromise
  }

  activeDrainQueuePromise = (async () => {
  const attemptId = ++syncAttemptCounter
  startSyncAttempt()
  const queue = loadQueue()
  const userId = getUserId()

  if (!userId) {
    finishSyncAttempt('idle')
    return queue.length === 0
  }

  const otherUsersQueue = queue.filter((op) => op.userId !== userId)
  const currentUserQueue = queue.filter((op) => op.userId === userId)

  if (currentUserQueue.length === 0) {
    saveQueue(otherUsersQueue)
    finishSyncAttempt('idle')
    return true
  }

  const remaining: OfflineOp[] = []
  const initialCount = currentUserQueue.length
  let lastFailureInfo: SyncErrorInfo | null = null

  for (const op of currentUserQueue) {
    const opRetryCount = op.retryCount ?? 0

    // Drop ops that have exceeded max retries
    if (opRetryCount >= MAX_RETRIES_PER_OP) {
      syncLog('queue:op_expired', {
        attemptId,
        table: op.table,
        action: op.action,
        entityId: typeof op.payload.id === 'string' ? op.payload.id : null,
        retryCount: opRetryCount,
        lastErrorCategory: op.lastErrorCategory,
      }, 'warn')
      continue // drop it
    }

    try {
      if (op.action === 'upsert') {
        if (op.table === 'athlete_profiles') {
          await upsertAthleteProfileRow(op.payload, op.userId)
        } else {
          const { error } = await getSupabase().from(op.table).upsert(op.payload as never)
          if (error) throw error
        }
      } else {
        const payload = op.payload as { id: string; userId?: string }
        const targetUserId = payload.userId ?? op.userId
        const { error } = await getSupabase()
          .from(op.table)
          .delete()
          .eq('id', payload.id)
          .eq('user_id', targetUserId)
        if (error) throw error
        if (op.table === 'sessions') {
          clearSessionDeleteTombstone(op.userId, payload.id)
        }
      }
    } catch (error) {
      const errorInfo = classifySyncError(error, op.table)

      syncLog('queue:op_failed', {
        attemptId,
        table: op.table,
        action: op.action,
        entityId: typeof op.payload.id === 'string' ? op.payload.id : null,
        errorCategory: errorInfo.category,
        retriable: errorInfo.retriable,
        autoRepairable: errorInfo.autoRepairable,
        retryCount: opRetryCount,
        technicalMessage: errorInfo.technicalMessage,
      }, 'warn')

      // Non-retriable errors: drop the op permanently
      if (!errorInfo.retriable && !errorInfo.autoRepairable) {
        syncLog('queue:op_dropped', {
          attemptId,
          table: op.table,
          reason: errorInfo.category,
          technicalMessage: errorInfo.technicalMessage,
        }, 'warn')
        lastFailureInfo = errorInfo
        continue
      }

      // Auto-repairable: attempt repair inline for athlete_profiles duplicates
      if (errorInfo.autoRepairable && op.table === 'athlete_profiles') {
        try {
          syncStoreState().setSyncDetails({ autoRepairInProgress: true })
          const remoteRows = await fetchAthleteProfileRows(op.userId)
          if (remoteRows.length > 1) {
            const profileRow = toAthleteProfileSyncRow(op.payload)
            await repairRemoteAthleteProfileRows(op.userId, remoteRows, profileRow)
            syncLog('queue:op_repaired', {
              attemptId,
              table: op.table,
              repairedDuplicates: remoteRows.length,
            })
            syncStoreState().setSyncDetails({
              autoRepairInProgress: false,
              lastAutoRepairAt: Date.now(),
            })
            continue // repaired successfully, op consumed
          }
          syncStoreState().setSyncDetails({ autoRepairInProgress: false })
        } catch (repairError) {
          syncLog('queue:repair_failed', {
            attemptId,
            table: op.table,
            repairError: repairError instanceof Error ? repairError.message : String(repairError),
          }, 'error')
          syncStoreState().setSyncDetails({ autoRepairInProgress: false })
        }
      }

      // Retriable: keep in queue with incremented retry count
      remaining.push({
        ...op,
        retryCount: opRetryCount + 1,
        lastErrorCategory: errorInfo.category,
      })
      lastFailureInfo = errorInfo
      // IMPORTANT: continue processing other ops instead of breaking
    }
  }

  saveQueue([...otherUsersQueue, ...remaining])

  if (remaining.length === 0 && initialCount > 0) {
    markSyncRecovered()
  } else if (remaining.length === 0) {
    markSyncHealthy()
  } else if (lastFailureInfo) {
    applySyncFailure(
      lastFailureInfo.originalError,
      lastFailureInfo.userMessage,
      remaining[0]?.table ?? null,
    )
  }
  return remaining.length === 0
  })()

  try {
    return await activeDrainQueuePromise
  } finally {
    activeDrainQueuePromise = null
  }
}

if (typeof window !== 'undefined') {
  refreshQueueDiagnostics()
  window.addEventListener('online', () => {
    syncStoreState().setSyncStatus('syncing')
    void runFullSync(getUserId() ?? '')
  })
  window.addEventListener('offline', () => {
    syncStoreState().setSyncStatus('offline')
  })
}

/**
 * Elimina de la cola local todas las ops que llevan más de `maxAgeMs` sin poderse enviar.
 * Evita que errores de infraestructura acumulen una cola que nunca se vacía.
 */
export function pruneStaleQueue(userId: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
  const now = Date.now()
  const queue = loadQueue()
  const pruned = queue.filter((op) => op.userId !== userId || now - op.enqueuedAt < maxAgeMs)
  if (pruned.length !== queue.length) {
    syncLog('queue:pruned', {
      prunedCount: queue.length - pruned.length,
      remainingCount: pruned.length,
    })
    saveQueue(pruned)
  }
}

export { drainQueue }

async function upsertRow(table: SupabaseTable, row: Record<string, unknown>): Promise<void> {
  if (!isEnabled()) return

  const userId = getUserId()
  if (!userId) return

  if (!navigator.onLine) {
    finishSyncAttempt('offline')
    syncStoreState().setSyncStatus('offline')
    enqueue({ userId, table, action: 'upsert', payload: row, enqueuedAt: Date.now() })
    scheduleRetry(15000)
    return
  }

  startSyncAttempt()
  try {
    if (table === 'athlete_profiles') {
      await upsertAthleteProfileRow(row, userId)
    } else {
      const { error } = await getSupabase().from(table).upsert(row as never)
      if (error) throw error
    }
    const queueDrained = await drainQueue()
    if (queueDrained) {
      syncStoreState().setSyncDetails({
        lastSuccessfulSyncAt: Date.now(),
        lastErrorAt: null,
        lastErrorMessage: null,
        lastErrorCategory: null,
        lastBlockedTable: null,
        retryScheduledAt: null,
        consecutiveFailures: 0,
      })
      finishSyncAttempt('idle')
    }
  } catch (error) {
    const errorInfo = classifySyncError(error, table)
    if (!errorInfo.retriable && !errorInfo.autoRepairable) {
      syncLog('upsertRow:non_retriable', { table, category: errorInfo.category }, 'warn')
      applySyncFailure(error, errorInfo.userMessage, table)
      return
    }
    enqueue({ userId, table, action: 'upsert', payload: row, enqueuedAt: Date.now() })
    applySyncFailure(error, errorInfo.userMessage, table)
  }
}

async function deleteRow(table: SupabaseTable, id: string): Promise<void> {
  if (!isEnabled()) return

  const userId = getUserId()
  if (!userId) return

  if (!navigator.onLine) {
    finishSyncAttempt('offline')
    syncStoreState().setSyncStatus('offline')
    if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
    enqueue({ userId, table, action: 'delete', payload: { id, userId }, enqueuedAt: Date.now() })
    scheduleRetry(15000)
    return
  }

  startSyncAttempt()
  try {
    const { error } = await getSupabase().from(table).delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
    if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
    const queueDrained = await drainQueue()
    if (queueDrained) {
      syncStoreState().setSyncDetails({
        lastSuccessfulSyncAt: Date.now(),
        lastErrorAt: null,
        lastErrorMessage: null,
        lastErrorCategory: null,
        lastBlockedTable: null,
        retryScheduledAt: null,
        consecutiveFailures: 0,
      })
      finishSyncAttempt('idle')
    }
  } catch (error) {
    const errorInfo = classifySyncError(error, table)
    if (!errorInfo.retriable && !errorInfo.autoRepairable) {
      syncLog('deleteRow:non_retriable', { table, category: errorInfo.category }, 'warn')
      applySyncFailure(error, errorInfo.userMessage, table)
      return
    }
    if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
    enqueue({ userId, table, action: 'delete', payload: { id, userId }, enqueuedAt: Date.now() })
    applySyncFailure(error, `No se pudo eliminar en sync ${table}.`, table)
  }
}

function sessionToRow(session: Session, userId: string): Record<string, unknown> {
  const { id, date, timeBlock, type, status, createdAt, updatedAt, ...rest } = session
  return {
    id,
    user_id: userId,
    date,
    time_block: timeBlock,
    type,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    data: rest,
  }
}

function rowToSession(row: Record<string, unknown>): Session {
  const data = (row.data as Record<string, unknown>) ?? {}
  return {
    id: row.id as string,
    date: row.date as string,
    timeBlock: (row.time_block ?? data.timeBlock) as Session['timeBlock'],
    type: row.type as Session['type'],
    status: row.status as Session['status'],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    ...data,
  } as Session
}

function dayLogToRow(log: DayLog, userId: string): Record<string, unknown> {
  const { id, date, updatedAt, ...rest } = log
  return {
    id,
    user_id: userId,
    date,
    updated_at: updatedAt,
    data: rest,
  }
}

function rowToDayLog(row: Record<string, unknown>): DayLog {
  const data = (row.data as Record<string, unknown>) ?? {}
  return {
    id: row.id as string,
    date: row.date as string,
    updatedAt: row.updated_at as number,
    ...data,
  } as DayLog
}

function weekSummaryToRow(summary: WeekSummary, userId: string): Record<string, unknown> {
  const { id, weekStartDate, updatedAt, ...rest } = summary
  return {
    id,
    user_id: userId,
    week_start_date: weekStartDate,
    updated_at: updatedAt ?? 0,
    data: rest,
  }
}

function rowToWeekSummary(row: Record<string, unknown>): WeekSummary {
  const data = (row.data as Record<string, unknown>) ?? {}
  return {
    id: row.id as string,
    weekStartDate: (row.week_start_date ?? data.weekStartDate) as string,
    updatedAt: (row.updated_at as number | undefined) ?? undefined,
    ...data,
  } as WeekSummary
}

function chatMessageToRow(msg: ChatMessage, userId: string): Record<string, unknown> {
  const { id, role, content, timestamp, chatSessionId, ...rest } = msg
  return {
    id,
    user_id: userId,
    chat_session_id: chatSessionId ?? null,
    role,
    content,
    timestamp,
    data: rest,
  }
}

function rowToChatMessage(row: Record<string, unknown>): ChatMessage {
  const data = (row.data as Record<string, unknown>) ?? {}
  return {
    id: row.id as string,
    role: row.role as ChatMessage['role'],
    content: row.content as string,
    timestamp: row.timestamp as number,
    chatSessionId: (row.chat_session_id as string | undefined) ?? undefined,
    ...data,
  } as ChatMessage
}

function coachProposalToRow(proposal: CoachProposal, userId: string): Record<string, unknown> {
  const { id, status, createdAt, resolvedAt, ...rest } = proposal
  const updatedAt = resolvedAt ?? createdAt
  return {
    id,
    user_id: userId,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    data: { ...rest, resolvedAt },
  }
}

function rowToCoachProposal(row: Record<string, unknown>): CoachProposal {
  const data = (row.data as Record<string, unknown>) ?? {}
  return {
    id: row.id as string,
    status: row.status as CoachProposal['status'],
    createdAt: row.created_at as number,
    ...data,
  } as CoachProposal
}

async function fetchAthleteProfileRows(userId: string): Promise<AthleteProfileSyncRow[]> {
  const { data, error } = await getSupabase()
    .from('athlete_profiles')
    .select('id, user_id, coach_memory, updated_at, data')
    .eq('user_id', userId)

  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(toAthleteProfileSyncRow)
}

async function deleteAthleteProfileRowsById(userId: string, ids: string[]): Promise<void> {
  const normalizedIds = [...new Set(ids)].filter(Boolean)
  if (normalizedIds.length === 0) return

  const { error } = await getSupabase()
    .from('athlete_profiles')
    .delete()
    .in('id', normalizedIds)
    .eq('user_id', userId)

  if (error) throw error
}

async function repairRemoteAthleteProfileRows(
  userId: string,
  rows: AthleteProfileSyncRow[],
  preferredRow?: AthleteProfileSyncRow,
): Promise<AthleteProfileSyncRow> {
  const candidates = preferredRow ? [...rows, preferredRow] : [...rows]
  const winner = coalesceAthleteProfileRows(candidates)
  const canonical: AthleteProfileSyncRow = {
    ...winner,
    user_id: userId,
  }
  const keeper = rows.find((row) => row.id === winner.id) ?? rows[0]
  const nextRow: AthleteProfileSyncRow = {
    ...canonical,
    id: keeper?.id ?? 'default',
  }

  logAthleteProfileSync('repair:start', {
    remoteRows: rows.length,
    remoteIds: rows.map((row) => row.id),
    preferredUpdatedAt: preferredRow?.updated_at ?? null,
    winnerId: winner.id,
    canonicalUpdatedAt: nextRow.updated_at,
    keeperId: nextRow.id,
  })

  if (keeper) {
    const normalized = normalizeAthleteProfilePayload(nextRow)
    const { error: updateError } = await getSupabase()
      .from('athlete_profiles')
      .update({
        coach_memory: normalized.coach_memory,
        updated_at: normalized.updated_at,
        data: normalized.data,
      } as never)
      .eq('id', keeper.id)
      .eq('user_id', userId)

    if (updateError) {
      throw new Error(classifyAthleteProfileSyncError(updateError))
    }
  } else {
    const normalized = normalizeAthleteProfilePayload(nextRow)
    const { error: insertError } = await getSupabase()
      .from('athlete_profiles')
      .insert({
        id: normalized.id,
        user_id: userId,
        coach_memory: normalized.coach_memory,
        updated_at: normalized.updated_at,
        data: normalized.data,
      } as never)

    if (insertError) {
      throw new Error(classifyAthleteProfileSyncError(insertError))
    }
  }

  const loserIds = rows
    .filter((row) => row.id !== nextRow.id)
    .map((row) => row.id)

  if (loserIds.length > 0) {
    await deleteAthleteProfileRowsById(userId, loserIds)
  }

  const repairedRows = await fetchAthleteProfileRows(userId)

  logAthleteProfileSync('repair:done', {
    remoteRowsAfterUpsert: repairedRows.length,
    deletedIds: loserIds,
  })

  return nextRow
}

/**
 * Idempotent write for athlete_profiles.
 * Strategy:
 * 1. If unique constraint on user_id exists → use upsert with onConflict
 * 2. If duplicates detected → repair first, then write
 * 3. Fallback to fetch-then-update for compatibility
 */
async function persistAthleteProfileRow(
  row: Record<string, unknown>,
  userId: string,
  remoteRows?: AthleteProfileSyncRow[],
): Promise<void> {
  const profileRow = toAthleteProfileSyncRow(row)
  const existingRows = remoteRows ?? await fetchAthleteProfileRows(userId)

  if (existingRows.length > 1) {
    await repairRemoteAthleteProfileRows(userId, existingRows, profileRow)
    return
  }

  const existingRow = existingRows[0]
  const rowToPersist = existingRow
    ? coalesceAthleteProfileRows([existingRow, profileRow])
    : profileRow

  if (!existingRow) {
    // Try upsert with onConflict first (requires unique constraint on user_id)
    const { error } = await getSupabase()
      .from('athlete_profiles')
      .upsert({
        id: rowToPersist.id,
        user_id: userId,
        coach_memory: rowToPersist.coach_memory,
        updated_at: rowToPersist.updated_at,
        data: rowToPersist.data,
      } as never, { onConflict: 'user_id' })
    if (error) throw error
    return
  }

  const { error } = await getSupabase()
    .from('athlete_profiles')
    .update({
      coach_memory: rowToPersist.coach_memory,
      updated_at: rowToPersist.updated_at,
      data: rowToPersist.data,
    } as never)
    .eq('id', existingRow.id)
    .eq('user_id', userId)

  if (error) throw error
}

async function upsertAthleteProfileRow(row: Record<string, unknown>, userId: string): Promise<void> {
  const profileRow = toAthleteProfileSyncRow(row)
  const remoteRows = await fetchAthleteProfileRows(userId)

  logAthleteProfileSync('push:attempt', {
    payloadId: profileRow.id,
    payloadUpdatedAt: profileRow.updated_at,
    remoteRows: remoteRows.length,
    remoteIds: remoteRows.map((item) => item.id),
    payloadKeys: Object.keys((profileRow.data as Record<string, unknown> | null) ?? {}),
  })

  if (remoteRows.length > 1) {
    syncStoreState().setSyncDetails({ autoRepairInProgress: true })
    try {
      await repairRemoteAthleteProfileRows(userId, remoteRows, profileRow)
    } finally {
      syncStoreState().setSyncDetails({
        autoRepairInProgress: false,
        lastAutoRepairAt: Date.now(),
      })
    }
    return
  }

  await persistAthleteProfileRow(profileRow, userId, remoteRows)
}

export async function pushSession(session: Session): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  void upsertRow('sessions', sessionToRow(session, userId))
}

export async function deleteSession(id: string): Promise<void> {
  void deleteRow('sessions', id)
}

export async function pushDayLog(log: DayLog): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  void upsertRow('day_logs', dayLogToRow(log, userId))
}

export async function pushWeekSummary(summary: WeekSummary): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  void upsertRow('week_summaries', weekSummaryToRow(summary, userId))
}

export async function pushChatMessage(msg: ChatMessage): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  void upsertRow('chat_messages', chatMessageToRow(msg, userId))
}

export async function deleteChatMessages(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await Promise.all(ids.map((id) => deleteRow('chat_messages', id)))
}

export async function deleteCoachProposals(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await Promise.all(ids.map((id) => deleteRow('coach_proposals', id)))
}

export async function pushCoachProposal(proposal: CoachProposal): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  void upsertRow('coach_proposals', coachProposalToRow(proposal, userId))
}

export async function pushAthleteProfile(profile: AthleteProfile): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  void upsertRow('athlete_profiles', athleteProfileToRow(profile, userId))
}

async function fetchAll<T>(table: SupabaseTable, userId: string): Promise<T[]> {
  const { data, error } = await getSupabase()
    .from(table)
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error(`[sync] fetch error on ${table}:`, error.message)
    throw error
  }

  return (data ?? []) as T[]
}

async function pullRemoteAndMerge(userId: string): Promise<void> {
  if (activePullAllPromise) {
    return activePullAllPromise
  }

  activePullAllPromise = (async () => {
    if (!isEnabled()) return

    const { syncDetails } = useAuthStore.getState()
    const queueDrained = await drainQueue()
    const mergeContext: MergeContext = {
      allowDeletes: queueDrained,
      deleteBeforeTs: queueDrained ? (syncDetails.lastSuccessfulSyncAt ?? null) : null,
    }

    await Promise.all([
      mergeSessions(userId, mergeContext),
      mergeDayLogs(userId, mergeContext),
      mergeWeekSummaries(userId, mergeContext),
      mergeChatMessages(userId, mergeContext),
      mergeCoachProposals(userId, mergeContext),
      mergeAthleteProfile(userId, mergeContext),
    ])
  })()

  try {
    await activePullAllPromise
  } finally {
    activePullAllPromise = null
  }
}

export async function runFullSync(userId: string): Promise<void> {
  if (!userId || !isEnabled()) return
  if (activeFullSyncPromise) {
    return activeFullSyncPromise
  }

  activeFullSyncPromise = (async () => {
    startSyncAttempt()
    const failureCountAtStart = syncStoreState().syncDetails.consecutiveFailures ?? 0

    try {
      await repairLocalNaturalKeyConflicts()
      pruneExpiredTombstones(userId)
      pruneStaleQueue(userId)
      await drainQueue()
      await pullRemoteAndMerge(userId)
      const queueDrainedAfterMerge = await drainQueue()

      if (queueDrainedAfterMerge) {
        markSyncHealthy()
      } else {
        refreshQueueDiagnostics()
        syncStoreState().setSyncStatus('error', 'Quedaron operaciones pendientes en cola.')
        syncStoreState().setSyncDetails({
          syncAttemptInFlight: false,
          lastErrorAt: Date.now(),
          lastErrorMessage: 'Quedaron operaciones pendientes en cola.',
          lastBlockedTable: syncStoreState().syncDetails.pendingTables[0] ?? null,
          retryScheduledAt: Date.now() + 15000,
          consecutiveFailures: (syncStoreState().syncDetails.consecutiveFailures ?? 0) + 1,
        })
      }
    } catch (error) {
      const errorInfo = classifySyncError(error)
      if (!errorInfo.retriable && !errorInfo.autoRepairable) {
        syncLog('runFullSync:non_retriable', { category: errorInfo.category }, 'warn')
        applySyncFailure(
          error,
          errorInfo.userMessage,
          (syncStoreState().syncDetails.pendingTables[0] as SupabaseTable | undefined) ?? null,
        )
        return
      }
      const failureCountNow = syncStoreState().syncDetails.consecutiveFailures ?? 0
      if (failureCountNow > failureCountAtStart) {
        // A lower layer (drainQueue) already recorded this failure — avoid double-counting.
        return
      }
      syncLog('runFullSync:error', { category: errorInfo.category, technicalMessage: errorInfo.technicalMessage }, 'error')
      applySyncFailure(
        error,
        'Error de sincronizacion',
        (syncStoreState().syncDetails.pendingTables[0] as SupabaseTable | undefined) ?? null,
      )
    }
  })()

  try {
    await activeFullSyncPromise
  } finally {
    activeFullSyncPromise = null
  }
}

export async function pullAll(userId: string): Promise<void> {
  await runFullSync(userId)
}

async function mergeSessions(userId: string, context: MergeContext): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('sessions', userId)
  const remoteIds = new Set<string>()
  const tombstones = getSessionDeleteTombstones(userId)

  for (const row of remoteRows) {
    const remote = rowToSession(row)
    remoteIds.add(remote.id)

    const deletedAt = tombstones[remote.id]
    if (typeof deletedAt === 'number') {
      if (deletedAt >= remote.updatedAt) {
        void deleteRow('sessions', remote.id)
        continue
      }
      clearSessionDeleteTombstone(userId, remote.id)
    }

    const local = await db.sessions.get(remote.id)
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.sessions.put(remote)
    } else if (local.updatedAt > remote.updatedAt) {
      void pushSession(local)
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.sessions,
      remoteIds,
      (session: Session) => session.updatedAt,
      context.deleteBeforeTs,
    )
  }

  pruneSessionDeleteTombstones(userId, remoteIds)
}

async function mergeDayLogs(userId: string, context: MergeContext): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('day_logs', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToDayLog(row)
    const localById = await db.dayLogs.get(remote.id)
    const localByDate = localById ?? await findDayLogConflictByDate(remote.date)
    const resolution = resolveDayLogConflict(localByDate, remote)

    remoteIds.add(remote.id)
    remoteIds.add(resolution.winner.id)

    if (!localByDate) {
      await db.dayLogs.put(resolution.winner)
      continue
    }

    if (resolution.winner.id !== localByDate.id) {
      await db.dayLogs.delete(localByDate.id)
      await db.dayLogs.put(resolution.winner)
      if (resolution.winner.id !== remote.id) {
        void deleteRow('day_logs', remote.id)
        void pushDayLog(resolution.winner)
      }
      continue
    }

    if (resolution.winner === remote) {
      await db.dayLogs.put(remote)
    } else if (resolution.winner.updatedAt > remote.updatedAt) {
      void pushDayLog(resolution.winner)
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.dayLogs,
      remoteIds,
      (dayLog: DayLog) => dayLog.updatedAt,
      context.deleteBeforeTs,
    )
  }
}

async function mergeWeekSummaries(userId: string, context: MergeContext): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('week_summaries', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToWeekSummary(row)
    const remoteUpdatedAt = (row.updated_at as number) ?? 0
    const localById = await db.weekSummaries.get(remote.id)
    const localByWeek = localById ?? await findWeekSummaryConflictByWeekStart(remote.weekStartDate)
    const resolution = resolveWeekSummaryConflict(localByWeek, remote, remoteUpdatedAt)

    remoteIds.add(remote.id)
    remoteIds.add(resolution.winner.id)

    if (!localByWeek) {
      await db.weekSummaries.put(resolution.winner)
      continue
    }

    if (resolution.winner.id !== localByWeek.id) {
      await db.weekSummaries.delete(localByWeek.id)
      await db.weekSummaries.put(resolution.winner)
      if (resolution.winner.id !== remote.id) {
        void deleteRow('week_summaries', remote.id)
        void pushWeekSummary(resolution.winner)
      }
      continue
    }

    const winnerUpdatedAt = getWeekSummaryUpdatedAt(resolution.winner)

    if (resolution.winner === remote) {
      await db.weekSummaries.put(remote)
    } else if (winnerUpdatedAt > remoteUpdatedAt) {
      void pushWeekSummary(resolution.winner)
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.weekSummaries,
      remoteIds,
      (summary: WeekSummary) => ((summary as unknown as { updatedAt?: number }).updatedAt) ?? null,
      context.deleteBeforeTs,
    )
  }
}

async function mergeChatMessages(userId: string, context: MergeContext): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('chat_messages', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToChatMessage(row)
    remoteIds.add(remote.id)

    const local = await db.chatMessages.get(remote.id)
    if (!local) {
      await db.chatMessages.put(remote)
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.chatMessages,
      remoteIds,
      (message: ChatMessage) => message.timestamp,
      context.deleteBeforeTs,
    )
  }
}

async function mergeCoachProposals(userId: string, context: MergeContext): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('coach_proposals', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToCoachProposal(row)
    remoteIds.add(remote.id)

    const remoteUpdatedAt = (row.updated_at as number) ?? 0
    const local = await db.coachProposals.get(remote.id)
    const localUpdatedAt = local?.resolvedAt ?? local?.createdAt ?? 0

    if (!local || remoteUpdatedAt > localUpdatedAt) {
      await db.coachProposals.put(remote)
    } else if (localUpdatedAt > remoteUpdatedAt) {
      void pushCoachProposal(local)
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.coachProposals,
      remoteIds,
      (proposal: CoachProposal) => proposal.resolvedAt ?? proposal.createdAt,
      context.deleteBeforeTs,
    )
  }
}

async function mergeAthleteProfile(userId: string, context: MergeContext): Promise<void> {
  let remoteRows: AthleteProfileSyncRow[]
  try {
    remoteRows = await fetchAthleteProfileRows(userId)
  } catch (error) {
    throw new Error(classifyAthleteProfileSyncError(error))
  }

  if (remoteRows.length > 1) {
    const localPreferred = await db.athleteProfiles.get('default')
    const preferredRow = localPreferred
      ? toAthleteProfileSyncRow(athleteProfileToRow(localPreferred, userId))
      : undefined

    await repairRemoteAthleteProfileRows(userId, remoteRows, preferredRow)
    remoteRows = await fetchAthleteProfileRows(userId)
  }

  if (remoteRows.length === 0) {
    if (context.allowDeletes && context.deleteBeforeTs != null) {
      const local = await db.athleteProfiles.get('default')
      if (local && local.updatedAt <= context.deleteBeforeTs) {
        await db.athleteProfiles.clear()
      }
    }
    return
  }

  const canonicalRow = coalesceAthleteProfileRows(remoteRows)
  const local = await db.athleteProfiles.get('default')
  const localRow = local ? toAthleteProfileSyncRow(athleteProfileToRow(local, userId)) : null
  const mergedRow = localRow ? coalesceAthleteProfileRows([localRow, canonicalRow]) : canonicalRow
  const mergedProfile = rowToAthleteProfile(mergedRow)

  if (!localRow || !athleteProfileRowsEqual(localRow, mergedRow)) {
    await db.athleteProfiles.put({ ...mergedProfile, id: 'default' })
  }

  if (!athleteProfileRowsEqual(canonicalRow, mergedRow)) {
    void pushAthleteProfile(mergedProfile)
  }
}

async function deleteMissingLocalRows<T extends { id: string }>(
  table: { toArray: () => Promise<T[]>; bulkDelete: (keys: string[]) => Promise<void> },
  remoteIds: Set<string>,
  getLocalUpdatedAt: (row: T) => number | null | undefined,
  deleteBeforeTs: number | null,
): Promise<void> {
  if (deleteBeforeTs == null) {
    return
  }

  const localRows = await table.toArray()
  const idsToDelete = localRows
    .filter((row) => {
      if (remoteIds.has(row.id)) return false

      const localUpdatedAt = getLocalUpdatedAt(row)
      if (typeof localUpdatedAt !== 'number' || Number.isNaN(localUpdatedAt)) {
        return false
      }

      return localUpdatedAt <= deleteBeforeTs
    })
    .map((row) => row.id)

  if (idsToDelete.length > 0) {
    await table.bulkDelete(idsToDelete)
  }
}

async function findDayLogConflictByDate(date: string): Promise<DayLog | undefined> {
  return db.dayLogs.where('date').equals(date).first()
}

async function findWeekSummaryConflictByWeekStart(weekStartDate: string): Promise<WeekSummary | undefined> {
  return db.weekSummaries.where('weekStartDate').equals(weekStartDate).first()
}

function resolveDayLogConflict(local: DayLog | undefined, remote: DayLog): MergeResolution<DayLog> {
  if (!local) {
    return { winner: remote }
  }

  if (remote.updatedAt > local.updatedAt) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  if (local.updatedAt > remote.updatedAt) {
    return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
  }

  if (scoreEntityData(remote) > scoreEntityData(local)) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
}

function resolveWeekSummaryConflict(
  local: WeekSummary | undefined,
  remote: WeekSummary,
  remoteUpdatedAt: number,
): MergeResolution<WeekSummary> {
  if (!local) {
    return { winner: remote }
  }

  const localUpdatedAt = getWeekSummaryUpdatedAt(local)
  if (remoteUpdatedAt > localUpdatedAt) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  if (localUpdatedAt > remoteUpdatedAt) {
    return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
  }

  if (scoreEntityData(remote) > scoreEntityData(local)) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
}

async function repairLocalNaturalKeyConflicts(): Promise<void> {
  await Promise.all([
    repairLocalDayLogConflicts(),
    repairLocalWeekSummaryConflicts(),
  ])
}

async function repairLocalDayLogConflicts(): Promise<void> {
  const rows = await db.dayLogs.toArray()
  const groups = groupRowsBy(rows, (row) => row.date)

  for (const duplicates of groups.values()) {
    if (duplicates.length <= 1) continue
    const sorted = [...duplicates].sort(compareDayLogsForRepair)
    const winner = sorted[0]
    const loserIds = sorted.slice(1).map((row) => row.id)
    if (loserIds.length > 0) {
      await db.dayLogs.bulkDelete(loserIds)
      void pushDayLog(winner)
    }
  }
}

async function repairLocalWeekSummaryConflicts(): Promise<void> {
  const rows = await db.weekSummaries.toArray()
  const groups = groupRowsBy(rows, (row) => row.weekStartDate)

  for (const duplicates of groups.values()) {
    if (duplicates.length <= 1) continue
    const sorted = [...duplicates].sort(compareWeekSummariesForRepair)
    const winner = sorted[0]
    const loserIds = sorted.slice(1).map((row) => row.id)
    if (loserIds.length > 0) {
      await db.weekSummaries.bulkDelete(loserIds)
      void pushWeekSummary(winner)
    }
  }
}

function compareDayLogsForRepair(a: DayLog, b: DayLog): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return scoreEntityData(b) - scoreEntityData(a)
}

function compareWeekSummariesForRepair(a: WeekSummary, b: WeekSummary): number {
  const aUpdatedAt = getWeekSummaryUpdatedAt(a)
  const bUpdatedAt = getWeekSummaryUpdatedAt(b)
  if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt
  return scoreEntityData(b) - scoreEntityData(a)
}

function getWeekSummaryUpdatedAt(summary: WeekSummary): number {
  return summary.updatedAt ?? 0
}

function groupRowsBy<T>(rows: T[], getKey: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()

  for (const row of rows) {
    const key = getKey(row)
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }

  return groups
}

function getSessionDeleteTombstones(userId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(SESSION_DELETE_TOMBSTONES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Record<string, number>>
    const value = parsed?.[userId]
    if (!value || typeof value !== 'object') return {}
    const now = Date.now()
    // Filter out malformed entries and TTL-expired tombstones (older than 90 days)
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, deletedAt]) =>
          typeof deletedAt === 'number' &&
          Number.isFinite(deletedAt) &&
          now - deletedAt < TOMBSTONE_TTL_MS,
      ),
    )
  } catch {
    return {}
  }
}

/** Remove tombstones older than TOMBSTONE_TTL_MS from localStorage for a user. */
function pruneExpiredTombstones(userId: string): void {
  try {
    const raw = localStorage.getItem(SESSION_DELETE_TOMBSTONES_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, Record<string, number>>
    const userTombstones = parsed[userId]
    if (!userTombstones) return

    const now = Date.now()
    const pruned = Object.fromEntries(
      Object.entries(userTombstones).filter(
        ([, deletedAt]) => now - deletedAt < TOMBSTONE_TTL_MS,
      ),
    )

    if (Object.keys(pruned).length !== Object.keys(userTombstones).length) {
      parsed[userId] = pruned
      if (Object.keys(pruned).length === 0) delete parsed[userId]
      localStorage.setItem(SESSION_DELETE_TOMBSTONES_KEY, JSON.stringify(parsed))
    }
  } catch {
    // Ignore storage failures
  }
}

function saveSessionDeleteTombstones(userId: string, tombstones: Record<string, number>): void {
  try {
    const raw = localStorage.getItem(SESSION_DELETE_TOMBSTONES_KEY)
    const parsed = raw ? JSON.parse(raw) as Record<string, Record<string, number>> : {}
    const next = { ...parsed, [userId]: tombstones }
    if (Object.keys(tombstones).length === 0) {
      delete next[userId]
    }
    localStorage.setItem(SESSION_DELETE_TOMBSTONES_KEY, JSON.stringify(next))
  } catch {
    // Ignore storage failures.
  }
}

function clearSyncArtifactsForUser(userId: string): void {
  try {
    const queue = loadQueue().filter((op) => op.userId !== userId)
    saveQueue(queue)
  } catch {
    // Ignore storage failures.
  }

  clearSessionDeleteTombstoneGroup(userId)
  localStorage.removeItem(getMigrationKey(userId))

  syncStoreState().setSyncStatus('idle')
  syncStoreState().setSyncDetails({
    pendingOps: 0,
    syncAttemptInFlight: false,
    pendingUpserts: 0,
    pendingDeletes: 0,
    oldestPendingOpAt: null,
    pendingTables: [],
    lastErrorAt: null,
    lastErrorMessage: null,
    lastErrorCategory: null,
    lastBlockedTable: null,
    retryScheduledAt: null,
    consecutiveFailures: 0,
    autoRepairInProgress: false,
    lastAutoRepairAt: null,
  })
}

export function clearSelectedSyncArtifactsForUser(
  userId: string,
  selection: { trainingData?: boolean; chatHistory?: boolean; coachProposals?: boolean; coachMemory?: boolean },
): void {
  const selectedTables = new Set<SupabaseTable>()
  if (selection.trainingData) {
    selectedTables.add('sessions')
    selectedTables.add('day_logs')
    selectedTables.add('week_summaries')
  }
  if (selection.chatHistory) {
    selectedTables.add('chat_messages')
  }
  if (selection.coachProposals) {
    selectedTables.add('coach_proposals')
  }
  if (selection.coachMemory) {
    selectedTables.add('athlete_profiles')
  }

  if (selectedTables.size === 0) return

  try {
    const queue = loadQueue().filter((op) => op.userId !== userId || !selectedTables.has(op.table))
    saveQueue(queue)
  } catch {
    // Ignore storage failures.
  }

  if (selection.trainingData) {
    clearSessionDeleteTombstoneGroup(userId)
  }
}

function clearSessionDeleteTombstoneGroup(userId: string): void {
  try {
    const raw = localStorage.getItem(SESSION_DELETE_TOMBSTONES_KEY)
    const parsed = raw ? JSON.parse(raw) as Record<string, Record<string, number>> : {}
    if (!(userId in parsed)) return
    delete parsed[userId]
    localStorage.setItem(SESSION_DELETE_TOMBSTONES_KEY, JSON.stringify(parsed))
  } catch {
    // Ignore storage failures.
  }
}

function rememberSessionDeleteTombstone(userId: string, sessionId: string): void {
  const tombstones = getSessionDeleteTombstones(userId)
  tombstones[sessionId] = Date.now()
  saveSessionDeleteTombstones(userId, tombstones)
}

function clearSessionDeleteTombstone(userId: string, sessionId: string): void {
  const tombstones = getSessionDeleteTombstones(userId)
  if (!(sessionId in tombstones)) return
  delete tombstones[sessionId]
  saveSessionDeleteTombstones(userId, tombstones)
}

function pruneSessionDeleteTombstones(userId: string, remoteIds: Set<string>): void {
  const tombstones = getSessionDeleteTombstones(userId)
  let changed = false

  for (const sessionId of Object.keys(tombstones)) {
    if (!remoteIds.has(sessionId)) {
      delete tombstones[sessionId]
      changed = true
    }
  }

  if (changed) {
    saveSessionDeleteTombstones(userId, tombstones)
  }
}

async function hasLocalAppData(): Promise<boolean> {
  const counts = await Promise.all([
    db.sessions.count(),
    db.dayLogs.count(),
    db.weekSummaries.count(),
    db.chatMessages.count(),
    db.coachProposals.count(),
    db.athleteProfiles.count(),
  ])

  return counts.some((count) => count > 0)
}

export async function prepareLocalDataForUser(userId: string): Promise<{ shouldMigrate: boolean }> {
  if (!isEnabled()) {
    return { shouldMigrate: false }
  }

  const previousUserId = localStorage.getItem(LAST_SYNC_USER_KEY)
  if (previousUserId && previousUserId !== userId) {
    await clearAllLocalAppData()
  }

  localStorage.setItem(LAST_SYNC_USER_KEY, userId)

  const shouldMigrate =
    !localStorage.getItem(getMigrationKey(userId)) &&
    await hasLocalAppData()

  return { shouldMigrate }
}

export async function migrateLocalDataToCloud(userId: string): Promise<void> {
  if (!isEnabled()) return
  if (localStorage.getItem(getMigrationKey(userId))) return

  try {
    const [sessions, dayLogs, weekSummaries, chatMessages, coachProposals, athleteProfiles] =
      await Promise.all([
        db.sessions.toArray(),
        db.dayLogs.toArray(),
        db.weekSummaries.toArray(),
        db.chatMessages.toArray(),
        db.coachProposals.toArray(),
        db.athleteProfiles.toArray(),
      ])

    const tables: AppDataExport['tables'] = {
      sessions,
      dayLogs,
      weekSummaries,
      chatMessages,
      coachProposals,
      athleteProfiles,
    }

    const sessionRows = tables.sessions.map((session) => sessionToRow(session, userId))
    const dayLogRows = tables.dayLogs.map((dayLog) => dayLogToRow(dayLog, userId))
    const weekRows = tables.weekSummaries.map((summary) => weekSummaryToRow(summary, userId))
    const chatRows = tables.chatMessages.map((message) => chatMessageToRow(message, userId))
    const proposalRows = tables.coachProposals.map((proposal) => coachProposalToRow(proposal, userId))
    const profileRows = tables.athleteProfiles.map((profile) => athleteProfileToRow(profile, userId))

    const migrationResults = await Promise.all([
      sessionRows.length > 0
        ? getSupabase().from('sessions').upsert(sessionRows as never).then((result) => ({ table: 'sessions', error: result.error }))
        : Promise.resolve({ table: 'sessions', error: null }),
      dayLogRows.length > 0
        ? getSupabase().from('day_logs').upsert(dayLogRows as never).then((result) => ({ table: 'day_logs', error: result.error }))
        : Promise.resolve({ table: 'day_logs', error: null }),
      weekRows.length > 0
        ? getSupabase().from('week_summaries').upsert(weekRows as never).then((result) => ({ table: 'week_summaries', error: result.error }))
        : Promise.resolve({ table: 'week_summaries', error: null }),
      chatRows.length > 0
        ? getSupabase().from('chat_messages').upsert(chatRows as never).then((result) => ({ table: 'chat_messages', error: result.error }))
        : Promise.resolve({ table: 'chat_messages', error: null }),
      proposalRows.length > 0
        ? getSupabase().from('coach_proposals').upsert(proposalRows as never).then((result) => ({ table: 'coach_proposals', error: result.error }))
        : Promise.resolve({ table: 'coach_proposals', error: null }),
      profileRows.length > 0
        ? persistAthleteProfileRow(profileRows[profileRows.length - 1], userId).then(() => ({ table: 'athlete_profiles', error: null }))
        : Promise.resolve({ table: 'athlete_profiles', error: null }),
    ])

    const failedTables = migrationResults.filter((result) => result.error != null)
    if (failedTables.length > 0) {
      throw new Error(`Migration partial failure: ${failedTables.map((result) => result.table).join(', ')}`)
    }

    localStorage.setItem(getMigrationKey(userId), '1')
    localStorage.setItem(LAST_SYNC_USER_KEY, userId)
    console.log('[sync] Initial migration complete')
  } catch (error) {
    applySyncFailure(error, 'No se pudo migrar los datos locales a la nube.')
    console.error('[sync] Migration failed:', error)
    throw error
  }
}

export async function clearSelectedRemoteAppData(
  userId: string,
  selection: { trainingData?: boolean; chatHistory?: boolean; coachProposals?: boolean; coachMemory?: boolean },
): Promise<void> {
  if (!isEnabled()) return

  const tableMap: Array<{ key: keyof typeof selection; table: SupabaseTable }> = [
    { key: 'trainingData', table: 'sessions' },
    { key: 'trainingData', table: 'day_logs' },
    { key: 'trainingData', table: 'week_summaries' },
    { key: 'chatHistory', table: 'chat_messages' },
    { key: 'coachProposals', table: 'coach_proposals' },
    { key: 'coachMemory', table: 'athlete_profiles' },
  ]

  const failures: string[] = []

  for (const { key, table } of tableMap) {
    if (selection[key]) {
      const { error } = await getSupabase().from(table).delete().eq('user_id', userId)
      if (error) {
        failures.push(table)
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`No se pudo borrar en la nube: ${failures.join(', ')}`)
  }
}

export async function wipeRemoteAndLocalAppData(userId: string): Promise<void> {
  if (!isEnabled()) {
    await clearAllLocalAppData()
    clearSyncArtifactsForUser(userId)
    return
  }

  const tables: SupabaseTable[] = [
    'coach_proposals',
    'chat_messages',
    'week_summaries',
    'day_logs',
    'sessions',
    'athlete_profiles',
  ]

  for (const table of tables) {
    const { error } = await getSupabase().from(table).delete().eq('user_id', userId)
    if (error) throw error
  }

  await clearAllLocalAppData()
  clearSyncArtifactsForUser(userId)
}
