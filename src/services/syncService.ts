/**
 * Sync layer between local Dexie and Supabase.
 *
 * Strategy:
 * - UI always reads from Dexie.
 * - Local writes trigger fire-and-forget pushes to Supabase.
 * - After auth, runFullSync() drains queue, merges remote data into Dexie (LWW) and re-drains.
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
import type { TrainingPlan, TrainingPlanWeek } from '../types/planBuilder'
import { clearAllLocalAppData } from './appMaintenance'
import {
  athleteProfileRowsEqual,
  athleteProfileToRow,
  classifyAthleteProfileSyncError,
  classifySyncError,
  coalesceAthleteProfileRows,
  compactQueue,
  createAthleteProfileFullResetRow,
  getAthleteProfileFullResetAt,
  getOfflineOpEntityId,
  getSyncErrorMessage,
  isAthleteProfileFullResetRow,
  normalizeAthleteProfilePayload,
  rowToAthleteProfile,
  toAthleteProfileSyncRow,
  MAX_RETRIES_PER_OP,
  type AthleteProfileSyncRow,
  type OfflineOp,
  type SyncErrorCategory,
  type SyncErrorInfo,
  type SupabaseTable,
} from './syncUtils'
import {
  computeTierHealthMap,
  recordSyncError,
  trackSyncEvent,
} from './syncDiagnostics'
import { ENTITY_TIER, type SyncTier } from '../types/syncDiagnostics'
const QUEUE_KEY = 'entrenador_sync_queue_v1'
const LAST_SYNC_USER_KEY = 'entrenador_sync_user_v1'
const MIGRATION_KEY_PREFIX = 'entrenador_migrated_v1'
const INITIAL_PULL_KEY_PREFIX = 'entrenador_initial_pull_v1'
const REMOTE_WIPE_KEY = 'entrenador_remote_wipe_v1'
const REMOTE_FULL_RESET_ACK_KEY_PREFIX = 'entrenador_remote_reset_ack_v1'
const PROFILE_RESET_LOCK_KEY = 'entrenador_profile_reset_lock_v1'
const SESSION_DELETE_TOMBSTONES_KEY = 'entrenador_sync_session_tombstones_v1'
const ATHLETE_PROFILE_WRITE_MODE_KEY = '__athleteProfileWriteMode'
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000 // 180 days (extended from 90d as part of sync hardening)
const MAX_QUEUE_SIZE = 500
const FETCH_PAGE_SIZE = 1000
/** Timeout máximo para un request directo a Supabase (upsert/delete/fetch). Evita que un request colgado bloquee drainQueue indefinidamente. */
const DIRECT_REQUEST_TIMEOUT_MS = 15_000

export type AthleteProfileWriteSource = 'automatic' | 'post_reset_onboarding'

type AthleteProfilePersistMode = 'normal' | 'technical_marker' | 'post_reset_onboarding'
type ProfileResetLockStatus = 'pending_remote_wipe' | 'awaiting_bootstrap_ack' | 'awaiting_onboarding_recreation' | 'released'

interface ProfileResetLockEntry {
  resetAt: number
  status: ProfileResetLockStatus
}

type ProfileResetLockStore = Record<string, ProfileResetLockEntry>

// Max retries por tier. Tier C (chat/coach) se dropea rápido para no consumir presupuesto
// de fiabilidad del core.
const MAX_RETRIES_BY_TIER: Record<SyncTier, number> = {
  A: MAX_RETRIES_PER_OP,
  B: MAX_RETRIES_PER_OP,
  C: 2,
}

const TIER_ORDER: Record<SyncTier, number> = { A: 0, B: 1, C: 2 }

// Backoff exponencial con jitter: 5s, 15s, 45s, 120s, 300s (topado en 300s).
// Reemplaza los pasos fijos 15/30/60s. El jitter evita hammer sincronizado cuando múltiples
// tabs/devices vuelven online al mismo tiempo.
const RETRY_BACKOFF_STEPS_MS = [5_000, 15_000, 45_000, 120_000, 300_000]
const RETRY_JITTER_MAX_MS = 1_000

function computeRetryDelayMs(failureCount: number): number {
  const index = Math.min(Math.max(failureCount - 1, 0), RETRY_BACKOFF_STEPS_MS.length - 1)
  const base = RETRY_BACKOFF_STEPS_MS[index]
  const jitter = Math.floor(Math.random() * RETRY_JITTER_MAX_MS)
  return base + jitter
}

function sortQueueByTier(ops: OfflineOp[]): OfflineOp[] {
  return [...ops].sort((a, b) => {
    const ta = TIER_ORDER[ENTITY_TIER[a.table] ?? 'C']
    const tb = TIER_ORDER[ENTITY_TIER[b.table] ?? 'C']
    return ta - tb
  })
}

function getMaxRetriesForTable(table: SupabaseTable): number {
  const tier = ENTITY_TIER[table] ?? 'C'
  return MAX_RETRIES_BY_TIER[tier]
}

/**
 * Envuelve una promesa con un timeout que rechaza si no resuelve a tiempo.
 * El error lanzado es clasificable como network_error por classifySyncError.
 */
async function withRequestTimeout<T>(
  source: PromiseLike<T>,
  label: string,
  timeoutMs = DIRECT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(Object.assign(new Error(`Sync request timeout after ${timeoutMs}ms: ${label}`), {
        name: 'SyncRequestTimeoutError',
      }))
    }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve(source), timeoutPromise])
  } finally {
    if (timeoutHandle != null) clearTimeout(timeoutHandle)
  }
}

interface PendingRemoteWipeEntry {
  tables: SupabaseTable[]
  requestedAt: number
  fullReset?: boolean
}

type PendingRemoteWipeStore = Record<string, PendingRemoteWipeEntry>

const REMOTE_WIPE_ORDER: SupabaseTable[] = [
  'training_plan_weeks',
  'training_plans',
  'coach_proposals',
  'chat_messages',
  'week_summaries',
  'day_logs',
  'sessions',
  'athlete_profiles',
]

function getInitialPullKey(userId: string): string {
  return `${INITIAL_PULL_KEY_PREFIX}:${userId}`
}

function getRemoteFullResetAckKey(userId: string): string {
  return `${REMOTE_FULL_RESET_ACK_KEY_PREFIX}:${userId}`
}

function loadProfileResetLockStore(): ProfileResetLockStore {
  try {
    const raw = localStorage.getItem(PROFILE_RESET_LOCK_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}

    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([userId, value]) => {
        const entry = value as Partial<ProfileResetLockEntry>
        const resetAt = typeof entry.resetAt === 'number' && Number.isFinite(entry.resetAt) ? entry.resetAt : null
        const status = typeof entry.status === 'string' ? entry.status as ProfileResetLockStatus : null
        if (resetAt == null || status == null) return null
        return [userId, { resetAt, status }] as const
      })
      .filter((entry): entry is readonly [string, ProfileResetLockEntry] => entry != null)

    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

function saveProfileResetLockStore(store: ProfileResetLockStore): void {
  try {
    localStorage.setItem(PROFILE_RESET_LOCK_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage failures.
  }
}

function isProfileResetLockActive(
  entry: ProfileResetLockEntry | null | undefined,
): entry is ProfileResetLockEntry {
  return Boolean(entry && entry.status !== 'released')
}

function isAwaitingProfileRecreationStatus(status: ProfileResetLockStatus | null | undefined): boolean {
  return status === 'awaiting_bootstrap_ack' || status === 'awaiting_onboarding_recreation'
}

function getProfileResetLock(userId: string): ProfileResetLockEntry | null {
  const store = loadProfileResetLockStore()
  const entry = store[userId]
  return isProfileResetLockActive(entry) ? entry : null
}

function syncProfileResetLockFlag(userId: string): void {
  if (getUserId() !== userId) return
  syncStoreState().setSyncDetails({
    awaitingProfileRecreationAfterReset: isAwaitingAthleteProfileRecreationAfterReset(userId),
  })
}

function setProfileResetLock(userId: string, entry: ProfileResetLockEntry): void {
  const store = loadProfileResetLockStore()
  store[userId] = entry
  saveProfileResetLockStore(store)
  syncProfileResetLockFlag(userId)
}

function clearProfileResetLock(userId: string): void {
  const store = loadProfileResetLockStore()
  if (!(userId in store)) {
    syncProfileResetLockFlag(userId)
    return
  }
  delete store[userId]
  saveProfileResetLockStore(store)
  syncProfileResetLockFlag(userId)
}

function markProfileResetLockStatus(userId: string, status: ProfileResetLockStatus, resetAt?: number): void {
  const existing = getProfileResetLock(userId)
  const nextResetAt = resetAt ?? existing?.resetAt ?? Date.now()
  if (status === 'released') {
    clearProfileResetLock(userId)
    return
  }
  setProfileResetLock(userId, {
    resetAt: nextResetAt,
    status,
  })
}

function getAthleteProfileWriteSource(row: Record<string, unknown>): AthleteProfileWriteSource {
  return row[ATHLETE_PROFILE_WRITE_MODE_KEY] === 'post_reset_onboarding'
    ? 'post_reset_onboarding'
    : 'automatic'
}

function withAthleteProfileWriteSource(
  row: Record<string, unknown>,
  source: AthleteProfileWriteSource,
): Record<string, unknown> {
  if (source === 'automatic') {
    if (!(ATHLETE_PROFILE_WRITE_MODE_KEY in row)) return row
    const next = { ...row }
    delete next[ATHLETE_PROFILE_WRITE_MODE_KEY]
    return next
  }
  return {
    ...row,
    [ATHLETE_PROFILE_WRITE_MODE_KEY]: source,
  }
}

function stripAthleteProfileWriteSource(row: Record<string, unknown>): Record<string, unknown> {
  if (!(ATHLETE_PROFILE_WRITE_MODE_KEY in row)) return row
  const next = { ...row }
  delete next[ATHLETE_PROFILE_WRITE_MODE_KEY]
  return next
}

function canAthleteProfileWriteByLock(
  lock: ProfileResetLockEntry | null,
  source: AthleteProfileWriteSource,
): boolean {
  if (!isProfileResetLockActive(lock)) return true
  if (lock.status === 'pending_remote_wipe') return false
  return source === 'post_reset_onboarding'
}

export function isAwaitingAthleteProfileRecreationAfterReset(userId: string | null | undefined): boolean {
  if (!userId) return false
  const lock = getProfileResetLock(userId)
  return isProfileResetLockActive(lock) && isAwaitingProfileRecreationStatus(lock.status)
}

export function getProfileResetLockState(userId: string | null | undefined): ProfileResetLockEntry | null {
  if (!userId) return null
  return getProfileResetLock(userId)
}

export function canWriteAthleteProfileLocally(
  source: AthleteProfileWriteSource = 'automatic',
  userId = getUserId(),
): boolean {
  if (!userId) return true
  if (hasPendingRemoteWipeForTable(userId, 'athlete_profiles')) return false
  return canAthleteProfileWriteByLock(getProfileResetLock(userId), source)
}

export function hasInitialRemotePullCompleted(userId: string | null | undefined): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(getInitialPullKey(userId)) === '1'
  } catch {
    return false
  }
}

function markInitialRemotePullComplete(userId: string): void {
  try {
    localStorage.setItem(getInitialPullKey(userId), '1')
  } catch {
    // Ignore storage failures — a subsequent successful pull will retry.
  }
}

function clearInitialRemotePull(userId: string): void {
  try {
    localStorage.removeItem(getInitialPullKey(userId))
  } catch {
    // Ignore storage failures.
  }
}

function getAcknowledgedRemoteFullResetAt(userId: string): number | null {
  try {
    const raw = localStorage.getItem(getRemoteFullResetAckKey(userId))
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function acknowledgeRemoteFullReset(userId: string, resetAt: number): void {
  try {
    localStorage.setItem(getRemoteFullResetAckKey(userId), String(resetAt))
    localStorage.setItem(getMigrationKey(userId), '1')
    localStorage.setItem(LAST_SYNC_USER_KEY, userId)
  } catch {
    // Ignore storage failures.
  }
}

function loadPendingRemoteWipeStore(): PendingRemoteWipeStore {
  try {
    const raw = localStorage.getItem(REMOTE_WIPE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}

    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => {
        if (!value || typeof value !== 'object') return false
        const entry = value as PendingRemoteWipeEntry
        return Array.isArray(entry.tables) && typeof entry.requestedAt === 'number'
      })
      .map(([userId, value]) => {
        const entry = value as PendingRemoteWipeEntry
        const validTables = entry.tables.filter((table): table is SupabaseTable => REMOTE_WIPE_ORDER.includes(table as SupabaseTable))
        return [userId, { tables: validTables, requestedAt: entry.requestedAt, fullReset: entry.fullReset === true }] as const
      })

    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

function savePendingRemoteWipeStore(store: PendingRemoteWipeStore): void {
  try {
    localStorage.setItem(REMOTE_WIPE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage failures.
  }
}

function getPendingRemoteWipeEntry(userId: string): PendingRemoteWipeEntry | null {
  const store = loadPendingRemoteWipeStore()
  return store[userId] ?? null
}

function isPendingRemoteWipeFullReset(userId: string): boolean {
  return getPendingRemoteWipeEntry(userId)?.fullReset === true
}

function getPendingRemoteWipeTables(userId: string): Set<SupabaseTable> {
  const entry = getPendingRemoteWipeEntry(userId)
  return new Set(entry?.tables ?? [])
}

function hasPendingRemoteWipeForTable(userId: string, table: SupabaseTable): boolean {
  return getPendingRemoteWipeTables(userId).has(table)
}

function registerPendingRemoteWipe(
  userId: string,
  tables: Iterable<SupabaseTable>,
  options?: { fullReset?: boolean },
): void {
  const requestedTables = [...new Set(tables)]
  if (requestedTables.length === 0) return

  const store = loadPendingRemoteWipeStore()
  const existing = store[userId]
  const mergedTables = [...new Set([...(existing?.tables ?? []), ...requestedTables])]
    .sort((a, b) => REMOTE_WIPE_ORDER.indexOf(a) - REMOTE_WIPE_ORDER.indexOf(b))

  store[userId] = {
    tables: mergedTables,
    requestedAt: existing?.requestedAt ?? Date.now(),
    fullReset: options?.fullReset === true || existing?.fullReset === true,
  }
  savePendingRemoteWipeStore(store)
}

function clearPendingRemoteWipeTables(userId: string, tables: Iterable<SupabaseTable>): void {
  const tableSet = new Set(tables)
  if (tableSet.size === 0) return

  const store = loadPendingRemoteWipeStore()
  const existing = store[userId]
  if (!existing) return

  const remainingTables = existing.tables.filter((table) => !tableSet.has(table))
  if (remainingTables.length === 0) {
    delete store[userId]
  } else {
    store[userId] = {
      ...existing,
      tables: remainingTables,
    }
  }
  savePendingRemoteWipeStore(store)
}

function clearPendingRemoteWipeState(userId: string): void {
  const store = loadPendingRemoteWipeStore()
  if (!(userId in store)) return
  delete store[userId]
  savePendingRemoteWipeStore(store)
}

function sortRemoteWipeTables(tables: Iterable<SupabaseTable>): SupabaseTable[] {
  const unique = [...new Set(tables)]
  return unique.sort((a, b) => REMOTE_WIPE_ORDER.indexOf(a) - REMOTE_WIPE_ORDER.indexOf(b))
}

function mapSelectionToRemoteTables(
  selection: { trainingData?: boolean; chatHistory?: boolean; coachProposals?: boolean; coachMemory?: boolean },
): SupabaseTable[] {
  const tables: SupabaseTable[] = []
  if (selection.trainingData) {
    tables.push('training_plan_weeks', 'training_plans', 'sessions', 'day_logs', 'week_summaries')
  }
  if (selection.coachProposals) {
    tables.push('coach_proposals')
  }
  if (selection.chatHistory) {
    tables.push('chat_messages')
  }
  if (selection.coachMemory) {
    tables.push('athlete_profiles')
  }
  return sortRemoteWipeTables(tables)
}
type ScopedPromise<T> = { userId: string; promise: Promise<T> }
let activeDrainQueuePromise: ScopedPromise<boolean> | null = null
let activePullAllPromise: ScopedPromise<void> | null = null
let activeFullSyncPromise: ScopedPromise<void> | null = null
let syncAttemptCounter = 0
const entityMutationLanes = new Map<string, Promise<void>>()
let retryTimer: ReturnType<typeof setTimeout> | null = null
const queueChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('sync-queue')
  : null

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
  pendingWrites: Array<() => Promise<unknown>>
  pendingRemoteWipeTables: Set<SupabaseTable>
}

interface MergeResolution<T extends { id: string }> {
  winner: T
  loserId?: string
}

function isSyncablePlanStatus(status: TrainingPlan['status']): boolean {
  return status === 'active' || status === 'archived'
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
  const currentDetails = syncStoreState().syncDetails
  const lastErrorEntity = (currentDetails.lastErrorEntity as SupabaseTable | null) ?? null
  const tierHealthMap = computeTierHealthMap({
    pendingTables: summary.pendingTables,
    lastErrorEntity,
  })

  syncStoreState().setSyncDetails({
    ...summary,
    tierHealthMap,
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

const ALL_HEALTHY_TIER_MAP: { A: 'healthy'; B: 'healthy'; C: 'healthy' } = {
  A: 'healthy',
  B: 'healthy',
  C: 'healthy',
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
    lastErrorEntity: null,
    retryScheduledAt: null,
    consecutiveFailures: 0,
    autoRepairInProgress: false,
    tierHealthMap: ALL_HEALTHY_TIER_MAP,
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
    lastErrorEntity: null,
    retryScheduledAt: null,
    consecutiveFailures: 0,
    autoRepairInProgress: false,
    tierHealthMap: ALL_HEALTHY_TIER_MAP,
  })
}

function scheduleRetry(ms: number): void {
  const retryAt = Date.now() + ms
  syncStoreState().setSyncDetails({ retryScheduledAt: retryAt })

  if (retryTimer != null) {
    clearTimeout(retryTimer)
  }

  retryTimer = setTimeout(() => {
    retryTimer = null
    const userId = getUserId()
    if (!userId || !navigator.onLine) return
    void runFullSync(userId)
  }, Math.max(0, retryAt - Date.now()))
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
  queueChannel?.postMessage({ type: 'queue-changed' })
}

function enqueue(op: OfflineOp): void {
  const queue = mergeConcurrentQueueOps(compactQueue(loadQueue(), op), op)
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

function mergeConcurrentQueueOps(queue: OfflineOp[], incoming: OfflineOp): OfflineOp[] {
  let merged = queue
  const latest = loadQueue()
  for (const op of latest) {
    if (shouldDropConcurrentQueueOp(op, incoming)) continue
    if (merged.some((item) => offlineOpsShareIdentity(item, op))) continue
    merged = compactQueue(merged, op)
  }
  return merged
}

function shouldDropConcurrentQueueOp(existing: OfflineOp, incoming: OfflineOp): boolean {
  return existing.userId === incoming.userId
    && existing.table === incoming.table
    && getOfflineOpEntityId(existing) === getOfflineOpEntityId(incoming)
    && getOfflineOpEntityId(incoming) != null
}

function offlineOpsShareIdentity(a: OfflineOp, b: OfflineOp): boolean {
  return a.userId === b.userId
    && a.table === b.table
    && a.action === b.action
    && a.enqueuedAt === b.enqueuedAt
    && getOfflineOpEntityId(a) === getOfflineOpEntityId(b)
}

function getEntityMutationKey(
  userId: string,
  table: SupabaseTable,
  payload: Record<string, unknown>,
): string | null {
  const entityId = typeof payload.id === 'string' && payload.id.length > 0
    ? payload.id
    : null
  if (!entityId) return null
  return `${userId}:${table}:${entityId}`
}

async function withSerializedEntityMutation<T>(
  userId: string,
  table: SupabaseTable,
  payload: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const key = getEntityMutationKey(userId, table, payload)
  if (!key) return run()

  const previous = entityMutationLanes.get(key) ?? Promise.resolve()
  let releaseCurrent!: () => void
  const currentDone = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const currentTail = previous.catch(() => undefined).then(() => currentDone)
  entityMutationLanes.set(key, currentTail)

  await previous.catch(() => undefined)

  try {
    return await run()
  } finally {
    releaseCurrent()
    void currentDone.finally(() => {
      if (entityMutationLanes.get(key) === currentTail) {
        entityMutationLanes.delete(key)
      }
    })
  }
}

function clearQueuedOpsForEntityOlderThan(
  userId: string,
  table: SupabaseTable,
  payload: Record<string, unknown>,
  cutoffEnqueuedAt: number,
): void {
  const entityId = typeof payload.id === 'string' && payload.id.length > 0
    ? payload.id
    : null
  if (!entityId) return

  const queue = loadQueue()
  const nextQueue = queue.filter((op) => {
    if (op.userId !== userId || op.table !== table) return true
    if (getOfflineOpEntityId(op) !== entityId) return true
    return op.enqueuedAt > cutoffEnqueuedAt
  })

  if (nextQueue.length !== queue.length) {
    saveQueue(nextQueue)
  }
}

function clearQueuedOpsForTables(userId: string, tables: Iterable<SupabaseTable>): void {
  const selectedTables = new Set(tables)
  if (selectedTables.size === 0) return

  try {
    const queue = loadQueue().filter((op) => op.userId !== userId || !selectedTables.has(op.table))
    saveQueue(queue)
  } catch {
    // Ignore storage failures.
  }
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


function applySyncFailure(
  error: unknown,
  fallbackMessage: string,
  blockedTable?: SupabaseTable | null,
  options?: { madeProgress?: boolean },
): void {
  const errorInfo = classifySyncError(error, (blockedTable ?? undefined) as SupabaseTable | undefined)
  const message = errorInfo.userMessage || getSyncErrorMessage(error, fallbackMessage)
  // Si la red se cayó, 'offline'. Si hubo progreso en el último drain y el error es retriable,
  // el estado es 'degraded' (sync avanza, aún quedan pendientes) en vez de 'error'.
  const status = errorInfo.category === 'network_error'
    ? 'offline' as const
    : options?.madeProgress && errorInfo.retriable
      ? 'degraded' as const
      : 'error' as const
  // QW #3: si en el último drain hubo ops que SÍ subieron (madeProgress=true), no incrementamos
  // consecutiveFailures — el sync está avanzando aunque todavía queden pendientes.
  const currentFailures = syncStoreState().syncDetails.consecutiveFailures ?? 0
  const failureCount = options?.madeProgress ? Math.max(1, currentFailures) : currentFailures + 1
  const retryMs = errorInfo.retriable ? computeRetryDelayMs(failureCount) : null

  syncLog('sync:failure', {
    errorCategory: errorInfo.category,
    retriable: errorInfo.retriable,
    autoRepairable: errorInfo.autoRepairable,
    technicalMessage: errorInfo.technicalMessage,
    blockedTable,
    failureCount,
    madeProgress: options?.madeProgress === true,
    retryMs,
  }, 'error')

  recordSyncError({
    entity: blockedTable ?? null,
    errorInfo,
    userId: getUserId(),
  })

  trackSyncEvent({
    kind: 'push',
    status: 'error',
    entity: blockedTable ?? null,
    userId: getUserId(),
    errorCategory: errorInfo.category,
    detail: errorInfo.technicalMessage,
  })

  refreshQueueDiagnostics()
  syncStoreState().setSyncStatus(status, message)
  const pendingTables = syncStoreState().syncDetails.pendingTables as SupabaseTable[]
  syncStoreState().setSyncDetails({
    syncAttemptInFlight: false,
    lastErrorAt: Date.now(),
    lastErrorMessage: message,
    lastErrorCategory: errorInfo.category,
    lastBlockedTable: blockedTable ?? null,
    lastErrorEntity: blockedTable ?? null,
    retryScheduledAt: retryMs != null ? Date.now() + retryMs : null,
    consecutiveFailures: failureCount,
    autoRepairInProgress: false,
    tierHealthMap: computeTierHealthMap({
      pendingTables,
      lastErrorEntity: blockedTable ?? null,
    }),
  })
}

function applyExpiredQueueFailure(expiredOps: OfflineOp[]): void {
  const firstExpiredOp = expiredOps[0]
  const message =
    expiredOps.length === 1
      ? 'Se descartó 1 cambio tras demasiados reintentos de sincronización.'
      : `Se descartaron ${expiredOps.length} cambios tras demasiados reintentos de sincronización.`

  syncLog(
    'queue:ops_expired_summary',
    {
      expiredCount: expiredOps.length,
      tables: [...new Set(expiredOps.map((op) => op.table))],
      firstExpiredTable: firstExpiredOp?.table ?? null,
      firstExpiredCategory: firstExpiredOp?.lastErrorCategory ?? 'unknown_error',
    },
    'error',
  )

  refreshQueueDiagnostics()
  syncStoreState().setSyncStatus('error', message)
  syncStoreState().setSyncDetails({
    syncAttemptInFlight: false,
    lastErrorAt: Date.now(),
    lastErrorMessage: message,
    lastErrorCategory: firstExpiredOp?.lastErrorCategory ?? 'unknown_error',
    lastBlockedTable: firstExpiredOp?.table ?? null,
    retryScheduledAt: null,
    consecutiveFailures: (syncStoreState().syncDetails.consecutiveFailures ?? 0) + 1,
    autoRepairInProgress: false,
  })
}

function logAthleteProfileSync(event: string, details: Record<string, unknown>): void {
  syncLog(`athlete_profiles:${event}`, details)
}

async function drainQueue(): Promise<boolean> {
  const userId = getUserId()
  if (!userId) {
    startSyncAttempt()
    finishSyncAttempt('idle')
    return loadQueue().length === 0
  }

  if (activeDrainQueuePromise && activeDrainQueuePromise.userId === userId) {
    return activeDrainQueuePromise.promise
  }

  const promise = (async () => {
  const attemptId = ++syncAttemptCounter
  startSyncAttempt()
  const queue = loadQueue()

  const otherUsersQueue = queue.filter((op) => op.userId !== userId)
  // Drain por tier: A primero (perfil/sesiones/planes), luego B, luego C (chat/coach).
  const currentUserQueue = sortQueueByTier(queue.filter((op) => op.userId === userId))
  const pendingRemoteWipeTables = getPendingRemoteWipeTables(userId)

  if (currentUserQueue.length === 0) {
    saveQueue(otherUsersQueue)
    finishSyncAttempt('idle')
    return true
  }

  const remaining: OfflineOp[] = []
  const expiredOps: OfflineOp[] = []
  const silentlyDroppedOps: OfflineOp[] = []
  const initialCount = currentUserQueue.length
  let lastFailureInfo: SyncErrorInfo | null = null

  for (const op of currentUserQueue) {
    const opRetryCount = op.retryCount ?? 0
    const athleteProfileWriteSource = op.table === 'athlete_profiles'
      ? getAthleteProfileWriteSource(op.payload)
      : 'automatic'

    if (pendingRemoteWipeTables.has(op.table)) {
      remaining.push(op)
      continue
    }

    if (op.table === 'athlete_profiles' && !canWriteAthleteProfileLocally(athleteProfileWriteSource, op.userId)) {
      if (
        athleteProfileWriteSource === 'post_reset_onboarding' &&
        hasPendingRemoteWipeForTable(op.userId, 'athlete_profiles')
      ) {
        remaining.push(op)
        continue
      }
      syncLog('queue:op_suppressed', {
        attemptId,
        table: op.table,
        action: op.action,
        source: athleteProfileWriteSource,
        reason: hasPendingRemoteWipeForTable(op.userId, 'athlete_profiles') ? 'pending_remote_wipe' : 'reset_lock',
      }, 'warn')
      silentlyDroppedOps.push(op)
      continue
    }

    // Drop ops that have exceeded max retries (Tier C: 2; A/B: MAX_RETRIES_PER_OP).
    const maxRetries = getMaxRetriesForTable(op.table)
    if (opRetryCount >= maxRetries) {
      const tier = ENTITY_TIER[op.table] ?? 'C'
      syncLog('queue:op_expired', {
        attemptId,
        table: op.table,
        tier,
        action: op.action,
        entityId: typeof op.payload.id === 'string' ? op.payload.id : null,
        retryCount: opRetryCount,
        lastErrorCategory: op.lastErrorCategory,
      }, 'warn')
      trackSyncEvent({
        kind: op.action === 'upsert' ? 'push' : 'delete',
        status: 'dropped',
        entity: op.table,
        userId: op.userId,
        errorCategory: op.lastErrorCategory ?? null,
        detail: 'max_retries_exceeded',
      })
      // Tier C: drop silencioso — no surfaceamos error al usuario (chat/coach recuperables).
      if (tier === 'C') {
        silentlyDroppedOps.push(op)
      } else {
        expiredOps.push(op)
      }
      continue
    }

    const opStartedAt = Date.now()
    try {
      await withSerializedEntityMutation(op.userId, op.table, op.payload, async () => {
        if (op.action === 'upsert') {
          if (op.table === 'athlete_profiles') {
            await withRequestTimeout(upsertAthleteProfileRow(op.payload, op.userId), `${op.table}.upsert`)
          } else {
            const { error } = await withRequestTimeout(
              getSupabase().from(op.table).upsert(op.payload as never),
              `${op.table}.upsert`,
            )
            if (error) throw error
          }
        } else {
          const payload = op.payload as { id: string; userId?: string }
          const targetUserId = payload.userId ?? op.userId
          const { error } = await withRequestTimeout(
            getSupabase()
              .from(op.table)
              .delete()
              .eq('id', payload.id)
              .eq('user_id', targetUserId),
            `${op.table}.delete`,
          )
          if (error) throw error
          if (op.table === 'sessions') {
            rememberSessionDeleteTombstone(op.userId, payload.id)
          }
        }
      })
      trackSyncEvent({
        kind: op.action === 'upsert' ? 'push' : 'delete',
        status: 'ok',
        entity: op.table,
        userId: op.userId,
        durationMs: Date.now() - opStartedAt,
        detail: 'drain',
      })
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

  if (silentlyDroppedOps.length > 0) {
    syncLog('queue:silent_drop_summary', {
      attemptId,
      droppedCount: silentlyDroppedOps.length,
      tables: [...new Set(silentlyDroppedOps.map((op) => op.table))],
    }, 'warn')
  }

  if (expiredOps.length > 0) {
    applyExpiredQueueFailure(expiredOps)
    return false
  }

  if (remaining.length === 0 && initialCount > 0) {
    markSyncRecovered()
  } else if (remaining.length === 0) {
    markSyncHealthy()
  } else if (lastFailureInfo) {
    // QW #3: si hubo progreso (algunas ops subieron pese a que otras fallaron),
    // no incrementamos el contador de fallos consecutivos — el sync está avanzando.
    const madeProgress = remaining.length < initialCount
    applySyncFailure(
      lastFailureInfo.originalError,
      lastFailureInfo.userMessage,
      remaining[0]?.table ?? null,
      { madeProgress },
    )
  }
  return remaining.length === 0
  })()

  activeDrainQueuePromise = { userId, promise }

  try {
    return await promise
  } finally {
    if (activeDrainQueuePromise?.promise === promise) {
      activeDrainQueuePromise = null
    }
  }
}

if (typeof window !== 'undefined') {
  refreshQueueDiagnostics()
  queueChannel?.addEventListener('message', () => {
    refreshQueueDiagnostics()
  })
  window.addEventListener('storage', (event) => {
    if (event.key === QUEUE_KEY) {
      refreshQueueDiagnostics()
    }
  })
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

async function upsertRow(
  table: SupabaseTable,
  row: Record<string, unknown>,
  options?: { athleteProfileWriteSource?: AthleteProfileWriteSource },
): Promise<void> {
  if (!isEnabled()) return

  const userId = getUserId()
  if (!userId) return

  const athleteProfileWriteSource = table === 'athlete_profiles'
    ? (options?.athleteProfileWriteSource ?? getAthleteProfileWriteSource(row))
    : 'automatic'
  const payload = table === 'athlete_profiles'
    ? withAthleteProfileWriteSource(stripAthleteProfileWriteSource(row), athleteProfileWriteSource)
    : row
  const requestedAt = Date.now()

  await withSerializedEntityMutation(userId, table, payload, async () => {
    if (table === 'athlete_profiles' && !canWriteAthleteProfileLocally(athleteProfileWriteSource, userId)) {
      syncLog('athlete_profiles:write_suppressed', {
        reason: hasPendingRemoteWipeForTable(userId, 'athlete_profiles') ? 'pending_remote_wipe' : 'reset_lock',
        source: athleteProfileWriteSource,
        userId,
      }, 'warn')
      return
    }

    if (hasPendingRemoteWipeForTable(userId, table)) {
      enqueue({ userId, table, action: 'upsert', payload, enqueuedAt: Date.now() })
      scheduleRetry(15000)
      return
    }

    if (!navigator.onLine) {
      finishSyncAttempt('offline')
      syncStoreState().setSyncStatus('offline')
      enqueue({ userId, table, action: 'upsert', payload, enqueuedAt: Date.now() })
      scheduleRetry(15000)
      return
    }

    startSyncAttempt()
    const upsertStartedAt = Date.now()
    try {
      if (table === 'athlete_profiles') {
        await withRequestTimeout(upsertAthleteProfileRow(payload, userId), `athlete_profiles.upsert`)
      } else {
        const { error } = await withRequestTimeout(
          getSupabase().from(table).upsert(payload as never),
          `${table}.upsert`,
        )
        if (error) throw error
      }
      clearQueuedOpsForEntityOlderThan(userId, table, payload, requestedAt)
      trackSyncEvent({
        kind: 'push',
        status: 'ok',
        entity: table,
        userId,
        durationMs: Date.now() - upsertStartedAt,
      })
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
      enqueue({ userId, table, action: 'upsert', payload, enqueuedAt: Date.now() })
      applySyncFailure(error, errorInfo.userMessage, table)
    }
  })
}

async function deleteRow(table: SupabaseTable, id: string): Promise<void> {
  if (!isEnabled()) return

  const userId = getUserId()
  if (!userId) return
  const payload = { id, userId }
  const requestedAt = Date.now()

  await withSerializedEntityMutation(userId, table, payload, async () => {
    if (hasPendingRemoteWipeForTable(userId, table)) {
      if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
      enqueue({ userId, table, action: 'delete', payload, enqueuedAt: Date.now() })
      scheduleRetry(15000)
      return
    }

    if (!navigator.onLine) {
      finishSyncAttempt('offline')
      syncStoreState().setSyncStatus('offline')
      if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
      enqueue({ userId, table, action: 'delete', payload, enqueuedAt: Date.now() })
      scheduleRetry(15000)
      return
    }

    startSyncAttempt()
    const deleteStartedAt = Date.now()
    try {
      const { error } = await withRequestTimeout(
        getSupabase().from(table).delete().eq('id', id).eq('user_id', userId),
        `${table}.delete`,
      )
      if (error) throw error
      if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
      clearQueuedOpsForEntityOlderThan(userId, table, payload, requestedAt)
      trackSyncEvent({
        kind: 'delete',
        status: 'ok',
        entity: table,
        userId,
        durationMs: Date.now() - deleteStartedAt,
      })
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
      enqueue({ userId, table, action: 'delete', payload, enqueuedAt: Date.now() })
      applySyncFailure(error, `No se pudo eliminar en sync ${table}.`, table)
    }
  })
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

function trainingPlanToRow(plan: TrainingPlan, userId: string, deletedAt?: number | null): Record<string, unknown> {
  return {
    id: plan.id,
    user_id: userId,
    athlete_id: plan.athleteId,
    goal_event_id: plan.goalEventId,
    status: plan.status,
    title: plan.title,
    start_date: plan.startDate,
    end_date: plan.endDate,
    total_weeks: plan.totalWeeks,
    phases: plan.phases,
    wizard_config: plan.wizardConfig,
    macro_snapshot: plan.macroSnapshot,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
    accepted_at: plan.acceptedAt ?? null,
    notes: plan.notes ?? null,
    generation_summary: plan.generationSummary ?? null,
    deleted_at: deletedAt ?? null,
  }
}

function rowToTrainingPlan(row: Record<string, unknown>): TrainingPlan {
  return {
    id: row.id as string,
    athleteId: row.athlete_id as string,
    goalEventId: row.goal_event_id as string,
    status: row.status as TrainingPlan['status'],
    title: row.title as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    totalWeeks: row.total_weeks as number,
    phases: (row.phases as TrainingPlan['phases']) ?? [],
    wizardConfig: row.wizard_config as TrainingPlan['wizardConfig'],
    macroSnapshot: row.macro_snapshot as TrainingPlan['macroSnapshot'],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    acceptedAt: (row.accepted_at as number | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    generationSummary: (row.generation_summary as TrainingPlan['generationSummary'] | null) ?? undefined,
  }
}

function trainingPlanWeekToRow(week: TrainingPlanWeek, userId: string, deletedAt?: number | null): Record<string, unknown> {
  return {
    id: week.id,
    user_id: userId,
    plan_id: week.planId,
    week_index: week.weekIndex,
    week_start_date: week.weekStartDate,
    phase: week.phase,
    status: week.status,
    sessions: week.sessions,
    week_objectives: week.weekObjectives,
    target_load_by_sport: week.targetLoadBySport,
    validation_issues: week.validationIssues,
    generation_meta: week.generationMeta,
    created_at: week.createdAt,
    updated_at: week.updatedAt,
    deleted_at: deletedAt ?? null,
  }
}

function rowToTrainingPlanWeek(row: Record<string, unknown>): TrainingPlanWeek {
  return {
    id: row.id as string,
    planId: row.plan_id as string,
    weekIndex: row.week_index as number,
    weekStartDate: row.week_start_date as string,
    phase: row.phase as TrainingPlanWeek['phase'],
    status: row.status as TrainingPlanWeek['status'],
    sessions: (row.sessions as TrainingPlanWeek['sessions']) ?? [],
    weekObjectives: (row.week_objectives as TrainingPlanWeek['weekObjectives']) ?? [],
    targetLoadBySport: (row.target_load_by_sport as TrainingPlanWeek['targetLoadBySport']) ?? {},
    validationIssues: (row.validation_issues as TrainingPlanWeek['validationIssues']) ?? [],
    generationMeta: (row.generation_meta as TrainingPlanWeek['generationMeta']) ?? { attempts: 0 },
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
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

async function fetchRemoteFullResetAt(userId: string): Promise<number | null> {
  const rows = await fetchAthleteProfileRows(userId)
  let latest: number | null = null

  for (const row of rows) {
    const resetAt = getAthleteProfileFullResetAt(row.data)
    if (resetAt == null) continue
    latest = latest == null ? resetAt : Math.max(latest, resetAt)
  }

  return latest
}

async function fetchRemoteFullResetAtBestEffort(userId: string): Promise<number | null> {
  try {
    return await fetchRemoteFullResetAt(userId)
  } catch {
    return getProfileResetLock(userId)?.resetAt ?? null
  }
}

async function applyRemoteFullResetIfNeeded(userId: string): Promise<number | null> {
  if (hasPendingRemoteWipeForTable(userId, 'athlete_profiles')) {
    syncProfileResetLockFlag(userId)
    return null
  }

  const remoteResetAt = await fetchRemoteFullResetAt(userId)
  if (remoteResetAt == null) {
    syncProfileResetLockFlag(userId)
    return null
  }

  const acknowledgedAt = getAcknowledgedRemoteFullResetAt(userId)
  if (acknowledgedAt != null && acknowledgedAt >= remoteResetAt) {
    markProfileResetLockStatus(userId, 'awaiting_onboarding_recreation', remoteResetAt)
    return remoteResetAt
  }

  clearSyncArtifactsForUser(userId)
  await clearAllLocalAppData(userId)
  acknowledgeRemoteFullReset(userId, remoteResetAt)
  markProfileResetLockStatus(userId, 'awaiting_onboarding_recreation', remoteResetAt)
  return remoteResetAt
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
  options?: { mode?: AthleteProfilePersistMode },
): Promise<void> {
  const mode = options?.mode ?? 'normal'
  const profileRow = toAthleteProfileSyncRow(stripAthleteProfileWriteSource(row))
  const existingRows = remoteRows ?? await fetchAthleteProfileRows(userId)

  if (mode === 'technical_marker') {
    const keeper = existingRows[0]
    const normalized = normalizeAthleteProfilePayload(profileRow)

    if (!keeper) {
      const { error } = await getSupabase()
        .from('athlete_profiles')
        .upsert({
          id: normalized.id,
          user_id: userId,
          coach_memory: normalized.coach_memory,
          updated_at: normalized.updated_at,
          data: normalized.data,
        } as never, { onConflict: 'user_id' })
      if (error) throw error
      return
    }

    const { error } = await getSupabase()
      .from('athlete_profiles')
      .update({
        coach_memory: normalized.coach_memory,
        updated_at: normalized.updated_at,
        data: normalized.data,
      } as never)
      .eq('id', keeper.id)
      .eq('user_id', userId)

    if (error) throw error

    const loserIds = existingRows
      .filter((candidate) => candidate.id !== keeper.id)
      .map((candidate) => candidate.id)

    if (loserIds.length > 0) {
      await deleteAthleteProfileRowsById(userId, loserIds)
    }
    return
  }

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
  const writeSource = getAthleteProfileWriteSource(row)
  const persistMode: AthleteProfilePersistMode = writeSource === 'post_reset_onboarding'
    ? 'post_reset_onboarding'
    : 'normal'
  const profileRow = toAthleteProfileSyncRow(stripAthleteProfileWriteSource(row))
  const remoteRows = await fetchAthleteProfileRows(userId)

  logAthleteProfileSync('push:attempt', {
    writeSource,
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
      if (writeSource === 'post_reset_onboarding') {
        clearProfileResetLock(userId)
      }
    } finally {
      syncStoreState().setSyncDetails({
        autoRepairInProgress: false,
        lastAutoRepairAt: Date.now(),
      })
    }
    return
  }

  await persistAthleteProfileRow(profileRow, userId, remoteRows, { mode: persistMode })
  if (writeSource === 'post_reset_onboarding') {
    clearProfileResetLock(userId)
  }
}

export async function pushSession(session: Session): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('sessions', sessionToRow(session, userId))
}

export async function deleteSession(id: string): Promise<void> {
  await deleteRow('sessions', id)
}

export async function pullSessionsForDateRange(startDate: string, endDate: string): Promise<void> {
  const userId = getUserId()
  if (!userId || !isEnabled()) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  const tombstones = getSessionDeleteTombstones(userId)
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const to = from + FETCH_PAGE_SIZE - 1
    const query = getSupabase()
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
    const supportsRange = typeof (query as { range?: unknown }).range === 'function'
    const pagedQuery = supportsRange
      ? (query as { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> }).range(from, to)
      : query as PromiseLike<{ data: unknown[] | null; error: unknown }>
    const { data, error } = await withRequestTimeout(
      pagedQuery,
      'sessions.pullRange',
    )
    if (error) throw error

    const page = data ?? []
    for (const row of page as Record<string, unknown>[]) {
      const remote = rowToSession(row)
      const deletedAt = tombstones[remote.id]
      if (typeof deletedAt === 'number') {
        if (deletedAt >= remote.updatedAt) {
          await deleteRow('sessions', remote.id)
          continue
        }
        clearSessionDeleteTombstone(userId, remote.id)
      }

      const local = await db.sessions.get(remote.id)
      if (!local || remote.updatedAt > local.updatedAt) {
        await db.sessions.put(remote)
      } else if (local.updatedAt > remote.updatedAt) {
        await pushSession(local)
      }
    }

    if (!supportsRange || page.length < FETCH_PAGE_SIZE) break
  }
}

export async function pushDayLog(log: DayLog): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('day_logs', dayLogToRow(log, userId))
}

export async function pushWeekSummary(summary: WeekSummary): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('week_summaries', weekSummaryToRow(summary, userId))
}

export async function pushChatMessage(msg: ChatMessage): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('chat_messages', chatMessageToRow(msg, userId))
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
  await upsertRow('coach_proposals', coachProposalToRow(proposal, userId))
}

export async function pushAthleteProfile(
  profile: AthleteProfile,
  options?: { source?: AthleteProfileWriteSource },
): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  const source = options?.source ?? 'automatic'
  await upsertRow('athlete_profiles', withAthleteProfileWriteSource(athleteProfileToRow(profile, userId), source), {
    athleteProfileWriteSource: source,
  })
}

export async function pushTrainingPlan(plan: TrainingPlan): Promise<void> {
  const userId = getUserId()
  if (!userId || !isSyncablePlanStatus(plan.status)) return
  await upsertRow('training_plans', trainingPlanToRow(plan, userId))
}

export async function pushTrainingPlanWeeks(plan: TrainingPlan, weeks: TrainingPlanWeek[]): Promise<void> {
  const userId = getUserId()
  if (!userId || !isSyncablePlanStatus(plan.status)) return
  await Promise.all(weeks.map((week) => upsertRow('training_plan_weeks', trainingPlanWeekToRow(week, userId))))
}

export async function archiveTrainingPlan(plan: TrainingPlan, weeks: TrainingPlanWeek[]): Promise<void> {
  const archivedPlan: TrainingPlan = {
    ...plan,
    status: 'archived',
    updatedAt: Date.now(),
  }
  await pushTrainingPlan(archivedPlan)
  await pushTrainingPlanWeeks(archivedPlan, weeks)
}

export async function softDeleteTrainingPlan(plan: TrainingPlan, weeks: TrainingPlanWeek[]): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  const deletedAt = Date.now()
  await Promise.all([
    upsertRow('training_plans', trainingPlanToRow({ ...plan, updatedAt: deletedAt }, userId, deletedAt)),
    ...weeks.map((week) =>
      upsertRow('training_plan_weeks', trainingPlanWeekToRow({ ...week, updatedAt: deletedAt }, userId, deletedAt)),
    ),
  ])
}

async function fetchAll<T>(table: SupabaseTable, userId: string): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const to = from + FETCH_PAGE_SIZE - 1
    const query = getSupabase()
      .from(table)
      .select('*')
      .eq('user_id', userId)
    const supportsRange = typeof (query as { range?: unknown }).range === 'function'
    const pagedQuery = supportsRange
      ? (query as { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }> }).range(from, to)
      : query as PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>
    const { data, error } = await pagedQuery

    if (error) {
      console.error(`[sync] fetch error on ${table}:`, error.message)
      throw error
    }

    const page = (data ?? []) as T[]
    rows.push(...page)
    if (!supportsRange || page.length < FETCH_PAGE_SIZE) break
  }

  return rows
}

async function wipeRemoteTableByUser(
  userId: string,
  table: SupabaseTable,
  options?: { fullReset?: boolean },
): Promise<void> {
  if (table === 'athlete_profiles') {
    if (options?.fullReset) {
      await deleteRemoteAthleteProfileData(userId)
    } else {
      await clearRemoteAthleteProfileData(userId)
    }
    return
  }

  const { error } = await getSupabase().from(table).delete().eq('user_id', userId)
  if (error) throw error
}

async function processPendingRemoteWipes(userId: string): Promise<RemoteWipeOutcome> {
  const pendingTables = sortRemoteWipeTables(getPendingRemoteWipeTables(userId))
  const fullReset = isPendingRemoteWipeFullReset(userId)
  const outcome: RemoteWipeOutcome = {
    succeeded: [],
    tolerated: [],
    failed: [],
    pending: pendingTables,
    completed: pendingTables.length === 0,
  }

  if (!isEnabled() || pendingTables.length === 0) {
    return outcome
  }

  for (const table of pendingTables) {
    try {
      await wipeRemoteTableByUser(userId, table, { fullReset })
      outcome.succeeded.push(table)
    } catch (error) {
      const info = classifySyncError(error, table)
      if (isToleratedRemoteWipeCategory(info.category)) {
        outcome.tolerated.push(table)
      } else {
        outcome.failed.push({ table, message: info.technicalMessage, category: info.category })
      }
    }
  }

  clearPendingRemoteWipeTables(userId, [...outcome.succeeded, ...outcome.tolerated] as SupabaseTable[])
  outcome.pending = sortRemoteWipeTables(getPendingRemoteWipeTables(userId))
  outcome.completed = outcome.pending.length === 0

  if (fullReset) {
    if (outcome.completed) {
      const remoteResetAt = await fetchRemoteFullResetAtBestEffort(userId)
      markProfileResetLockStatus(userId, 'awaiting_bootstrap_ack', remoteResetAt ?? undefined)
    } else if (getProfileResetLock(userId)) {
      markProfileResetLockStatus(userId, 'pending_remote_wipe')
    }
  }

  return outcome
}

async function pullRemoteAndMerge(userId: string): Promise<void> {
  if (activePullAllPromise && activePullAllPromise.userId === userId) {
    return activePullAllPromise.promise
  }

  const promise = (async () => {
    if (!isEnabled()) return

    const queueDrained = await drainQueue()
    const { syncDetails } = useAuthStore.getState()
    const pendingRemoteWipeTables = getPendingRemoteWipeTables(userId)
    const mergeContext: MergeContext = {
      allowDeletes: queueDrained,
      deleteBeforeTs: queueDrained ? (syncDetails.lastSuccessfulSyncAt ?? null) : null,
      pendingWrites: [],
      pendingRemoteWipeTables,
    }

    await Promise.all([
      mergeSessions(userId, mergeContext),
      mergeDayLogs(userId, mergeContext),
      mergeWeekSummaries(userId, mergeContext),
      mergeChatMessages(userId, mergeContext),
      mergeCoachProposals(userId, mergeContext),
      mergeAthleteProfile(userId, mergeContext),
    ])
    await mergeTrainingPlans(userId, mergeContext)
    await mergeTrainingPlanWeeks(userId, mergeContext)

    if (mergeContext.pendingWrites.length > 0) {
      for (const write of mergeContext.pendingWrites) {
        await write().catch((error) => {
          syncLog('merge:pending_write_failed', {
            error: error instanceof Error ? error.message : String(error),
          }, 'warn')
        })
      }
    }

    if (!pendingRemoteWipeTables.has('athlete_profiles') && !isAwaitingAthleteProfileRecreationAfterReset(userId)) {
      markInitialRemotePullComplete(userId)
    }
  })()

  activePullAllPromise = { userId, promise }

  try {
    await promise
  } finally {
    if (activePullAllPromise?.promise === promise) {
      activePullAllPromise = null
    }
  }
}

export async function runFullSync(userId: string): Promise<void> {
  if (!userId || !isEnabled()) return
  if (activeFullSyncPromise && activeFullSyncPromise.userId === userId) {
    return activeFullSyncPromise.promise
  }

  const promise = (async () => {
    await applyRemoteFullResetIfNeeded(userId)
    startSyncAttempt()
    const failureCountAtStart = syncStoreState().syncDetails.consecutiveFailures ?? 0
    const fullSyncStartedAt = Date.now()
    trackSyncEvent({ kind: 'pull', status: 'ok', userId, detail: 'runFullSync:start' })

    try {
      await repairLocalNaturalKeyConflicts()
      pruneExpiredTombstones(userId)
      pruneStaleQueue(userId)
      await processPendingRemoteWipes(userId)
      await applyRemoteFullResetIfNeeded(userId)
      await drainQueue()
      await pullRemoteAndMerge(userId)
      trackSyncEvent({
        kind: 'merge',
        status: 'ok',
        userId,
        durationMs: Date.now() - fullSyncStartedAt,
      })
      const failureCountBeforeFinalDrain = syncStoreState().syncDetails.consecutiveFailures ?? 0
      const queueDrainedAfterMerge = await drainQueue()
      const hasPendingRemoteWipe = getPendingRemoteWipeTables(userId).size > 0

      if (queueDrainedAfterMerge && !hasPendingRemoteWipe) {
        markSyncHealthy()
      } else {
        if (hasPendingRemoteWipe) {
          refreshQueueDiagnostics()
          syncStoreState().setSyncDetails({
            syncAttemptInFlight: false,
            retryScheduledAt: Date.now() + computeRetryDelayMs(1),
          })
          syncStoreState().setSyncStatus('syncing', 'Limpiando datos remotos pendientes.')
          return
        }
        const failureCountAfterFinalDrain = syncStoreState().syncDetails.consecutiveFailures ?? 0
        if (failureCountAfterFinalDrain > failureCountBeforeFinalDrain) {
          return
        }
        refreshQueueDiagnostics()
        const nextFailures = (syncStoreState().syncDetails.consecutiveFailures ?? 0) + 1
        syncStoreState().setSyncStatus('degraded', 'Quedaron operaciones pendientes en cola.')
        syncStoreState().setSyncDetails({
          syncAttemptInFlight: false,
          lastErrorAt: Date.now(),
          lastErrorMessage: 'Quedaron operaciones pendientes en cola.',
          lastBlockedTable: syncStoreState().syncDetails.pendingTables[0] ?? null,
          retryScheduledAt: Date.now() + computeRetryDelayMs(nextFailures),
          consecutiveFailures: nextFailures,
        })
      }
    } catch (error) {
      const errorInfo = classifySyncError(error)
      trackSyncEvent({
        kind: 'pull',
        status: 'error',
        userId,
        errorCategory: errorInfo.category,
        durationMs: Date.now() - fullSyncStartedAt,
        detail: errorInfo.technicalMessage,
      })
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

  activeFullSyncPromise = { userId, promise }

  try {
    await promise
  } finally {
    if (activeFullSyncPromise?.promise === promise) {
      activeFullSyncPromise = null
    }
  }
}

async function mergeSessions(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('sessions')) return
  const remoteRows = await fetchAll<Record<string, unknown>>('sessions', userId)
  const remoteIds = new Set<string>()
  const tombstones = getSessionDeleteTombstones(userId)

  for (const row of remoteRows) {
    const remote = rowToSession(row)
    remoteIds.add(remote.id)

    const deletedAt = tombstones[remote.id]
    if (typeof deletedAt === 'number') {
      if (deletedAt >= remote.updatedAt) {
        context.pendingWrites.push(() => deleteRow('sessions', remote.id))
        continue
      }
      clearSessionDeleteTombstone(userId, remote.id)
    }

    const local = await db.sessions.get(remote.id)
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.sessions.put(remote)
    } else if (local.updatedAt > remote.updatedAt) {
      context.pendingWrites.push(() => pushSession(local))
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

  pruneSessionDeleteTombstones(userId, remoteIds, { pullWasComplete: true })
}

async function mergeDayLogs(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('day_logs')) return
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
      if (remote.id !== localByDate.id) {
        context.pendingWrites.push(() => deleteRow('day_logs', localByDate.id))
      }
      if (resolution.winner.id !== remote.id) {
        context.pendingWrites.push(() => deleteRow('day_logs', remote.id))
      }
      context.pendingWrites.push(() => pushDayLog(resolution.winner))
      continue
    }

    if (resolution.winner === remote) {
      await db.dayLogs.put(remote)
    } else if (resolution.winner.updatedAt > remote.updatedAt) {
      context.pendingWrites.push(() => pushDayLog(resolution.winner))
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
  if (context.pendingRemoteWipeTables.has('week_summaries')) return
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
      if (remote.id !== localByWeek.id) {
        context.pendingWrites.push(() => deleteRow('week_summaries', localByWeek.id))
      }
      if (resolution.winner.id !== remote.id) {
        context.pendingWrites.push(() => deleteRow('week_summaries', remote.id))
      }
      context.pendingWrites.push(() => pushWeekSummary(resolution.winner))
      continue
    }

    const winnerUpdatedAt = getWeekSummaryUpdatedAt(resolution.winner)

    if (resolution.winner === remote) {
      await db.weekSummaries.put(remote)
    } else if (winnerUpdatedAt > remoteUpdatedAt) {
      context.pendingWrites.push(() => pushWeekSummary(resolution.winner))
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
  if (context.pendingRemoteWipeTables.has('chat_messages')) return
  const remoteRows = await fetchAll<Record<string, unknown>>('chat_messages', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToChatMessage(row)
    remoteIds.add(remote.id)

    const local = await db.chatMessages.get(remote.id)
    if (!local) {
      await db.chatMessages.put(remote)
    } else if (remote.timestamp >= local.timestamp && JSON.stringify(remote) !== JSON.stringify(local)) {
      await db.chatMessages.put(remote)
    } else if (local.timestamp > remote.timestamp) {
      context.pendingWrites.push(() => pushChatMessage(local))
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
  if (context.pendingRemoteWipeTables.has('coach_proposals')) return
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
      context.pendingWrites.push(() => pushCoachProposal(local))
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
  if (context.pendingRemoteWipeTables.has('athlete_profiles')) return
  let remoteRows: AthleteProfileSyncRow[]
  try {
    remoteRows = await fetchAthleteProfileRows(userId)
  } catch (error) {
    throw new Error(classifyAthleteProfileSyncError(error))
  }

  const profileResetLock = getProfileResetLock(userId)
  if (isProfileResetLockActive(profileResetLock)) {
    if (remoteRows.length > 0) {
      const canonicalLockedRow = coalesceAthleteProfileRows(remoteRows)
      const resetAt = getAthleteProfileFullResetAt(canonicalLockedRow.data)
      if (resetAt != null) {
        markProfileResetLockStatus(userId, 'awaiting_onboarding_recreation', resetAt)
      }
    }
    await db.athleteProfiles.clear()
    return
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
  if (isAthleteProfileFullResetRow(canonicalRow)) {
    markProfileResetLockStatus(
      userId,
      'awaiting_onboarding_recreation',
      getAthleteProfileFullResetAt(canonicalRow.data) ?? Date.now(),
    )
    await db.athleteProfiles.clear()
    return
  }
  const local = await db.athleteProfiles.get('default')
  const localRow = local ? toAthleteProfileSyncRow(athleteProfileToRow(local, userId)) : null
  const mergedRow = localRow ? coalesceAthleteProfileRows([localRow, canonicalRow]) : canonicalRow
  const mergedProfile = rowToAthleteProfile(mergedRow)

  if (!localRow || !athleteProfileRowsEqual(localRow, mergedRow)) {
    await db.athleteProfiles.put({ ...mergedProfile, id: 'default' })
  }

  if (!athleteProfileRowsEqual(canonicalRow, mergedRow)) {
    context.pendingWrites.push(() => pushAthleteProfile(mergedProfile))
  }
}

async function deleteLocalTrainingPlan(planId: string): Promise<void> {
  await db.trainingPlanWeeks.where('planId').equals(planId).delete()
  await db.trainingPlans.delete(planId)
}

async function mergeTrainingPlans(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('training_plans')) return
  const remoteRows = await fetchAll<Record<string, unknown>>('training_plans', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remotePlan = rowToTrainingPlan(row)
    const remoteDeletedAt = typeof row.deleted_at === 'number' ? row.deleted_at : null
    remoteIds.add(remotePlan.id)

    const localPlan = await db.trainingPlans.get(remotePlan.id)

    if (remoteDeletedAt != null) {
      if (localPlan && remoteDeletedAt >= localPlan.updatedAt) {
        await deleteLocalTrainingPlan(localPlan.id)
      } else if (localPlan && isSyncablePlanStatus(localPlan.status)) {
        context.pendingWrites.push(() => pushTrainingPlan(localPlan))
      }
      continue
    }

    if (!localPlan) {
      await db.trainingPlans.put(remotePlan)
      continue
    }

    if (remotePlan.updatedAt > localPlan.updatedAt) {
      await db.trainingPlans.put(remotePlan)
    } else if (localPlan.updatedAt > remotePlan.updatedAt && isSyncablePlanStatus(localPlan.status)) {
      context.pendingWrites.push(() => pushTrainingPlan(localPlan))
    }
  }

  if (!context.allowDeletes || context.deleteBeforeTs == null) return

  const localPlans = await db.trainingPlans.toArray()
  for (const localPlan of localPlans) {
    if (!isSyncablePlanStatus(localPlan.status)) continue
    if (remoteIds.has(localPlan.id)) continue
    if (localPlan.updatedAt > context.deleteBeforeTs) continue
    await deleteLocalTrainingPlan(localPlan.id)
  }
}

async function mergeTrainingPlanWeeks(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('training_plan_weeks')) return
  const remoteRows = await fetchAll<Record<string, unknown>>('training_plan_weeks', userId)
  const remoteIds = new Set<string>()
  const localPlans = await db.trainingPlans.toArray()
  const syncablePlanIds = new Set(localPlans.filter((plan) => isSyncablePlanStatus(plan.status)).map((plan) => plan.id))

  for (const row of remoteRows) {
    const remoteWeek = rowToTrainingPlanWeek(row)
    const remoteDeletedAt = typeof row.deleted_at === 'number' ? row.deleted_at : null
    const localWeek = await db.trainingPlanWeeks.get(remoteWeek.id)

    if (!syncablePlanIds.has(remoteWeek.planId)) {
      if (localWeek) {
        await db.trainingPlanWeeks.delete(localWeek.id)
      }
      continue
    }

    remoteIds.add(remoteWeek.id)

    if (remoteDeletedAt != null) {
      if (localWeek && remoteDeletedAt >= localWeek.updatedAt) {
        await db.trainingPlanWeeks.delete(localWeek.id)
      } else if (localWeek) {
        const localPlan = localPlans.find((plan) => plan.id === localWeek.planId)
        if (localPlan && isSyncablePlanStatus(localPlan.status)) {
          context.pendingWrites.push(() => pushTrainingPlanWeeks(localPlan, [localWeek]))
        }
      }
      continue
    }

    if (!localWeek) {
      await db.trainingPlanWeeks.put(remoteWeek)
      continue
    }

    if (remoteWeek.updatedAt > localWeek.updatedAt) {
      await db.trainingPlanWeeks.put(remoteWeek)
    } else if (localWeek.updatedAt > remoteWeek.updatedAt) {
      const localPlan = localPlans.find((plan) => plan.id === localWeek.planId)
      if (localPlan && isSyncablePlanStatus(localPlan.status)) {
        context.pendingWrites.push(() => pushTrainingPlanWeeks(localPlan, [localWeek]))
      }
    }
  }

  if (!context.allowDeletes || context.deleteBeforeTs == null) return

  const localWeeks = await db.trainingPlanWeeks.toArray()
  for (const localWeek of localWeeks) {
    if (!syncablePlanIds.has(localWeek.planId)) continue
    if (remoteIds.has(localWeek.id)) continue
    if (localWeek.updatedAt > context.deleteBeforeTs) continue
    await db.trainingPlanWeeks.delete(localWeek.id)
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

  if (deterministicTiebreaker(remote, local) > 0) {
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

  if (deterministicTiebreaker(remote, local) > 0) {
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
      await Promise.all(loserIds.map((id) => deleteRow('day_logs', id)))
      await pushDayLog(winner)
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
      await pushWeekSummary(winner)
    }
  }
}

function compareDayLogsForRepair(a: DayLog, b: DayLog): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  // Tiebreaker determinístico: más campos no-nulos gana; id asc como desempate final.
  return -deterministicTiebreaker(a, b)
}

function compareWeekSummariesForRepair(a: WeekSummary, b: WeekSummary): number {
  const aUpdatedAt = getWeekSummaryUpdatedAt(a)
  const bUpdatedAt = getWeekSummaryUpdatedAt(b)
  if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt
  return -deterministicTiebreaker(a, b)
}

function getWeekSummaryUpdatedAt(summary: WeekSummary): number {
  return summary.updatedAt ?? 0
}

/**
 * Cuenta campos no-nulos en un objeto a nivel top (útil como tiebreaker determinístico
 * cuando dos registros comparten `updatedAt`). Arrays/objetos vacíos cuentan como nulos.
 */
function countNonNullFields(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const record = value as Record<string, unknown>
  let count = 0
  for (const key of Object.keys(record)) {
    const v = record[key]
    if (v == null) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'string' && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
    count += 1
  }
  return count
}

/**
 * Tiebreaker determinístico cuando `updatedAt` empata: más campos no-nulos gana;
 * si sigue empatado, el `id` menor gana (estable independiente del orden del array).
 * Retorna > 0 si `a` gana, < 0 si `b` gana.
 */
function deterministicTiebreaker<T extends { id: string }>(a: T, b: T): number {
  const aScore = countNonNullFields(a)
  const bScore = countNonNullFields(b)
  if (aScore !== bScore) return aScore - bScore
  // id asc: el "menor" gana → devolvemos positivo cuando a.id < b.id
  if (a.id < b.id) return 1
  if (a.id > b.id) return -1
  return 0
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
  clearQueuedOpsForTables(userId, REMOTE_WIPE_ORDER)
  clearSessionDeleteTombstoneGroup(userId)
  localStorage.removeItem(getMigrationKey(userId))
  clearInitialRemotePull(userId)
  clearPendingRemoteWipeState(userId)

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
    awaitingProfileRecreationAfterReset: false,
  })
}

export function clearSelectedSyncArtifactsForUser(
  userId: string,
  selection: { trainingData?: boolean; chatHistory?: boolean; coachProposals?: boolean; coachMemory?: boolean },
): void {
  const selectedTables = mapSelectionToRemoteTables(selection)
  if (selectedTables.length === 0) return
  clearQueuedOpsForTables(userId, selectedTables)

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

function pruneSessionDeleteTombstones(
  userId: string,
  remoteIds: Set<string>,
  options: { pullWasComplete: boolean },
): void {
  const tombstones = getSessionDeleteTombstones(userId)
  let changed = false
  const now = Date.now()

  // QW #10: siempre limpiar tombstones vencidos por TTL (180 días) — esto no depende del remote.
  for (const sessionId of Object.keys(tombstones)) {
    const deletedAt = tombstones[sessionId]
    if (now - deletedAt >= TOMBSTONE_TTL_MS) {
      delete tombstones[sessionId]
      changed = true
    }
  }

  // Solo pruneo por ausencia remota si la pull fue efectivamente completa.
  // Si la pull falló silenciosamente y remoteIds está vacío, saltear para no borrar tombstones válidos.
  if (options.pullWasComplete) {
    for (const sessionId of Object.keys(tombstones)) {
      if (!remoteIds.has(sessionId)) {
        delete tombstones[sessionId]
        changed = true
      }
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
    db.trainingPlans.count(),
    db.trainingPlanWeeks.count(),
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
    clearSyncArtifactsForUser(previousUserId)
    await clearAllLocalAppData(previousUserId)
  }

  await applyRemoteFullResetIfNeeded(userId)

  localStorage.setItem(LAST_SYNC_USER_KEY, userId)

  if (getProfileResetLock(userId)) {
    syncProfileResetLockFlag(userId)
    return { shouldMigrate: false }
  }

  const shouldMigrate =
    !localStorage.getItem(getMigrationKey(userId)) &&
    await hasLocalAppData()

  return { shouldMigrate }
}

export async function migrateLocalDataToCloud(userId: string): Promise<void> {
  if (!isEnabled()) return
  if (localStorage.getItem(getMigrationKey(userId))) return

  try {
    const [sessions, dayLogs, weekSummaries, trainingPlans, trainingPlanWeeks, chatMessages, coachProposals, athleteProfiles] =
      await Promise.all([
        db.sessions.toArray(),
        db.dayLogs.toArray(),
        db.weekSummaries.toArray(),
        db.trainingPlans.toArray(),
        db.trainingPlanWeeks.toArray(),
        db.chatMessages.toArray(),
        db.coachProposals.toArray(),
        db.athleteProfiles.toArray(),
      ])

    const syncablePlans = trainingPlans.filter((plan) => isSyncablePlanStatus(plan.status))
    const syncablePlanIds = new Set(syncablePlans.map((plan) => plan.id))
    const syncableWeeks = trainingPlanWeeks.filter((week) => syncablePlanIds.has(week.planId))

    const sessionRows = sessions.map((session) => sessionToRow(session, userId))
    const dayLogRows = dayLogs.map((dayLog) => dayLogToRow(dayLog, userId))
    const weekRows = weekSummaries.map((summary) => weekSummaryToRow(summary, userId))
    const trainingPlanRows = syncablePlans.map((plan) => trainingPlanToRow(plan, userId))
    const trainingPlanWeekRows = syncableWeeks.map((week) => trainingPlanWeekToRow(week, userId))
    const chatRows = chatMessages.map((message) => chatMessageToRow(message, userId))
    const proposalRows = coachProposals.map((proposal) => coachProposalToRow(proposal, userId))
    const profileRows = athleteProfiles.map((profile) => athleteProfileToRow(profile, userId))

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
    ])
    const trainingPlanResult = trainingPlanRows.length > 0
      ? await getSupabase()
        .from('training_plans')
        .upsert(trainingPlanRows as never)
        .then((result) => ({ table: 'training_plans', error: result.error }))
      : { table: 'training_plans', error: null }
    const trainingPlanWeekResult = trainingPlanWeekRows.length > 0
      ? await getSupabase()
        .from('training_plan_weeks')
        .upsert(trainingPlanWeekRows as never)
        .then((result) => ({ table: 'training_plan_weeks', error: result.error }))
      : { table: 'training_plan_weeks', error: null }
    if (profileRows.length > 0 && !getProfileResetLock(userId)) {
      const syncRows = profileRows.map(toAthleteProfileSyncRow)
      const coalesced = coalesceAthleteProfileRows(syncRows)
      await persistAthleteProfileRow(coalesced as unknown as Record<string, unknown>, userId)
    }
    const profileResult = { table: 'athlete_profiles', error: null }
    migrationResults.push(trainingPlanResult, trainingPlanWeekResult, profileResult)

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

/**
 * Reparación explícita de duplicados remotos de `athlete_profiles`.
 * Se puede invocar manualmente desde el panel de diagnóstico o tras login.
 * No se llama desde el hot path de push; el drain sigue teniendo su fallback inline.
 *
 * Devuelve cuántas filas remotas había y si se ejecutó una reparación.
 */
export async function repairAthleteProfileDuplicates(userId: string): Promise<{
  remoteRowsBefore: number
  repaired: boolean
}> {
  if (!isEnabled()) {
    return { remoteRowsBefore: 0, repaired: false }
  }
  try {
    syncStoreState().setSyncDetails({ autoRepairInProgress: true })
    const remoteRows = await fetchAthleteProfileRows(userId)
    if (remoteRows.length <= 1) {
      syncStoreState().setSyncDetails({
        autoRepairInProgress: false,
        lastAutoRepairAt: Date.now(),
      })
      return { remoteRowsBefore: remoteRows.length, repaired: false }
    }
    await repairRemoteAthleteProfileRows(userId, remoteRows)
    syncStoreState().setSyncDetails({
      autoRepairInProgress: false,
      lastAutoRepairAt: Date.now(),
    })
    trackSyncEvent({
      kind: 'repair',
      status: 'ok',
      entity: 'athlete_profiles',
      userId,
      detail: `repaired_${remoteRows.length}_duplicates`,
    })
    return { remoteRowsBefore: remoteRows.length, repaired: true }
  } catch (error) {
    syncStoreState().setSyncDetails({ autoRepairInProgress: false })
    trackSyncEvent({
      kind: 'repair',
      status: 'error',
      entity: 'athlete_profiles',
      userId,
      detail: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Limpia de la cola local todas las ops pendientes del usuario actual para las tablas indicadas
 * (o todas si no se pasa lista). Útil para que el usuario descarte manualmente ops que quedaron
 * retenidas (p.ej. Tier C en outage prolongado).
 *
 * ⚠️ Pierde cambios locales no sincronizados de esas tablas. El caller debe confirmar con el usuario.
 */
export function clearPendingOpsForUser(
  userId: string,
  tables?: Iterable<SupabaseTable>,
): number {
  const tableSet = tables ? new Set(tables) : null
  const queue = loadQueue()
  const before = queue.length
  const next = queue.filter((op) => {
    if (op.userId !== userId) return true
    if (!tableSet) return false
    return !tableSet.has(op.table)
  })
  saveQueue(next)
  refreshQueueDiagnostics()
  const removed = before - next.length
  if (removed > 0) {
    syncLog('queue:manual_clear', {
      userId,
      tables: tableSet ? [...tableSet] : 'all',
      removed,
    }, 'warn')
  }
  return removed
}

export interface RemoteWipeOutcome {
  /** Tables where the remote delete succeeded. */
  succeeded: string[]
  /** Tables skipped because the schema is missing remotely — safe to ignore. */
  tolerated: string[]
  /** Tables that failed with a real error (RLS, network, unknown). */
  failed: Array<{ table: string; message: string; category: SyncErrorCategory }>
  /** Tables still pending remote cleanup after this attempt. */
  pending: string[]
  /** Whether the requested wipe has fully completed. */
  completed: boolean
}

function isToleratedRemoteWipeCategory(category: SyncErrorCategory): boolean {
  return category === 'schema_mismatch' || category === 'supabase_not_configured'
}

export async function clearSelectedRemoteAppData(
  userId: string,
  selection: { trainingData?: boolean; chatHistory?: boolean; coachProposals?: boolean; coachMemory?: boolean },
): Promise<RemoteWipeOutcome> {
  const selectedTables = mapSelectionToRemoteTables(selection)
  const outcome: RemoteWipeOutcome = { succeeded: [], tolerated: [], failed: [], pending: selectedTables, completed: selectedTables.length === 0 }
  if (!isEnabled()) return { ...outcome, pending: [], completed: true }

  registerPendingRemoteWipe(userId, selectedTables)
  return processPendingRemoteWipes(userId)
}

export async function wipeRemoteAndLocalAppData(userId: string): Promise<RemoteWipeOutcome> {
  const allTables = [...REMOTE_WIPE_ORDER]
  const outcome: RemoteWipeOutcome = { succeeded: [], tolerated: [], failed: [], pending: allTables, completed: false }

  if (!isEnabled()) {
    await clearAllLocalAppData(userId)
    clearSyncArtifactsForUser(userId)
    clearProfileResetLock(userId)
    acknowledgeRemoteFullReset(userId, Date.now())
    return { ...outcome, pending: [], completed: true }
  }

  markProfileResetLockStatus(userId, 'pending_remote_wipe')
  clearQueuedOpsForTables(userId, allTables)
  clearSessionDeleteTombstoneGroup(userId)
  registerPendingRemoteWipe(userId, allTables, { fullReset: true })

  const processed = await processPendingRemoteWipes(userId)
  if (!processed.completed) return processed

  await clearAllLocalAppData(userId)
  clearSyncArtifactsForUser(userId)
  const remoteResetAt = await fetchRemoteFullResetAtBestEffort(userId)
  acknowledgeRemoteFullReset(userId, remoteResetAt ?? Date.now())
  markProfileResetLockStatus(userId, 'awaiting_bootstrap_ack', remoteResetAt ?? undefined)

  return { ...processed, pending: [], completed: true }
}

async function clearRemoteAthleteProfileData(userId: string): Promise<void> {
  const clearedProfile: AthleteProfile = {
    id: 'default',
    updatedAt: Date.now(),
    coachMemory: undefined,
    onboardingDeferredAt: undefined,
    name: undefined,
    age: undefined,
    weightKg: undefined,
    primarySport: undefined,
    secondarySports: undefined,
    sportContext: undefined,
    mainGoal: undefined,
    secondaryGoal: undefined,
    runningProfile: undefined,
    strengthProfile: undefined,
    recoveryProfile: undefined,
    scheduleProfile: undefined,
    nutritionProfile: undefined,
    goalEvents: undefined,
    macroPlan: undefined,
    planWizardConfig: undefined,
  }

  await persistAthleteProfileRow(athleteProfileToRow(clearedProfile, userId), userId)
}

async function deleteRemoteAthleteProfileData(userId: string): Promise<void> {
  const resetAt = getProfileResetLock(userId)?.resetAt ?? Date.now()
  const { error } = await getSupabase()
    .from('athlete_profiles')
    .delete()
    .eq('user_id', userId)

  if (error) throw error

  const marker = createAthleteProfileFullResetRow(userId, resetAt)
  try {
    await persistAthleteProfileRow(marker, userId, [], { mode: 'technical_marker' })
  } catch {
    try {
      await persistAthleteProfileRow(marker, userId, undefined, { mode: 'technical_marker' })
    } catch (fallbackError) {
      const info = classifySyncError(fallbackError, 'athlete_profiles')
      syncLog('athlete_profiles:reset_marker_skipped', {
        category: info.category,
        message: info.technicalMessage,
      }, 'warn')
      trackSyncEvent({
        kind: 'delete',
        status: 'skip',
        entity: 'athlete_profiles',
        userId,
        detail: `reset_marker_skipped:${info.category}`,
      })
    }
  }
}
