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
  athleteProfileToRow,
  classifyAthleteProfileSyncError,
  compactQueue,
  pickCanonicalAthleteProfileRow,
  rowToAthleteProfile,
  scoreEntityData,
  toAthleteProfileSyncRow,
  type AthleteProfileSyncRow,
  type OfflineOp,
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

function updatePendingOps(count: number): void {
  const queue = loadQueue()
  const pendingUpserts = queue.filter((op) => op.action === 'upsert').length
  const pendingDeletes = queue.filter((op) => op.action === 'delete').length
  const oldestPendingOpAt = queue.reduce<number | null>((oldest, op) => {
    if (oldest == null) return op.enqueuedAt
    return Math.min(oldest, op.enqueuedAt)
  }, null)
  const pendingTables = [...new Set(queue.map((op) => op.table))]

  syncStoreState().setSyncDetails({
    pendingOps: count,
    pendingUpserts,
    pendingDeletes,
    oldestPendingOpAt,
    pendingTables,
  })
}

function startSyncAttempt(): void {
  syncStoreState().setSyncDetails({ syncAttemptInFlight: true })
  if (navigator.onLine) {
    syncStoreState().setSyncStatus('syncing')
  }
}

function finishSyncAttempt(status: 'idle' | 'offline' | 'error' = 'idle'): void {
  syncStoreState().setSyncDetails({ syncAttemptInFlight: false })
  syncStoreState().setSyncStatus(status)
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
  updatePendingOps(queue.length)
}

function enqueue(op: OfflineOp): void {
  const queue = compactQueue(loadQueue(), op)
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
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

function isLikelyOfflineError(error: unknown): boolean {
  if (!navigator.onLine) return true

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('offline') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

/**
 * Detecta errores NON-RETRIABLE: tablas inexistentes, schema incorrecto,
 * errores de auth/RLS o configuración de Supabase.
 * En estos casos no tiene sentido encolar ni reintentar — se descartan silenciosamente.
 */
function isInfrastructureError(error: unknown): boolean {
  const obj = error as Record<string, unknown> | null
  if (!obj) return false

  // PostgreSQL error code 42P01 = undefined_table
  if (typeof obj.code === 'string' && obj.code === '42P01') return true

  // Supabase PostgREST errors (PGRST*) — incluye tabla no encontrada, schema inválido, etc.
  if (typeof obj.code === 'string' && obj.code.startsWith('PGRST')) return true

  // HTTP 4xx de Supabase que no son recuperables
  const statusCode = typeof obj.status === 'number' ? obj.status : null
  if (statusCode === 401 || statusCode === 403 || statusCode === 404) return true

  const message = (
    (error instanceof Error ? error.message : '') +
    (typeof obj.message === 'string' ? obj.message : '') +
    (typeof obj.details === 'string' ? obj.details : '') +
    (typeof obj.hint === 'string' ? obj.hint : '')
  ).toLowerCase()

  return (
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('undefined_table') ||
    (message.includes('schema') && message.includes('not found')) ||
    message.includes('invalid api key') ||
    message.includes('jwt') ||
    message.includes('anon key') ||
    message.includes('not authorized') ||
    (message.includes('permission') && message.includes('denied')) ||
    message.includes('does not have permission')
  )
}

function getSyncErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function applySyncFailure(error: unknown, fallbackMessage: string): void {
  const message = getSyncErrorMessage(error, fallbackMessage)
  // Errores de infraestructura (tabla inexistente, schema incorrecto) no indican
  // un problema de red: mostrar 'idle' silencioso en vez de 'error' para no spamear
  // el UI con una nube roja que el usuario no puede resolver.
  const status = isInfrastructureError(error)
    ? 'idle'
    : isLikelyOfflineError(error)
      ? 'offline'
      : 'error'

  syncStoreState().setSyncStatus(status, status === 'idle' ? undefined : message)
  syncStoreState().setSyncDetails({
    syncAttemptInFlight: false,
    pendingOps: loadQueue().length,
    lastErrorAt: status !== 'idle' ? Date.now() : null,
    lastErrorMessage: status !== 'idle' ? message : null,
  })
}

function logAthleteProfileSync(event: string, details: Record<string, unknown>): void {
  console.info('[sync][athlete_profiles]', event, details)
}

async function drainQueue(): Promise<boolean> {
  if (activeDrainQueuePromise) {
    return activeDrainQueuePromise
  }

  activeDrainQueuePromise = (async () => {
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

  for (const op of currentUserQueue) {
    try {
      if (op.action === 'upsert') {
        if (op.table === 'athlete_profiles') {
          await upsertAthleteProfileRow(op.payload, op.userId)
        } else {
          const { error } = await supabase.from(op.table).upsert(op.payload as never)
          if (error) throw error
        }
      } else {
        const payload = op.payload as { id: string; userId?: string }
        const targetUserId = payload.userId ?? op.userId
        const { error } = await supabase
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
      if (isInfrastructureError(error)) {
        // Tabla inexistente u otro error de schema: descartar la op silenciosamente.
        // No tiene sentido re-encolar — seguirá fallando hasta que la infra esté lista.
        console.warn('[sync] discarding op due to infrastructure error:', op.table, error)
        continue
      }
      const fallback =
        op.table === 'athlete_profiles'
          ? classifyAthleteProfileSyncError(error)
          : 'No se pudo subir la cola pendiente.'
      applySyncFailure(error, fallback)
      remaining.push(op)
      break
    }
  }

  saveQueue([...otherUsersQueue, ...remaining])
  if (remaining.length === 0 && initialCount > 0) {
    finishSyncAttempt('idle')
    syncStoreState().setSyncDetails({
      lastRecoveredSyncAt: Date.now(),
      lastSuccessfulSyncAt: Date.now(),
      lastErrorMessage: null,
    })
  } else if (remaining.length === 0) {
    finishSyncAttempt('idle')
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
  updatePendingOps(loadQueue().length)
  window.addEventListener('online', () => {
    syncStoreState().setSyncStatus('syncing')
    void drainQueue()
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
    console.info(`[sync] pruned ${queue.length - pruned.length} stale ops from queue`)
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
    return
  }

  startSyncAttempt()
  try {
    if (table === 'athlete_profiles') {
      await upsertAthleteProfileRow(row, userId)
    } else {
      const { error } = await supabase.from(table).upsert(row as never)
      if (error) throw error
    }
    const queueDrained = await drainQueue()
    if (queueDrained) {
      syncStoreState().setSyncDetails({
        lastSuccessfulSyncAt: Date.now(),
        lastErrorAt: null,
        lastErrorMessage: null,
      })
      finishSyncAttempt('idle')
    }
  } catch (error) {
    if (isInfrastructureError(error)) {
      console.warn('[sync] upsertRow infrastructure error, skipping queue:', table, error)
      finishSyncAttempt('idle')
      return
    }
    const fallback =
      table === 'athlete_profiles'
        ? classifyAthleteProfileSyncError(error)
        : `No se pudo sincronizar ${table}.`
    enqueue({ userId, table, action: 'upsert', payload: row, enqueuedAt: Date.now() })
    applySyncFailure(error, fallback)
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
    return
  }

  startSyncAttempt()
  try {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
    if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
    const queueDrained = await drainQueue()
    if (queueDrained) {
      syncStoreState().setSyncDetails({
        lastSuccessfulSyncAt: Date.now(),
        lastErrorAt: null,
        lastErrorMessage: null,
      })
      finishSyncAttempt('idle')
    }
  } catch (error) {
    if (isInfrastructureError(error)) {
      console.warn('[sync] deleteRow infrastructure error, skipping queue:', table, error)
      finishSyncAttempt('idle')
      return
    }
    if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
    enqueue({ userId, table, action: 'delete', payload: { id, userId }, enqueuedAt: Date.now() })
    applySyncFailure(error, `No se pudo eliminar en sync ${table}.`)
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
  const { id, weekStartDate, ...rest } = summary
  const updatedAt = (rest as Record<string, unknown>).updatedAt ?? Date.now()
  return {
    id,
    user_id: userId,
    week_start_date: weekStartDate,
    updated_at: updatedAt,
    data: rest,
  }
}

function rowToWeekSummary(row: Record<string, unknown>): WeekSummary {
  const data = (row.data as Record<string, unknown>) ?? {}
  return {
    id: row.id as string,
    weekStartDate: (row.week_start_date ?? data.weekStartDate) as string,
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
  const { data, error } = await supabase
    .from('athlete_profiles')
    .select('id, user_id, coach_memory, updated_at, data')
    .eq('user_id', userId)

  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(toAthleteProfileSyncRow)
}

async function deleteAthleteProfileRowsById(userId: string, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].filter(Boolean)) {
    const { error } = await supabase
      .from('athlete_profiles')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) throw error
  }
}

async function repairRemoteAthleteProfileRows(
  userId: string,
  rows: AthleteProfileSyncRow[],
  preferredRow?: AthleteProfileSyncRow,
): Promise<AthleteProfileSyncRow> {
  const candidates = preferredRow ? [...rows, preferredRow] : [...rows]
  const winner = pickCanonicalAthleteProfileRow(candidates)
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
    const { error: updateError } = await supabase
      .from('athlete_profiles')
      .update({
        coach_memory: nextRow.coach_memory,
        updated_at: nextRow.updated_at,
        data: nextRow.data,
      } as never)
      .eq('id', keeper.id)
      .eq('user_id', userId)

    if (updateError) {
      throw new Error(classifyAthleteProfileSyncError(updateError))
    }
  } else {
    const { error: insertError } = await supabase
      .from('athlete_profiles')
      .insert({
        id: nextRow.id,
        user_id: userId,
        coach_memory: nextRow.coach_memory,
        updated_at: nextRow.updated_at,
        data: nextRow.data,
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

  if (!existingRow) {
    const { error } = await supabase.from('athlete_profiles').insert(profileRow as never)
    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('athlete_profiles')
    .update({
      coach_memory: profileRow.coach_memory,
      updated_at: profileRow.updated_at,
      data: profileRow.data,
    } as never)
    .eq('id', existingRow.id)
    .eq('user_id', userId)

  if (error) throw error
}

async function upsertAthleteProfileRow(row: Record<string, unknown>, userId: string): Promise<void> {
  try {
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
      await repairRemoteAthleteProfileRows(userId, remoteRows, profileRow)
      return
    }

    await persistAthleteProfileRow(profileRow, userId, remoteRows)
  } catch (error) {
    throw new Error(classifyAthleteProfileSyncError(error))
  }
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

  for (const id of ids) {
    void deleteRow('chat_messages', id)
  }
}

export async function deleteCoachProposals(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  for (const id of ids) {
    void deleteRow('coach_proposals', id)
  }
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
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error(`[sync] fetch error on ${table}:`, error.message)
    throw error
  }

  return (data ?? []) as T[]
}

export async function pullAll(userId: string): Promise<void> {
  if (activePullAllPromise) {
    return activePullAllPromise
  }

  activePullAllPromise = (async () => {
  if (!isEnabled()) return

  const { setSyncStatus, setSyncDetails, syncDetails } = useAuthStore.getState()
  const startedAt = Date.now()
  setSyncStatus('syncing')
  setSyncDetails({ lastSyncAt: startedAt, syncAttemptInFlight: true })

  try {
    await repairLocalNaturalKeyConflicts()
    pruneExpiredTombstones(userId)
    pruneStaleQueue(userId)

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

    setSyncStatus('idle')
    setSyncDetails({
      syncAttemptInFlight: false,
      pendingOps: loadQueue().length,
      lastSuccessfulSyncAt: Date.now(),
      lastErrorAt: null,
      lastErrorMessage: null,
      ...(queueDrained ? {} : { lastErrorMessage: 'Quedaron operaciones pendientes en cola.' }),
    })
  } catch (error) {
    if (isInfrastructureError(error)) {
      console.warn('[sync] pullAll infrastructure error (tables not ready), skipping:', error)
      setSyncStatus('idle')
      setSyncDetails({ syncAttemptInFlight: false, pendingOps: 0 })
      return
    }
    console.error('[sync] pullAll error:', error)
    applySyncFailure(error, 'Error de sincronizacion')
  }
  })()

  try {
    await activePullAllPromise
  } finally {
    activePullAllPromise = null
  }
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

  const canonicalRow = pickCanonicalAthleteProfileRow(remoteRows)
  const remote = rowToAthleteProfile(canonicalRow)
  const remoteUpdatedAt = canonicalRow.updated_at ?? 0
  const local = await db.athleteProfiles.get('default')

  if (!local || remoteUpdatedAt > local.updatedAt) {
    await db.athleteProfiles.put({ ...remote, id: 'default' })
  } else if (local.updatedAt > remoteUpdatedAt) {
    void pushAthleteProfile(local)
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
  return ((summary as unknown as { updatedAt?: number }).updatedAt) ?? 0
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
  })
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

    await Promise.all([
      sessionRows.length > 0 && supabase.from('sessions').upsert(sessionRows as never),
      dayLogRows.length > 0 && supabase.from('day_logs').upsert(dayLogRows as never),
      weekRows.length > 0 && supabase.from('week_summaries').upsert(weekRows as never),
      chatRows.length > 0 && supabase.from('chat_messages').upsert(chatRows as never),
      proposalRows.length > 0 && supabase.from('coach_proposals').upsert(proposalRows as never),
      profileRows.length > 0 && persistAthleteProfileRow(profileRows[profileRows.length - 1], userId),
    ])

    localStorage.setItem(getMigrationKey(userId), '1')
    localStorage.setItem(LAST_SYNC_USER_KEY, userId)
    console.log('[sync] Initial migration complete')
  } catch (error) {
    console.error('[sync] Migration failed:', error)
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
    const { error } = await supabase.from(table).delete().eq('user_id', userId)
    if (error) throw error
  }

  await clearAllLocalAppData()
  clearSyncArtifactsForUser(userId)
}
