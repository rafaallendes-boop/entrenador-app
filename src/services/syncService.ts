/**
 * Sync layer between local Dexie and Supabase.
 *
 * Strategy:
 * - UI always reads from Dexie.
 * - Local writes trigger fire-and-forget pushes to Supabase.
 * - After auth, runFullSync() drains queue, merges remote data into Dexie (LWW) and re-drains.
 * - If offline or Supabase errors, ops are queued in localStorage and retried.
 */

import { db } from '../db/db'
import { captureSyncFailure } from './observability/syncErrorCapture'
import { captureClientError } from './observability/installClientErrorReporter'
import { getAllAthleteScopedTables, purgeAthleteScopedRows } from '../db/athleteScopedTables'
import { useAuthStore } from '../store/useAuthStore'
import type {
  Session,
  DayLog,
  WeekSummary,
  ChatMessage,
  CoachProposal,
  AthleteProfile,
  Athlete,
  AthleteCoachNote,
} from '../types'
import type { TrainingPlan, TrainingPlanWeek } from '../types/planBuilder'
import type { StoredSessionTemplate } from '../types/sessionTemplate'
import { jsonStructurallyEqual } from '../utils/canonicalJson'
import { clearStoredChatSessionIdForAthlete } from '../utils/chatSession'
import {
  rowToTrainingPlan,
  rowToTrainingPlanWeek,
  trainingPlanToRow,
  trainingPlanWeekToRow,
} from './planBuilder/planRows'
import {
  ATHLETE_PROFILE_SELF_GROUP,
  athleteProfileRowsEqual,
  athleteProfileGroupKey,
  athleteProfileToRow,
  classifyAthleteProfileSyncError,
  classifySyncError,
  coalesceAthleteProfileRows,
  createAthleteProfileFullResetRow,
  getAthleteProfileFullResetAt,
  getSyncErrorMessage,
  groupAthleteProfileRows,
  isAthleteProfileFullResetRow,
  normalizeAthleteProfilePayload,
  rowToAthleteProfile,
  toAthleteProfileSyncRow,
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
import { ENTITY_TIER } from '../types/syncDiagnostics'
import { ATHLETE_PROFILE_LOCAL_ID, getActiveAthleteId, getSelfAthleteId } from './athlete/activeAthlete'
import { effectiveAthleteKey, isInAthleteScope, isScopedAthleteId } from './athlete/effectiveAthleteKey'
import { hydrateActiveAthlete } from './athlete/hydrateActiveAthlete'
import { athleteIdForOwner, backfillLocalAthleteScope } from './athlete/athleteScopeMigration'
import { acknowledgeLocalMembershipCreation, getMembershipAthleteIds, getRoleForAthlete, hasCoachMembership, membershipFromRemoteRow, replaceMembershipCache } from './athlete/membershipCache'
import { athleteToRow, rowToAthlete, type AthleteRow } from './athleteRows'
import { resolveReadScope, type ReadScope } from './athlete/readScope'
import { resolveAuthoredByRole } from './athlete/activeScopeFilter'
import { buildMarkSessionDoneParams, shouldRouteSessionCompletionViaRpc } from './sync/sessionCompletion'
import { pruneCoachNotesMissingFromRemote } from './athlete/coachNotes'
import { resolveApiUrl } from './apiUrl'
import {
  FETCH_PAGE_SIZE,
  fetchAll,
  getSupabase,
  withRequestTimeout,
} from './sync/syncSupabase'
import {
  computeRetryDelayMs,
  getMaxRetriesForTable,
  sortQueueByTier,
} from './sync/syncRetry'
import {
  MAX_QUEUE_SIZE,
  clearQueuedOpsForEntityOlderThan,
  clearQueuedOpsForTables,
  enqueue as enqueueOp,
  isSameQueuedOpVersion,
  loadQueue,
  offlineOpsShareIdentity,
  saveQueue,
  setQueueChangeListener,
  clearQueuedOpsForAthlete,
} from './sync/syncQueue'
import {
  getAthleteDeleteTombstoneSnapshot,
  hasAthleteDeleteTombstone,
  hasAthleteDeleteTombstoneForAthlete,
  rememberAthleteDeleteTombstone,
} from './sync/athleteDeleteTombstones'
import { getRemoteRowAthleteId } from './sync/remoteRowAthleteId'
import {
  runAthleteWrite,
  runAthleteWrites,
  trackInFlightAthleteOp,
  waitForInFlightAthleteOps,
} from './sync/athleteWriteLease'
import {
  isRemoteSessionTarget,
  type RemoteSessionTarget,
} from './sync/remoteSessionTarget'
import { createScopedDedup } from './sync/syncDedup'
import {
  ATHLETE_PROFILE_WRITE_MODE_KEY,
  COACH_PROPOSAL_DELETE_TOMBSTONES_KEY,
  LAST_SYNC_USER_KEY,
  PROFILE_RESET_LOCK_KEY,
  QUEUE_KEY,
  REMOTE_WIPE_KEY,
  SESSION_DELETE_TOMBSTONES_KEY,
  getInitialPullKey,
  getMigrationKey,
  getRemoteAthleteAckKey,
  getRemoteFullResetAckKey,
} from './sync/syncStorageKeys'

export {
  acquireAthleteDeletionBarrier,
  runAthleteWrite,
  runAthleteWrites,
  waitForInFlightAthleteOps,
  withAthleteWriteLease,
  withAthleteWriteLeases,
} from './sync/athleteWriteLease'

const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000 // 180 days (extended from 90d as part of sync hardening)

export type AthleteProfileWriteSource = 'automatic' | 'post_reset_onboarding'
export type SyncPushOutcome = 'pushed' | 'queued' | 'no_remote' | 'failed'

type AthleteProfilePersistMode = 'normal' | 'technical_marker' | 'post_reset_onboarding'
type ProfileResetLockStatus = 'pending_remote_wipe' | 'awaiting_bootstrap_ack' | 'awaiting_onboarding_recreation' | 'released'

class MigrationPartialFailure extends Error {
  readonly failures: ReadonlyArray<{ table: SupabaseTable; error: unknown }>

  constructor(failures: ReadonlyArray<{ table: SupabaseTable; error: unknown }>) {
    super(`Migration partial failure: ${failures.map((failure) => failure.table).join(', ')}`)
    this.name = 'MigrationPartialFailure'
    this.failures = failures
  }
}

interface ProfileResetLockEntry {
  resetAt: number
  status: ProfileResetLockStatus
}

type ProfileResetLockStore = Record<string, ProfileResetLockEntry>


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
  'readiness_daily',
  'day_logs',
  'sessions',
  'athlete_coach_notes',
  'athlete_profiles',
  'session_templates',
]

const remoteAthleteEnsurePromises = new Map<string, Promise<void>>()

function loadAcknowledgedRemoteAthleteIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getRemoteAthleteAckKey(userId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0))
  } catch {
    // Fail closed: without a trustworthy acknowledgement, remote absence must
    // never become a destructive local delete.
    return new Set()
  }
}

function saveAcknowledgedRemoteAthleteIds(userId: string, ids: Set<string>): void {
  try {
    const key = getRemoteAthleteAckKey(userId)
    if (ids.size === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify([...ids].sort()))
  } catch {
    // A failed acknowledgement only disables absence-based cleanup; it cannot
    // make a local-only athlete look remotely deleted.
  }
}

function rememberRemoteAthleteAcknowledgements(userId: string, athleteIds: Iterable<string>): void {
  const acknowledged = loadAcknowledgedRemoteAthleteIds(userId)
  for (const athleteId of athleteIds) acknowledged.add(athleteId)
  saveAcknowledgedRemoteAthleteIds(userId, acknowledged)
}

function forgetRemoteAthleteAcknowledgement(userId: string, athleteId: string): void {
  const acknowledged = loadAcknowledgedRemoteAthleteIds(userId)
  if (!acknowledged.delete(athleteId)) return
  saveAcknowledgedRemoteAthleteIds(userId, acknowledged)
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

function isOptionalPlanSyncTable(table: SupabaseTable | null | undefined): boolean {
  return table === 'training_plans' || table === 'training_plan_weeks'
}

function isOptionalPlanSchemaMismatch(errorInfo: SyncErrorInfo, table: SupabaseTable | null | undefined): boolean {
  return isOptionalPlanSyncTable(table) && errorInfo.category === 'schema_mismatch'
}

const SCHEMA_MISMATCH_BLOCK_TTL_MS = 5 * 60 * 1000

function trackOptionalPlanSyncSkip(table: SupabaseTable, errorInfo: SyncErrorInfo, detail: string): void {
  schemaMismatchBlockedTables.set(table, Date.now())
  syncLog('optional_plan_sync:skipped', {
    table,
    category: errorInfo.category,
    technicalMessage: errorInfo.technicalMessage,
    detail,
  }, 'warn')
  trackSyncEvent({
    kind: 'migration',
    status: 'skip',
    entity: table,
    userId: getUserId(),
    errorCategory: errorInfo.category,
    detail: errorInfo.technicalMessage,
  })
}

function isSchemaMismatchBlocked(table: SupabaseTable): boolean {
  const blockedAt = schemaMismatchBlockedTables.get(table)
  if (blockedAt == null) return false
  if (Date.now() - blockedAt < SCHEMA_MISMATCH_BLOCK_TTL_MS) return true
  schemaMismatchBlockedTables.delete(table)
  syncLog('optional_plan_sync:block_expired', { table }, 'info')
  return false
}

export function clearSchemaMismatchBlocks(): void {
  if (schemaMismatchBlockedTables.size === 0) return
  const tables = [...schemaMismatchBlockedTables.keys()]
  schemaMismatchBlockedTables.clear()
  syncLog('optional_plan_sync:block_cleared', { tables }, 'info')
}

async function clearAllLocalAppDataForSync(userId?: string): Promise<void> {
  const { clearAllLocalAppData } = await import('./appMaintenance')
  await clearAllLocalAppData(userId)
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
    tables.push('athlete_coach_notes', 'athlete_profiles')
  }
  return sortRemoteWipeTables(tables)
}
const drainQueueDedup = createScopedDedup<boolean>()
const pullRemoteDedup = createScopedDedup<void>()
const fullSyncDedup = createScopedDedup<void>()
const schemaMismatchBlockedTables = new Map<SupabaseTable, number>()
let syncAttemptCounter = 0
const entityMutationLanes = new Map<string, Promise<void>>()
let retryTimer: ReturnType<typeof setTimeout> | null = null
const queueChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('sync-queue')
  : null

setQueueChangeListener(() => {
  refreshQueueDiagnostics()
  queueChannel?.postMessage({ type: 'queue-changed' })
})

/**
 * Safe accessor for the Supabase client. Throws a typed SyncError
 * instead of crashing with a null-reference TypeError.
 */
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

  // Los fallos terminales de sync no llegan a ningún error boundary: se atrapan
  // y se tragan acá. Sin este puente son invisibles para el reporter. Filtra a
  // los tres eventos `:non_retriable` y transmite **sólo** la categoría tipada,
  // nunca `details`, que trae tabla e ids.
  captureSyncFailure(event, entry, captureClientError)
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
  readScope: ReadScope
  activeAthleteId: string | null
  pendingWrites: Array<() => Promise<unknown>>
  pendingRemoteWipeTables: Set<SupabaseTable>
}

interface MergeResolution<T extends { id: string }> {
  winner: T
  loserId?: string
}

function isSyncablePlanStatus(status: TrainingPlan['status']): boolean {
  return status === 'draft' || status === 'active' || status === 'archived' || status === 'superseded'
}

function syncStoreState() {
  return useAuthStore.getState()
}

function deleteAthleteScope(context: MergeContext): string | undefined {
  return context.readScope.mode === 'athlete' ? context.readScope.athleteId : undefined
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

function enqueue(op: OfflineOp): boolean {
  enqueueOp(op, {
    onOverflow: (dropped) => {
      syncLog('queue:overflow', {
        maxQueueSize: MAX_QUEUE_SIZE,
        droppedTable: dropped.table,
        droppedAction: dropped.action,
        droppedId: typeof dropped.payload?.id === 'string' ? dropped.payload.id : null,
        droppedEnqueuedAt: dropped.enqueuedAt ?? null,
      }, 'warn')
    },
  })
  return loadQueue().some((queued) => offlineOpsShareIdentity(queued, op))
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

function queuedOpAthleteTarget(op: OfflineOp): string | null {
  const scoped = (typeof op.payload.athlete_id === 'string' ? op.payload.athlete_id : null)
    ?? op.scopeAthleteId
    ?? null
  return op.table === 'athletes' && typeof op.payload.id === 'string'
    ? op.payload.id
    : scoped
}

async function resolveLegacyQueuedSessionAthleteId(
  op: OfflineOp,
  cache: Map<string, string | null>,
): Promise<string | null> {
  // Compatibilidad con colas previas a scopeAthleteId: el RPC solo persistía
  // p_session_id, pero la sesión local conserva el dueño hasta el purge.
  if (op.action === 'session_completion' && typeof op.payload.p_session_id === 'string') {
    const sessionId = op.payload.p_session_id
    if (cache.has(sessionId)) return cache.get(sessionId) ?? null
    const athleteId = (await db.sessions.get(sessionId))?.athleteId ?? null
    cache.set(sessionId, athleteId)
    return athleteId
  }
  return null
}

async function executeSessionTargetReplay(op: OfflineOp): Promise<void> {
  if (!op.sessionTarget || !isRemoteSessionTarget(op.sessionTarget)) {
    throw new Error('Invalid queued session target')
  }
  const sessionId = op.payload.id
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('Invalid queued session id')
  }
  if (op.action === 'delete') {
    await executeSessionTargetDelete(sessionId, op.sessionTarget)
    rememberSessionDeleteTombstone(op.userId, sessionId)
    return
  }
  if (op.action !== 'upsert') throw new Error('Invalid queued session target action')
  await executeSessionTargetUpsertRow(op.payload, sessionId, op.sessionTarget, op.userId)
}

interface QueueRetryReplacement {
  original: OfflineOp
  replacement: OfflineOp
  errorInfo: SyncErrorInfo | null
}

/**
 * Escritura remota de una fila de `athletes`. Única para el camino directo y el
 * drenaje de cola: la op encolada conserva `action: 'upsert'`, pero la decisión
 * de cómo empujarla se toma acá, al momento de enviar.
 *
 * Un atleta del roster que no es propio sólo admite UPDATE. PostgreSQL evalúa el
 * `WITH CHECK` de `athletes_insert_bootstrap_owner` (`auth.uid() = owner_account_id`)
 * ANTES de resolver `ON CONFLICT`, así que el upsert de una fila ajena se rechaza
 * aunque exista (medido en `031`). `athletes_write_coach` autoriza el UPDATE por
 * membresía. Sólo viajan las columnas mutables: owner/linked están protegidas por
 * trigger y `created_at` no se reescribe.
 */
async function pushAthleteRowRemote(payload: Record<string, unknown>, userId: string): Promise<void> {
  if (payload.owner_account_id === userId) {
    const { error } = await getSupabase().from('athletes').upsert(payload as never)
    if (error) throw error
    await acknowledgeLocalMembershipCreation(userId, payload.id as string)
    return
  }
  const id = payload.id as string
  const patch = {
    display_name: payload.display_name ?? null,
    status: payload.status,
    updated_at: payload.updated_at,
  }
  const { data, error } = await getSupabase()
    .from('athletes')
    .update(patch as never)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`athletes update affected no rows: no coach membership over ${id}`)
  }
}

type AthleteRemoteDeleteOutcome = 'deleted' | 'gone' | 'denied'

/**
 * Borrado remoto de un atleta por `id`; la autorización es la RLS
 * (`athletes_delete_membership`), no un filtro por owner que para un atleta
 * transferido borraría cero filas en silencio. Compartido por el camino directo,
 * `deleteRow` y el drenaje de cola.
 */
async function deleteAthleteRowRemote(athleteId: string): Promise<AthleteRemoteDeleteOutcome> {
  const deleted = await getSupabase().from('athletes').delete().eq('id', athleteId).select('id')
  if (deleted.error) throw deleted.error
  if (Array.isArray(deleted.data) && deleted.data.length > 0) return 'deleted'

  const probe = await getSupabase().from('athletes').select('id').eq('id', athleteId)
  if (probe.error) throw probe.error
  return Array.isArray(probe.data) && probe.data.length > 0 ? 'denied' : 'gone'
}

function assertAthleteDeleteApplied(athleteId: string, outcome: AthleteRemoteDeleteOutcome): void {
  if (outcome === 'denied') {
    // `classifySyncError` lo reconoce (Step 3): validation_error, no reintentable.
    throw new Error(`athletes delete denied: no coach membership over ${athleteId}`)
  }
}



async function drainQueue(): Promise<boolean> {
  const userId = getUserId()
  if (!userId) {
    startSyncAttempt()
    finishSyncAttempt('idle')
    return loadQueue().length === 0
  }

  return drainQueueDedup.run(userId, async () => {
  const attemptId = ++syncAttemptCounter
  startSyncAttempt()
  const queue = loadQueue()
  const athleteTombstones = getAthleteDeleteTombstoneSnapshot()

  const otherUsersQueue = queue.filter((op) => op.userId !== userId)
  // Drain por tier: A primero (perfil/sesiones/planes), luego B, luego C (chat/coach).
  const currentUserQueue = sortQueueByTier(queue.filter((op) => op.userId === userId))
  const pendingRemoteWipeTables = getPendingRemoteWipeTables(userId)

  if (currentUserQueue.length === 0) {
    saveQueue(otherUsersQueue)
    finishSyncAttempt('idle')
    return true
  }

  const expiredOps: OfflineOp[] = []
  const silentlyDroppedOps: OfflineOp[] = []
  const consumedVersions: OfflineOp[] = []
  const retryReplacements: QueueRetryReplacement[] = []
  const legacySessionAthleteIds = new Map<string, string | null>()
  const initialCount = currentUserQueue.length
  let madeSnapshotProgress = false

  for (const op of currentUserQueue) {
    const opRetryCount = op.retryCount ?? 0
    const athleteProfileWriteSource = op.table === 'athlete_profiles'
      ? getAthleteProfileWriteSource(op.payload)
      : 'automatic'

    if (pendingRemoteWipeTables.has(op.table)) {
      continue
    }

    let opTarget = queuedOpAthleteTarget(op)
    // Las operaciones nuevas ya traen scopeAthleteId. Solo pagamos el read
    // Dexie de compatibilidad cuando existe algún delete que pueda vetarlas.
    if (!opTarget && athleteTombstones.hasAny()) {
      opTarget = await resolveLegacyQueuedSessionAthleteId(op, legacySessionAthleteIds)
    }
    if (op.action !== 'delete' && opTarget && athleteTombstones.hasAthlete(opTarget)) {
      syncLog('drain:athlete_tombstoned_drop', { table: op.table, action: op.action }, 'warn')
      silentlyDroppedOps.push(op)
      consumedVersions.push(op)
      madeSnapshotProgress = true
      continue
    }

    if (op.table === 'athlete_profiles' && !canWriteAthleteProfileLocally(athleteProfileWriteSource, op.userId)) {
      if (
        athleteProfileWriteSource === 'post_reset_onboarding' &&
        hasPendingRemoteWipeForTable(op.userId, 'athlete_profiles')
      ) {
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
      consumedVersions.push(op)
      madeSnapshotProgress = true
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
        kind: op.action === 'delete' ? 'delete' : 'push',
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
      consumedVersions.push(op)
      madeSnapshotProgress = true
      continue
    }

    if (op.table === 'sessions' && op.sessionTarget && !isRemoteSessionTarget(op.sessionTarget)) {
      syncLog('queue:invalid_session_target_drop', { attemptId }, 'warn')
      silentlyDroppedOps.push(op)
      consumedVersions.push(op)
      madeSnapshotProgress = true
      continue
    }

    const opStartedAt = Date.now()
    const execution = { superseded: false }
    const replay = { outcome: { status: 'done' } as WeekSummaryExecutionOutcome }
    try {
      await trackInFlightAthleteOp(opTarget, withSerializedEntityMutation(op.userId, op.table, op.payload, async () => {
        const persisted = loadQueue().find((queued) => offlineOpsShareIdentity(queued, op))
        if (!persisted || !isSameQueuedOpVersion(persisted, op)) {
          execution.superseded = true
          return
        }
        if (
          op.table === 'week_summaries'
          && op.action === 'upsert'
          && op.replayKind === 'weekSummaryForAthlete'
          && op.scopeAthleteId
        ) {
          replay.outcome = await executeWeekSummaryForAthleteRow(
            rowToWeekSummary(op.payload),
            op.scopeAthleteId,
            op.userId,
          )
        } else if (op.table === 'sessions' && op.sessionTarget) {
          await executeSessionTargetReplay(op)
        } else if (op.action === 'upsert') {
          // Una operación encolada antes de que el scope estuviera resuelto
          // puede no traer `athlete_id`. Repararla es preferible a descartarla:
          // sin scope la fila sería inalcanzable tras 031, y con scope se envía
          // igual que cualquier otra. Si tampoco ahora resuelve, el guard de
          // `assertAthleteScopedPayload` la corta como no reintentable.
          const upsertPayload = withAthleteId(op.payload)
          assertAthleteScopedPayload(op.table, upsertPayload)
          if (op.table !== 'athletes' && upsertPayload.athlete_id != null) {
            await withRequestTimeout(
              ensureRemoteAthlete(
                op.userId,
                typeof upsertPayload.athlete_id === 'string' ? upsertPayload.athlete_id : undefined,
              ),
              'athletes.ensure',
            )
          }
          if (op.table === 'athlete_profiles') {
            await withRequestTimeout(upsertAthleteProfileRow(upsertPayload, op.userId), `${op.table}.upsert`)
          } else if (op.table === 'athletes') {
            await withRequestTimeout(pushAthleteRowRemote(upsertPayload, op.userId), 'athletes.push')
          } else {
            const { error } = await withRequestTimeout(
              getSupabase().from(op.table).upsert(upsertPayload as never),
              `${op.table}.upsert`,
            )
            if (error) throw error
          }
        } else if (op.action === 'session_completion') {
          const { data, error } = await withRequestTimeout(
            getSupabase().rpc('mark_session_done', op.payload as never),
            'sessions.mark_session_done',
          )
          if (error) throw error
          if (data !== true) {
            syncLog('sessions:mark_done_skipped', {
              sessionId: op.payload.p_session_id ?? null,
            }, 'warn')
          }
        } else {
          const payload = op.payload as { id: string; userId?: string }
          const targetUserId = payload.userId ?? op.userId
          if (op.table === 'athletes') {
            assertAthleteDeleteApplied(
              payload.id,
              await withRequestTimeout(deleteAthleteRowRemote(payload.id), 'athletes.delete'),
            )
          } else {
            const { error } = await withRequestTimeout(
              getSupabase().from(op.table).delete().eq('id', payload.id).eq('user_id', targetUserId),
              `${op.table}.delete`,
            )
            if (error) throw error
          }
          rememberDeleteTombstoneForTable(op.table, op.userId, payload.id)
        }
      }))
      if (execution.superseded) {
        madeSnapshotProgress = true
        continue
      }
      if (replay.outcome.status === 'retry') {
        retryReplacements.push({
          original: op,
          replacement: {
            ...op,
            payload: weekSummaryQueuePayload(replay.outcome.summary, op.userId),
            retryCount: opRetryCount + 1,
          },
          errorInfo: null,
        })
        continue
      }
      trackSyncEvent({
        kind: op.action === 'delete' ? 'delete' : 'push',
        status: 'ok',
        entity: op.table,
        userId: op.userId,
        durationMs: Date.now() - opStartedAt,
        detail: 'drain',
      })
      consumedVersions.push(op)
      madeSnapshotProgress = true
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
        consumedVersions.push(op)
        madeSnapshotProgress = true
        continue
      }

      // Auto-repairable: attempt repair inline for athlete_profiles duplicates
      if (errorInfo.autoRepairable && op.table === 'athlete_profiles') {
        try {
          syncStoreState().setSyncDetails({ autoRepairInProgress: true })
          const groupKey = profileGroupOf(op.payload, op.userId)
          const remoteRows = await fetchAthleteProfileRowsForGroup(op.userId, groupKey)
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
            consumedVersions.push(op)
            madeSnapshotProgress = true
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
      retryReplacements.push({
        original: op,
        replacement: {
        ...op,
        retryCount: opRetryCount + 1,
        lastErrorCategory: errorInfo.category,
        },
        errorInfo,
      })
      // IMPORTANT: continue processing other ops instead of breaking
    }
  }

  const currentQueue = loadQueue()
  const finalQueue = currentQueue.flatMap((currentOp) => {
    const retry = retryReplacements.find(({ original }) => isSameQueuedOpVersion(currentOp, original))
    if (retry) return [retry.replacement]
    if (consumedVersions.some((consumed) => isSameQueuedOpVersion(currentOp, consumed))) return []
    return [currentOp]
  })
  saveQueue(finalQueue)
  const finalUserOps = finalQueue.filter((op) => op.userId === userId)
  const retainedFailure = retryReplacements.find(({ replacement, errorInfo }) =>
    errorInfo && finalQueue.some((queued) => isSameQueuedOpVersion(queued, replacement)))
  const retainedInternalRetry = retryReplacements.some(({ replacement, errorInfo }) =>
    errorInfo === null
    && finalQueue.some((queued) => isSameQueuedOpVersion(queued, replacement)))

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

  if (retainedInternalRetry && !retainedFailure) scheduleRetry(15000)

  if (finalUserOps.length === 0 && initialCount > 0) {
    markSyncRecovered()
  } else if (finalUserOps.length === 0) {
    markSyncHealthy()
  } else if (retainedFailure?.errorInfo) {
    applySyncFailure(
      retainedFailure.errorInfo.originalError,
      retainedFailure.errorInfo.userMessage,
      retainedFailure.original.table,
      { madeProgress: madeSnapshotProgress },
    )
  } else {
    finishSyncAttempt(
      typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'idle',
    )
  }
  return finalUserOps.length === 0
  })
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
): Promise<SyncPushOutcome> {
  if (!isEnabled()) return 'no_remote'
  if (isSchemaMismatchBlocked(table)) return 'failed'

  const userId = getUserId()
  if (!userId) return 'failed'

  const athleteProfileWriteSource = table === 'athlete_profiles'
    ? (options?.athleteProfileWriteSource ?? getAthleteProfileWriteSource(row))
    : 'automatic'
  const payload = table === 'athlete_profiles'
    ? withAthleteProfileWriteSource(stripAthleteProfileWriteSource(row), athleteProfileWriteSource)
    : row
  const payloadAthleteId = typeof payload.athlete_id === 'string' ? payload.athlete_id : null
  const guardTarget = table === 'athletes' && typeof payload.id === 'string'
    ? payload.id
    : payloadAthleteId
  if (guardTarget && hasAthleteDeleteTombstoneForAthlete(guardTarget)) {
    syncLog('upsertRow:athlete_tombstoned_skip', { table }, 'warn')
    return 'failed'
  }
  const requestedAt = Date.now()

  return trackInFlightAthleteOp(guardTarget, withSerializedEntityMutation(userId, table, payload, async () => {
    if (table === 'athlete_profiles' && !canWriteAthleteProfileLocally(athleteProfileWriteSource, userId)) {
      syncLog('athlete_profiles:write_suppressed', {
        reason: hasPendingRemoteWipeForTable(userId, 'athlete_profiles') ? 'pending_remote_wipe' : 'reset_lock',
        source: athleteProfileWriteSource,
        userId,
      }, 'warn')
      return 'failed'
    }

    if (hasPendingRemoteWipeForTable(userId, table)) {
      const queued = enqueue({ userId, table, action: 'upsert', payload, enqueuedAt: Date.now() })
      if (!queued) return 'failed'
      scheduleRetry(15000)
      return 'queued'
    }

    if (!navigator.onLine) {
      finishSyncAttempt('offline')
      syncStoreState().setSyncStatus('offline')
      const queued = enqueue({ userId, table, action: 'upsert', payload, enqueuedAt: Date.now() })
      if (!queued) return 'failed'
      scheduleRetry(15000)
      return 'queued'
    }

    startSyncAttempt()
    const upsertStartedAt = Date.now()
    try {
      assertAthleteScopedPayload(table, payload)
      if (table !== 'athletes' && payload.athlete_id != null) {
        await withRequestTimeout(
          ensureRemoteAthlete(
            userId,
            typeof payload.athlete_id === 'string' ? payload.athlete_id : undefined,
          ),
          'athletes.ensure',
        )
      }
      if (table === 'athlete_profiles') {
        await withRequestTimeout(upsertAthleteProfileRow(payload, userId), `athlete_profiles.upsert`)
      } else if (table === 'athletes') {
        await withRequestTimeout(pushAthleteRowRemote(payload, userId), 'athletes.push')
      } else {
        const { error } = await withRequestTimeout(
          getSupabase().from(table).upsert(payload as never),
          `${table}.upsert`,
        )
        if (error) {
          const handled = await reconcileNaturalKeyConflict(table, payload, userId, error)
          if (!handled) throw error
        }
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
      return 'pushed'
    } catch (error) {
      const errorInfo = classifySyncError(error, table)
      if (isOptionalPlanSchemaMismatch(errorInfo, table)) {
        trackOptionalPlanSyncSkip(table, errorInfo, 'upsert')
        finishSyncAttempt('idle')
        return 'failed'
      }
      if (!errorInfo.retriable && !errorInfo.autoRepairable) {
        syncLog('upsertRow:non_retriable', { table, category: errorInfo.category }, 'warn')
        applySyncFailure(error, errorInfo.userMessage, table)
        return 'failed'
      }
      const queued = enqueue({ userId, table, action: 'upsert', payload, enqueuedAt: Date.now() })
      applySyncFailure(error, errorInfo.userMessage, table)
      return queued ? 'queued' : 'failed'
    }
  }))
}

async function deleteRow(table: SupabaseTable, id: string): Promise<void> {
  if (!isEnabled()) return
  if (isSchemaMismatchBlocked(table)) return

  const userId = getUserId()
  if (!userId) return
  const payload = { id, userId }
  const requestedAt = Date.now()

  await withSerializedEntityMutation(userId, table, payload, async () => {
    if (hasPendingRemoteWipeForTable(userId, table)) {
      rememberDeleteTombstoneForTable(table, userId, id)
      enqueue({ userId, table, action: 'delete', payload, enqueuedAt: Date.now() })
      scheduleRetry(15000)
      return
    }

    if (!navigator.onLine) {
      finishSyncAttempt('offline')
      syncStoreState().setSyncStatus('offline')
      rememberDeleteTombstoneForTable(table, userId, id)
      enqueue({ userId, table, action: 'delete', payload, enqueuedAt: Date.now() })
      scheduleRetry(15000)
      return
    }

    startSyncAttempt()
    const deleteStartedAt = Date.now()
    try {
      if (table === 'athletes') {
        assertAthleteDeleteApplied(id, await withRequestTimeout(deleteAthleteRowRemote(id), 'athletes.delete'))
      } else {
        const { error } = await withRequestTimeout(
          getSupabase().from(table).delete().eq('id', id).eq('user_id', userId),
          `${table}.delete`,
        )
        if (error) throw error
      }
      rememberDeleteTombstoneForTable(table, userId, id)
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
      if (isOptionalPlanSchemaMismatch(errorInfo, table)) {
        trackOptionalPlanSyncSkip(table, errorInfo, 'delete')
        finishSyncAttempt('idle')
        return
      }
      if (!errorInfo.retriable && !errorInfo.autoRepairable) {
        syncLog('deleteRow:non_retriable', { table, category: errorInfo.category }, 'warn')
        applySyncFailure(error, errorInfo.userMessage, table)
        return
      }
      rememberDeleteTombstoneForTable(table, userId, id)
      enqueue({ userId, table, action: 'delete', payload, enqueuedAt: Date.now() })
      applySyncFailure(error, `No se pudo eliminar en sync ${table}.`, table)
    }
  })
}

export type ManagedAthleteRemoteDeleteResult = 'deleted' | 'durably_queued' | 'failed'

/**
 * Deletes a managed athlete remotely without draining unrelated queued work.
 * The caller owns a previously verified delete tombstone and is responsible
 * for rolling that tombstone back when this function returns `failed`.
 */
export async function deleteManagedAthleteRemote(
  ownerAccountId: string,
  athleteId: string,
): Promise<ManagedAthleteRemoteDeleteResult> {
  if (!hasAthleteDeleteTombstone(ownerAccountId, athleteId)) {
    syncLog('deleteManagedAthleteRemote:missing_tombstone_precondition', { athleteId }, 'warn')
    return 'failed'
  }

  if (!isEnabled()) return 'deleted'

  const queueCanonicalDelete = (): ManagedAthleteRemoteDeleteResult => {
    enqueue({
      userId: ownerAccountId,
      table: 'athletes',
      action: 'delete',
      payload: { id: athleteId },
      enqueuedAt: Date.now(),
    })
    const landed = loadQueue().some((op) =>
      op.userId === ownerAccountId &&
      op.table === 'athletes' &&
      op.action === 'delete' &&
      op.payload.id === athleteId)
    if (!landed) {
      syncLog('deleteManagedAthleteRemote:queue_not_durable', { athleteId }, 'warn')
      return 'failed'
    }
    return 'durably_queued'
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) return queueCanonicalDelete()

  try {
    const outcome = await withRequestTimeout(deleteAthleteRowRemote(athleteId), 'athletes.delete')
    if (outcome === 'denied') {
      // La RLS deja leer y no borrar: sin membresía coach, o el atleta conserva un
      // self. Purgar local acá dejaría al siguiente pull resucitándolo; fail closed.
      syncLog('deleteManagedAthleteRemote:denied', { athleteId }, 'warn')
      return 'failed'
    }
    if (outcome === 'gone') syncLog('deleteManagedAthleteRemote:already_gone', { athleteId })
    return 'deleted'
  } catch (error) {
    const errorInfo = classifySyncError(error, 'athletes')
    if (errorInfo.retriable || errorInfo.autoRepairable) return queueCanonicalDelete()
    syncLog('deleteManagedAthleteRemote:failed', { category: errorInfo.category }, 'warn')
    return 'failed'
  }
}

function sessionToRow(session: Session, userId: string): Record<string, unknown> {
  const { id, date, timeBlock, type, status, createdAt, updatedAt, authoredByRole, ...rest } = session
  return {
    id,
    user_id: userId,
    date,
    time_block: timeBlock,
    type,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    authored_by_role: authoredByRole ?? resolveAuthoredByRole(session.athleteId),
    updated_by_account_id: userId,
    data: rest,
  }
}

function sessionToRowWithoutUser(session: Session, actorId: string): Record<string, unknown> {
  const row = sessionToRow(session, actorId)
  delete row.user_id
  return row
}

async function supabaseMutationCount(
  query: PromiseLike<{ data: unknown; error: unknown }>,
  label: string,
): Promise<number> {
  const { data, error } = await withRequestTimeout(query, label)
  if (error) throw error
  return Array.isArray(data) ? data.length : 0
}

function coachNoteToRow(note: AthleteCoachNote, userId: string): Record<string, unknown> {
  return {
    athlete_id: note.athleteId,
    coach_memory: note.coachMemory ?? null,
    updated_by_account_id: userId,
    updated_at: note.updatedAt,
  }
}

export function sessionTemplateToRow(
  template: StoredSessionTemplate,
  userId: string,
): Record<string, unknown> {
  return {
    id: template.id,
    user_id: userId,
    name: template.name,
    kind: template.kind,
    payload_version: template.payloadVersion,
    data: template.payload,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
    deleted_at: template.deletedAt ?? null,
  }
}

export function rowToStoredSessionTemplate(
  row: Record<string, unknown>,
): StoredSessionTemplate {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    kind: String(row.kind ?? ''),
    payloadVersion: Number(row.payload_version ?? 0),
    payload: row.data,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    ...(row.deleted_at != null ? { deletedAt: Number(row.deleted_at) } : {}),
  }
}

function stampAthleteIdIfLegacy<T extends { athleteId?: string }>(
  row: T,
  activeAthleteId: string | null,
): { row: T; changed: boolean } {
  if (!activeAthleteId || isScopedAthleteId(row.athleteId)) {
    return { row, changed: false }
  }
  return { row: { ...row, athleteId: activeAthleteId } as T, changed: true }
}

const NATURAL_KEY_DATE_COLUMN: Partial<Record<SupabaseTable, 'date' | 'week_start_date'>> = {
  day_logs: 'date',
  week_summaries: 'week_start_date',
}

type NaturalKeyDateColumn = 'date' | 'week_start_date'
type NaturalKeyRemoteRow = { id: string; updated_at: unknown }

function isReconcilableNaturalKeyConflict(
  table: SupabaseTable,
  payload: Record<string, unknown>,
  error: unknown,
): boolean {
  if ((error as { code?: unknown } | null)?.code !== '23505') return false
  const dateCol = NATURAL_KEY_DATE_COLUMN[table]
  if (!dateCol) return false
  const athleteId = payload.athlete_id
  if (typeof athleteId !== 'string' || athleteId.length === 0) return false
  const dateValue = payload[dateCol]
  return typeof dateValue === 'string' && dateValue.length > 0
}

async function selectRemoteNaturalKeyRow(
  table: SupabaseTable,
  dateCol: NaturalKeyDateColumn,
  userId: string,
  athleteId: string,
  dateValue: unknown,
  label: string,
): Promise<NaturalKeyRemoteRow | undefined> {
  const { data: rows, error } = await withRequestTimeout(
    getSupabase()
      .from(table)
      .select('id, updated_at')
      .eq('user_id', userId)
      .eq('athlete_id', athleteId)
      .eq(dateCol, dateValue)
      .limit(1),
    label,
  )
  if (error) throw error
  return (rows as NaturalKeyRemoteRow[] | null)?.[0]
}

async function retryNaturalKeyUpsertOnce(
  table: SupabaseTable,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await withRequestTimeout(
    getSupabase().from(table).upsert(payload as never),
    `${table}.reconcile.retry`,
  )
  if (!error) return true
  if ((error as { code?: unknown }).code === '23505') return false
  throw error
}

/**
 * Reactive natural-key reconciliation for a `23505` on day_logs/week_summaries.
 * Returns true when the conflict is resolved (in-place update, LWW skip, or a
 * successful retry). Returns false when not reconcilable (guards), updated_at is
 * non-finite, or the retry stays 23505 (caller rethrows the original 23505). A
 * real error (network/auth/RLS) in select/update/non-23505-retry is thrown as
 * itself, so upsertRow's catch classifies it on the correct (retriable) path.
 * The local Dexie id is NOT touched; mergeDayLogs/mergeWeekSummaries converge it
 * on the next pull (see the `merges day logs by effective athlete key during a
 * full-user pull` test).
 *
 * Exported for direct unit testing of its many branches — test-visible/internal,
 * NOT part of the public sync API. Callers outside syncService should use
 * pushDayLog/pushWeekSummary.
 */
export async function reconcileNaturalKeyConflict(
  table: SupabaseTable,
  payload: Record<string, unknown>,
  userId: string,
  error: unknown,
): Promise<boolean> {
  if (!isReconcilableNaturalKeyConflict(table, payload, error)) return false
  const dateCol = NATURAL_KEY_DATE_COLUMN[table]!
  const athleteId = payload.athlete_id as string
  const dateValue = payload[dateCol]

  // 1. Locate the remote row occupying the natural key (cross-tenant defense: also user_id).
  const remote = await selectRemoteNaturalKeyRow(
    table,
    dateCol,
    userId,
    athleteId,
    dateValue,
    `${table}.reconcile.select`,
  )

  // Race: the conflicting row vanished between the failed insert and the select → retry once.
  if (!remote) {
    return retryNaturalKeyUpsertOnce(table, payload)
  }

  // updated_at coercion: never decide LWW on a non-finite timestamp.
  const localUpdatedAt = Number(payload.updated_at)
  const remoteUpdatedAt = Number(remote.updated_at)
  if (!Number.isFinite(localUpdatedAt) || !Number.isFinite(remoteUpdatedAt)) return false

  // 2. LWW: remote newer-or-equal (tie → remote wins) → skip; the next pull converges.
  if (remoteUpdatedAt >= localUpdatedAt) return true

  // local newer → atomic conditional update guarded by lt(updated_at).
  // The WHERE also re-pins athlete_id + dateCol so a concurrent scope/date change on that row
  // (rare race or a faulty update) can't make us overwrite a row that no longer owns this natural key.
  const body = { ...payload }
  delete (body as Record<string, unknown>).id
  const { data: updatedRows, error: updateError } = await withRequestTimeout(
    getSupabase()
      .from(table)
      .update(body as never)
      .eq('id', remote.id)
      .eq('user_id', userId)
      .eq('athlete_id', athleteId)
      .eq(dateCol, dateValue)
      .lt('updated_at', localUpdatedAt)
      .select('id'),
    `${table}.reconcile.update`,
  )
  if (updateError) throw updateError // real error surfaces; 0-rows is NOT an error (data: [], error: null)
  if (Array.isArray(updatedRows) && updatedRows.length > 0) return true

  // 0 rows can mean a concurrent remote winner, or that the row vanished/changed natural key.
  // Re-check the natural key before declaring the push handled.
  const currentRemote = await selectRemoteNaturalKeyRow(
    table,
    dateCol,
    userId,
    athleteId,
    dateValue,
    `${table}.reconcile.recheck`,
  )
  if (currentRemote) return true
  return retryNaturalKeyUpsertOnce(table, payload)
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
    athleteId: getRemoteRowAthleteId(row),
    authoredByRole: (row.authored_by_role ?? data.authoredByRole ?? undefined) as Session['authoredByRole'],
  } as Session
}

/**
 * Sessions use the backend as the stable authority when two distinct payloads
 * carry the same timestamp. Without this tie-break, each device can retain its
 * own version indefinitely because neither side is strictly newer.
 */
function remoteSessionWins(local: Session, remote: Session): boolean {
  return remote.updatedAt >= local.updatedAt
}

function dayLogToRow(log: DayLog, userId: string): Record<string, unknown> {
  const { id, date, updatedAt, ...rest } = log
  return {
    id,
    user_id: userId,
    date,
    updated_at: updatedAt,
    updated_by_account_id: userId,
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
    athleteId: getRemoteRowAthleteId(row),
  } as DayLog
}

function weekSummaryToRow(summary: WeekSummary, userId: string): Record<string, unknown> {
  const { id, weekStartDate, updatedAt, ...rest } = summary
  return {
    id,
    user_id: userId,
    week_start_date: weekStartDate,
    updated_at: updatedAt ?? 0,
    updated_by_account_id: userId,
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
    athleteId: getRemoteRowAthleteId(row),
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
    athleteId: getRemoteRowAthleteId(row),
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
    athleteId: getRemoteRowAthleteId(row),
  } as CoachProposal
}

async function fetchAthleteProfileRows(userId: string): Promise<AthleteProfileSyncRow[]> {
  return (await fetchAll<Record<string, unknown>>('athlete_profiles', userId))
    .map(toAthleteProfileSyncRow)
}

// Prefer the hydrated holder, but never group with a null self: before hydration,
// the deterministic owner id still identifies the self row produced by SQL/client backfills.
function groupingSelfAthleteId(userId: string): string {
  return getSelfAthleteId() ?? athleteIdForOwner(userId)
}

function profileGroupOf(row: Record<string, unknown>, userId: string): string {
  const athleteId = row.athlete_id
  return athleteProfileGroupKey(
    typeof athleteId === 'string' ? athleteId : null,
    groupingSelfAthleteId(userId),
  )
}

async function fetchAthleteProfileRowsForGroup(
  userId: string,
  groupKey: string,
): Promise<AthleteProfileSyncRow[]> {
  const selfAthleteId = groupingSelfAthleteId(userId)
  const rows = await fetchAthleteProfileRows(userId)
  return rows.filter((row) => athleteProfileGroupKey(row.athlete_id, selfAthleteId) === groupKey)
}

async function fetchRemoteFullResetAt(userId: string): Promise<number | null> {
  const rows = await fetchAthleteProfileRows(userId)
  let latest: number | null = null

  for (const row of rows) {
    const isLegacySelf = row.athlete_id == null && row.user_id === userId
    if (row.athlete_id !== groupingSelfAthleteId(userId) && !isLegacySelf) continue
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
  await clearAllLocalAppDataForSync(userId)
  acknowledgeRemoteFullReset(userId, remoteResetAt)
  markProfileResetLockStatus(userId, 'awaiting_onboarding_recreation', remoteResetAt)
  return remoteResetAt
}

async function deleteAthleteProfileRowsById(ids: string[]): Promise<void> {
  const normalizedIds = [...new Set(ids)].filter(Boolean)
  if (normalizedIds.length === 0) return

  const { error } = await getSupabase()
    .from('athlete_profiles')
    .delete()
    .in('id', normalizedIds)

  if (error) throw error
}

function athleteProfilePersistencePayload(
  row: AthleteProfileSyncRow,
  updatedByAccountId: string,
): Record<string, unknown> {
  return {
    athlete_id: (row as Record<string, unknown>).athlete_id ?? null,
    updated_by_account_id: updatedByAccountId,
    updated_at: row.updated_at,
    data: row.data,
  }
}

async function repairRemoteAthleteProfileRows(
  userId: string,
  rows: AthleteProfileSyncRow[],
  preferredRow?: AthleteProfileSyncRow,
): Promise<AthleteProfileSyncRow> {
  const candidates = preferredRow ? [...rows, preferredRow] : [...rows]
  const winner = coalesceAthleteProfileRows(candidates)
  const winnerGroupKey = profileGroupOf(winner as unknown as Record<string, unknown>, userId)
  const canonical: AthleteProfileSyncRow = {
    ...winner,
    user_id: userId,
    athlete_id: winnerGroupKey === ATHLETE_PROFILE_SELF_GROUP ? groupingSelfAthleteId(userId) : winnerGroupKey,
  }
  const keeper = rows.find((row) => row.id === winner.id) ?? rows[0]
  const nextRow: AthleteProfileSyncRow = {
    ...canonical,
    id: keeper?.id ?? ATHLETE_PROFILE_LOCAL_ID,
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
      .update(athleteProfilePersistencePayload(normalized, userId) as never)
      .eq('id', keeper.id)

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
        ...athleteProfilePersistencePayload(normalized, userId),
      } as never)

    if (insertError) {
      throw new Error(classifyAthleteProfileSyncError(insertError))
    }
  }

  const loserIds = rows
    .filter((row) => row.id !== nextRow.id)
    .map((row) => row.id)

  if (loserIds.length > 0) {
    await deleteAthleteProfileRowsById(loserIds)
  }

  const repairedRows = await fetchAthleteProfileRows(userId)

  logAthleteProfileSync('repair:done', {
    remoteRowsAfterUpsert: repairedRows.length,
    deletedIds: loserIds,
  })

  return nextRow
}

/**
 * Repairs duplicates within one profile group. Callers must pre-filter rows by
 * athleteProfileGroupKey so self and managed profiles are never treated as
 * duplicates of each other.
 *
 * Idempotent write for athlete_profiles.
 * Strategy:
 * 1. If composite unique exists → use upsert with onConflict
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
  const existingRows = remoteRows ?? await fetchAthleteProfileRowsForGroup(
    userId,
    profileGroupOf(profileRow as unknown as Record<string, unknown>, userId),
  )

  if (mode === 'technical_marker') {
    const keeper = existingRows[0]
    const normalized = normalizeAthleteProfilePayload(profileRow)

    if (!keeper) {
      const { error } = await getSupabase()
        .from('athlete_profiles')
        .upsert({
          id: normalized.id,
          user_id: userId,
          ...athleteProfilePersistencePayload(normalized, userId),
        } as never, { onConflict: 'athlete_id' })
      if (error) throw error
      return
    }

    const { error } = await getSupabase()
      .from('athlete_profiles')
      .update(athleteProfilePersistencePayload(normalized, userId) as never)
      .eq('id', keeper.id)

    if (error) throw error

    const loserIds = existingRows
      .filter((candidate) => candidate.id !== keeper.id)
      .map((candidate) => candidate.id)

    if (loserIds.length > 0) {
      await deleteAthleteProfileRowsById(loserIds)
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
    // Try upsert with onConflict first (requires composite unique).
    const { error } = await getSupabase()
      .from('athlete_profiles')
      .upsert({
        id: rowToPersist.id,
        user_id: userId,
        ...athleteProfilePersistencePayload(rowToPersist, userId),
      } as never, { onConflict: 'athlete_id' })
    if (error) throw error
    return
  }

  const { error } = await getSupabase()
    .from('athlete_profiles')
    .update(athleteProfilePersistencePayload(rowToPersist, userId) as never)
    .eq('id', existingRow.id)

  if (error) throw error
}

async function upsertAthleteProfileRow(row: Record<string, unknown>, userId: string): Promise<void> {
  const writeSource = getAthleteProfileWriteSource(row)
  const persistMode: AthleteProfilePersistMode = writeSource === 'post_reset_onboarding'
    ? 'post_reset_onboarding'
    : 'normal'
  const profileRow = toAthleteProfileSyncRow(stripAthleteProfileWriteSource(row))
  const groupKey = profileGroupOf(profileRow as unknown as Record<string, unknown>, userId)
  const remoteRows = await fetchAthleteProfileRowsForGroup(userId, groupKey)

  logAthleteProfileSync('push:attempt', {
    writeSource,
    groupKey,
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

/**
 * Dual-write helper (Athlete Scope Foundation, Fase D): attach the top-level
 * `athlete_id` column to a remote row, preferring the entity's own scope, else
 * the hydrated active athlete, else the self athlete.
 *
 * The self fallback is not cosmetic. Before `031` an unresolved scope produced a
 * row with `athlete_id` null, which the legacy `auth.uid() = user_id` policies
 * still accepted; once membership is the only RLS authority that same row is
 * unreachable, because every v2 predicate is `athlete_id in (…)` and that is
 * FALSE for null. Anchoring the last resort to the self athlete matches the
 * project rule that legacy/unscoped rows belong to the self and nobody else.
 *
 * If not even the self athlete resolves, the column is still omitted — and
 * `upsertRow` refuses to send the row. Failing here beats writing a row that
 * nobody will be able to read.
 */
function withAthleteId(row: Record<string, unknown>, entityAthleteId?: string): Record<string, unknown> {
  if (row.athlete_id != null) return row
  const athleteId = entityAthleteId ?? getActiveAthleteId() ?? getSelfAthleteId() ?? undefined
  return athleteId ? { ...row, athlete_id: athleteId } : row
}

/**
 * Tables whose RLS becomes membership-only with `031`. A row without
 * `athlete_id` in any of them is unreachable after the cut, so it is refused
 * before it reaches the network instead of being stored as a permanent orphan.
 * `athletes` is excluded: its scope is the `id` column itself.
 */
const ATHLETE_SCOPED_WRITE_TABLES: ReadonlySet<SupabaseTable> = new Set<SupabaseTable>([
  'sessions',
  'day_logs',
  'week_summaries',
  'chat_messages',
  'coach_proposals',
  'athlete_profiles',
  'training_plans',
  'training_plan_weeks',
])

function assertAthleteScopedPayload(table: SupabaseTable, payload: Record<string, unknown>): void {
  if (!ATHLETE_SCOPED_WRITE_TABLES.has(table)) return
  if (payload.athlete_id != null) return
  // `classifySyncError` reconoce este mensaje y lo marca no reintentable: la
  // fila local se conserva y un sync posterior la reintenta cuando el atleta
  // resuelva; encolarla sólo gastaría intentos contra un dato irreparable.
  throw new Error(`missing athlete scope on ${table}: refusing to write an unscoped row`)
}

async function ensureRemoteAthleteOnce(userId: string): Promise<void> {
  if (!isEnabled()) return

  const athleteId = await backfillLocalAthleteScope(userId)
  if (athleteId === null) return
  if (hasAthleteDeleteTombstoneForAthlete(athleteId)) {
    throw new Error(`athlete ${athleteId} is being deleted; refusing to recreate`)
  }
  await hydrateActiveAthlete(userId)

  if (athleteId !== athleteIdForOwner(userId)) return

  const now = Date.now()
  const localAthlete = await db.athletes.get(athleteId)
  const athlete: Athlete = localAthlete ?? {
    id: athleteId,
    ownerAccountId: userId,
    linkedAccountId: userId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  const { error } = await getSupabase()
    .from('athletes')
    .upsert(athleteToRow(athlete) as never, { onConflict: 'id' })
  if (error) throw error
}

async function ensureRemoteManagedAthleteOnce(userId: string, athleteId: string): Promise<void> {
  if (!isEnabled()) return
  if (hasAthleteDeleteTombstoneForAthlete(athleteId)) {
    throw new Error(`athlete ${athleteId} is being deleted; refusing to recreate`)
  }

  const local = await db.athletes.get(athleteId)
  if (!local) {
    throw new Error(`managed athlete ${athleteId} not found locally; deferring child push`)
  }
  if (local.ownerAccountId !== userId) {
    // Un atleta del roster que no es propio (transferido) existe remotamente por
    // construcción: la membresía lo referencia por FK. No hay nada que asegurar,
    // y un upsert de una fila ajena se rechaza por `athletes_insert_bootstrap_owner`.
    if (await hasCoachMembership(userId, athleteId)) return
    throw new Error(`managed athlete ${athleteId} not found locally; deferring child push`)
  }

  await pushAthleteRowRemote({ ...athleteToRow(local) }, userId)
}

async function ensureRemoteAthlete(userId: string, athleteId?: string): Promise<void> {
  if (athleteId && hasAthleteDeleteTombstoneForAthlete(athleteId)) {
    throw new Error(`athlete ${athleteId} is being deleted; refusing to recreate`)
  }
  const selfAthleteId = getSelfAthleteId()
  const isManaged = typeof athleteId === 'string'
    && isScopedAthleteId(athleteId)
    && athleteId !== (selfAthleteId ?? athleteIdForOwner(userId))
  const cacheKey = isManaged ? `${userId}::${athleteId}` : userId
  const existing = remoteAthleteEnsurePromises.get(cacheKey)
  if (existing) return existing

  const promise = (isManaged
    ? ensureRemoteManagedAthleteOnce(userId, athleteId)
    : ensureRemoteAthleteOnce(userId)
  ).finally(() => {
    remoteAthleteEnsurePromises.delete(cacheKey)
  })
  remoteAthleteEnsurePromises.set(cacheKey, promise)
  return promise
}

export async function pushSession(session: Session): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  if (session.authoredByRole === 'coach' && await shouldRouteSessionCompletionViaRpc(session, userId)) {
    await pushSessionCompletion(session, userId)
    return
  }
  await upsertRow('sessions', withAthleteId(sessionToRow(session, userId), session.athleteId))
}

/** Session-template deletion is a tombstone upsert, never a remote DELETE. */
export async function pushSessionTemplate(template: StoredSessionTemplate): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('session_templates', sessionTemplateToRow(template, userId))
}

function sessionTargetAthleteId(target: RemoteSessionTarget): string {
  return target.kind === 'scoped' ? target.athleteId : target.selfAthleteId
}

function enqueueSessionTargetOp(
  action: 'upsert' | 'delete',
  session: Session,
  target: RemoteSessionTarget,
  userId: string,
): void {
  enqueue({
    userId,
    table: 'sessions',
    action,
    payload: action === 'delete'
      ? { id: session.id, userId }
      : sessionToRowWithoutUser(session, userId),
    enqueuedAt: Date.now(),
    scopeAthleteId: sessionTargetAthleteId(target),
    sessionTarget: target,
  })
}

async function stampLocalSessionAdopted(sessionId: string, selfAthleteId: string): Promise<void> {
  await runAthleteWrite(selfAthleteId, async () => {
    const current = await db.sessions.get(sessionId)
    if (!current || isScopedAthleteId(current.athleteId)) return
    await db.sessions.update(sessionId, { athleteId: selfAthleteId })
  })
}

async function executeSessionTargetUpsertRow(
  rowInput: Record<string, unknown>,
  sessionId: string,
  target: RemoteSessionTarget,
  userId: string,
): Promise<void> {
  const scopeAthleteId = sessionTargetAthleteId(target)
  const row: Record<string, unknown> = {
    ...rowInput,
    id: sessionId,
    athlete_id: scopeAthleteId,
    updated_by_account_id: userId,
  }
  delete row.user_id

  if (target.kind === 'scoped') {
    const updated = await supabaseMutationCount(
      getSupabase().from('sessions').update(row as never)
        .eq('id', sessionId).eq('athlete_id', target.athleteId).select('id'),
      'sessions.update_scoped',
    )
    if (updated === 0) {
      await ensureRemoteAthlete(userId, target.athleteId)
      const { error } = await withRequestTimeout(
        getSupabase().from('sessions').insert({
          ...row,
          user_id: userId,
          athlete_id: target.athleteId,
        } as never),
        'sessions.insert_scoped',
      )
      if (error) throw error
    }
    return
  }

  const adopted = await supabaseMutationCount(
    getSupabase().from('sessions').update(row as never)
      .eq('id', sessionId)
      .eq('user_id', target.ownerAccountId)
      .is('athlete_id', null)
      .select('id'),
    'sessions.update_legacy',
  )
  let confirmed = adopted > 0
  if (!confirmed) {
    confirmed = (await supabaseMutationCount(
      getSupabase().from('sessions').update(row as never)
        .eq('id', sessionId).eq('athlete_id', target.selfAthleteId).select('id'),
      'sessions.update_adopted',
    )) > 0
  }
  if (!confirmed) {
    await ensureRemoteAthlete(userId, target.selfAthleteId)
    const { error } = await withRequestTimeout(
      getSupabase().from('sessions').insert({ ...row, user_id: userId } as never),
      'sessions.insert_after_legacy',
    )
    if (error) throw error
  }
  await stampLocalSessionAdopted(sessionId, target.selfAthleteId)
}

async function executeSessionTargetDelete(
  sessionId: string,
  target: RemoteSessionTarget,
): Promise<void> {
  if (target.kind === 'scoped') {
    const { error } = await withRequestTimeout(
      getSupabase().from('sessions').delete()
        .eq('id', sessionId).eq('athlete_id', target.athleteId),
      'sessions.delete_scoped',
    )
    if (error) throw error
    return
  }
  const deleted = await supabaseMutationCount(
    getSupabase().from('sessions').delete()
      .eq('id', sessionId)
      .eq('user_id', target.ownerAccountId)
      .is('athlete_id', null)
      .select('id'),
    'sessions.delete_legacy',
  )
  if (deleted === 0) {
    const { error } = await withRequestTimeout(
      getSupabase().from('sessions').delete()
        .eq('id', sessionId).eq('athlete_id', target.selfAthleteId),
      'sessions.delete_adopted',
    )
    if (error) throw error
  }
}

export async function pushSessionForTarget(
  session: Session,
  target: RemoteSessionTarget,
): Promise<void> {
  const userId = getUserId()
  if (!userId || !isEnabled()) return
  const scopeAthleteId = sessionTargetAthleteId(target)
  if (hasAthleteDeleteTombstoneForAthlete(scopeAthleteId)) return
  const requestedAt = Date.now()
  const identity = { id: session.id }
  await trackInFlightAthleteOp(scopeAthleteId, withSerializedEntityMutation(
    userId,
    'sessions',
    identity,
    async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        enqueueSessionTargetOp('upsert', session, target, userId)
        scheduleRetry(15000)
        return
      }
      try {
        await executeSessionTargetUpsertRow(
          sessionToRowWithoutUser(session, userId), session.id, target, userId,
        )
        clearQueuedOpsForEntityOlderThan(userId, 'sessions', identity, requestedAt)
      } catch (error) {
        const info = classifySyncError(error, 'sessions')
        if (info.retriable || info.autoRepairable) {
          enqueueSessionTargetOp('upsert', session, target, userId)
          applySyncFailure(error, info.userMessage, 'sessions')
          return
        }
        applySyncFailure(error, info.userMessage, 'sessions')
      }
    },
  ))
}

export async function deleteSessionForTarget(
  sessionId: string,
  target: RemoteSessionTarget,
): Promise<void> {
  const userId = getUserId()
  if (!userId || !isEnabled()) return
  const scopeAthleteId = sessionTargetAthleteId(target)
  if (hasAthleteDeleteTombstoneForAthlete(scopeAthleteId)) return
  const requestedAt = Date.now()
  const identity = { id: sessionId }
  await trackInFlightAthleteOp(scopeAthleteId, withSerializedEntityMutation(
    userId,
    'sessions',
    identity,
    async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        enqueueSessionTargetOp('delete', { id: sessionId } as Session, target, userId)
        scheduleRetry(15000)
        return
      }
      try {
        await executeSessionTargetDelete(sessionId, target)
        rememberSessionDeleteTombstone(userId, sessionId)
        clearQueuedOpsForEntityOlderThan(userId, 'sessions', identity, requestedAt)
      } catch (error) {
        const info = classifySyncError(error, 'sessions')
        if (info.retriable || info.autoRepairable) {
          enqueueSessionTargetOp('delete', { id: sessionId } as Session, target, userId)
          applySyncFailure(error, info.userMessage, 'sessions')
          return
        }
        applySyncFailure(error, info.userMessage, 'sessions')
      }
    },
  ))
}

export async function pushCoachNote(note: AthleteCoachNote): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('athlete_coach_notes', coachNoteToRow(note, userId))
}

async function pushSessionCompletion(session: Session, userId: string): Promise<void> {
  if (!isEnabled()) return
  if (session.athleteId && hasAthleteDeleteTombstoneForAthlete(session.athleteId)) {
    syncLog('sessionCompletion:athlete_tombstoned_skip', { sessionId: session.id }, 'warn')
    return
  }
  return trackInFlightAthleteOp(
    session.athleteId ?? null,
    pushSessionCompletionInner(session, userId),
  )
}

async function pushSessionCompletionInner(session: Session, userId: string): Promise<void> {
  const payload = buildMarkSessionDoneParams(session) as unknown as Record<string, unknown>
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueue({ userId, table: 'sessions', action: 'session_completion', payload, scopeAthleteId: session.athleteId, enqueuedAt: Date.now() })
    scheduleRetry(15000)
    return
  }
  try {
    const { data, error } = await withRequestTimeout(
      getSupabase().rpc('mark_session_done', payload as never),
      'sessions.mark_session_done',
    )
    if (error) throw error
    if (data !== true) syncLog('sessions:mark_done_skipped', { sessionId: session.id }, 'warn')
  } catch (error) {
    const errorInfo = classifySyncError(error, 'sessions')
    if (!errorInfo.retriable && !errorInfo.autoRepairable) {
      applySyncFailure(error, errorInfo.userMessage, 'sessions')
      return
    }
    enqueue({ userId, table: 'sessions', action: 'session_completion', payload, scopeAthleteId: session.athleteId, enqueuedAt: Date.now() })
    applySyncFailure(error, 'No se pudo sincronizar la completación de la sesión.', 'sessions')
  }
}

export async function pushAthlete(athlete: Athlete): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  if (athlete.ownerAccountId !== userId && !(await getRoleForAthlete(userId, athlete.id))) return
  const outcome = await upsertRow('athletes', athleteToRow(athlete) as unknown as Record<string, unknown>)
  if (outcome === 'pushed') rememberRemoteAthleteAcknowledgements(userId, [athlete.id])
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
    const base = getSupabase().from('sessions').select('*')
    const activeAthleteId = getActiveAthleteId()
    const scoped = activeAthleteId
      ? activeAthleteId === getSelfAthleteId()
        ? base.or(`athlete_id.eq.${activeAthleteId},and(athlete_id.is.null,user_id.eq.${userId})`)
        : base.eq('athlete_id', activeAthleteId)
      : base.eq('user_id', userId)
    const query = scoped
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
      if (resolveSessionAgainstTombstone(userId, remote, tombstones) === 'skip') {
        await deleteRow('sessions', remote.id)
        continue
      }

      await runAthleteWrite(remote.athleteId, async () => {
        const local = await db.sessions.get(remote.id)
        if (!local || remoteSessionWins(local, remote)) {
          await db.sessions.put(remote)
        } else {
          await pushSession(local)
        }
      })
    }

    if (!supportsRange || page.length < FETCH_PAGE_SIZE) break
  }
}

function resolveSessionAgainstTombstone(
  userId: string,
  remote: Session,
  tombstones: Record<string, number>,
): 'skip' | 'accept' {
  const deletedAt = tombstones[remote.id]
  if (typeof deletedAt !== 'number') return 'accept'
  if (deletedAt >= remote.updatedAt) return 'skip'
  clearSessionDeleteTombstone(userId, remote.id)
  delete tombstones[remote.id]
  return 'accept'
}

/** Pulls one explicit athlete/week without changing the active-athlete scope. */
export type AthleteWeekPullOutcome = 'completed' | 'unavailable' | 'vetoed'

export async function pullWeekSessionsForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
  weekEndDate: string,
  opts: { includeLegacy: boolean },
): Promise<AthleteWeekPullOutcome> {
  if (!isEnabled() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'unavailable'
  if (hasAthleteDeleteTombstone(ownerAccountId, athleteId)) return 'vetoed'

  let query = getSupabase()
    .from('sessions')
    .select('*')
    .gte('date', weekStartDate)
    .lte('date', weekEndDate)
  query = opts.includeLegacy
    ? query.or(`athlete_id.eq.${athleteId},and(user_id.eq.${ownerAccountId},athlete_id.is.null)`)
    : query.eq('athlete_id', athleteId)

  const { data, error } = await withRequestTimeout(query, 'sessions.pull_week_for_athlete')
  if (error) {
    syncLog('pullWeekSessionsForAthlete:error', { error: error.message }, 'warn')
    throw error
  }

  const sessionTombstones = getSessionDeleteTombstones(ownerAccountId)
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const remote = rowToSession(row)
    const wrote = await runAthleteWrite(athleteId, async () => {
      // Resolver dentro del lease evita limpiar un tombstone de sesion si el
      // borrado del atleta veto la hidratacion despues del fetch.
      if (resolveSessionAgainstTombstone(ownerAccountId, remote, sessionTombstones) === 'skip') return
      const local = await db.sessions.get(remote.id)
      if (!local || remoteSessionWins(local, remote)) {
        await db.sessions.put(remote)
      }
    })
    if (!wrote) return 'vetoed'
  }
  return 'completed'
}

async function mergePulledDayLogForScope(
  remote: DayLog,
  scope: { athleteId: string; includeLegacy: boolean },
): Promise<void> {
  await db.transaction('rw', db.dayLogs, async () => {
    const localById = await db.dayLogs.get(remote.id)
    const localByDate = localById ?? await findDayLogConflictByDate(
      remote.date,
      remote.athleteId,
      scope.includeLegacy ? scope.athleteId : null,
    )
    const resolution = resolveDayLogConflict(localByDate, remote)
    if (resolution.loserId) await db.dayLogs.delete(resolution.loserId)
    await db.dayLogs.put(resolution.winner)
  })
}

async function mergePulledWeekSummaryForScope(
  remote: WeekSummary,
  scope: { athleteId: string; includeLegacy: boolean },
): Promise<void> {
  await db.transaction('rw', db.weekSummaries, async () => {
    const localById = await db.weekSummaries.get(remote.id)
    const localByWeek = localById ?? await findWeekSummaryConflictByWeekStart(
      remote.weekStartDate,
      remote.athleteId,
      scope.includeLegacy ? scope.athleteId : null,
    )
    const resolution = resolveWeekSummaryConflict(
      localByWeek,
      remote,
      remote.updatedAt ?? 0,
    )
    if (resolution.loserId) await db.weekSummaries.delete(resolution.loserId)
    await db.weekSummaries.put(resolution.winner)
  })
}

export async function pullWeekDayLogsForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
  weekEndDate: string,
  opts: { includeLegacy: boolean },
): Promise<AthleteWeekPullOutcome> {
  if (!isEnabled() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'unavailable'
  if (hasAthleteDeleteTombstone(ownerAccountId, athleteId)) return 'vetoed'
  let query = getSupabase().from('day_logs').select('*')
    .gte('date', weekStartDate).lte('date', weekEndDate)
  query = opts.includeLegacy
    ? query.or(`athlete_id.eq.${athleteId},and(user_id.eq.${ownerAccountId},athlete_id.is.null)`)
    : query.eq('athlete_id', athleteId)
  const { data, error } = await withRequestTimeout(query, 'day_logs.pull_week_for_athlete')
  if (error) throw error
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const remote = rowToDayLog(row)
    const wrote = await runAthleteWrite(athleteId, () => mergePulledDayLogForScope(remote, {
      athleteId,
      includeLegacy: opts.includeLegacy,
    }))
    if (!wrote) return 'vetoed'
  }
  return 'completed'
}

export async function pullWeekSummaryRowForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
  opts: { includeLegacy: boolean },
): Promise<AthleteWeekPullOutcome> {
  if (!isEnabled() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'unavailable'
  if (hasAthleteDeleteTombstone(ownerAccountId, athleteId)) return 'vetoed'
  let query = getSupabase().from('week_summaries').select('*')
    .eq('week_start_date', weekStartDate)
  query = opts.includeLegacy
    ? query.or(`athlete_id.eq.${athleteId},and(user_id.eq.${ownerAccountId},athlete_id.is.null)`)
    : query.eq('athlete_id', athleteId)
  const { data, error } = await withRequestTimeout(query, 'week_summaries.pull_week_for_athlete')
  if (error) throw error
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const remote = rowToWeekSummary(row)
    const wrote = await runAthleteWrite(athleteId, () => mergePulledWeekSummaryForScope(remote, {
      athleteId,
      includeLegacy: opts.includeLegacy,
    }))
    if (!wrote) return 'vetoed'
  }
  return 'completed'
}

export async function pushDayLog(log: DayLog): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('day_logs', withAthleteId(dayLogToRow(log, userId), log.athleteId))
}

export async function pushWeekSummary(summary: WeekSummary): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('week_summaries', withAthleteId(weekSummaryToRow(summary, userId), summary.athleteId))
}

function weekSummaryQueuePayload(summary: WeekSummary, actorId: string): Record<string, unknown> {
  const row = weekSummaryToRow(summary, actorId)
  delete row.user_id
  return { ...row, athlete_id: summary.athleteId }
}

function enqueueWeekSummaryForAthlete(summary: WeekSummary, userId: string): void {
  if (!summary.athleteId) return
  enqueue({
    userId,
    table: 'week_summaries',
    action: 'upsert',
    payload: weekSummaryQueuePayload(summary, userId),
    enqueuedAt: Date.now(),
    scopeAthleteId: summary.athleteId,
    replayKind: 'weekSummaryForAthlete',
  })
}

async function findLocalWeekSummaryForAthleteWeek(
  athleteId: string,
  weekStartDate: string,
): Promise<WeekSummary | undefined> {
  return db.weekSummaries
    .where('[athleteId+weekStartDate]')
    .equals([athleteId, weekStartDate])
    .first()
}

type WeekSummaryExecutionOutcome =
  | { status: 'done' }
  | { status: 'retry'; summary: WeekSummary }

async function reconcileWeekSummaryNaturalKeyAttempt(
  summary: WeekSummary,
  athleteId: string,
  userId: string,
): Promise<WeekSummaryExecutionOutcome> {
  const { data, error } = await withRequestTimeout(
    getSupabase().from('week_summaries').select('*')
      .eq('athlete_id', athleteId)
      .eq('week_start_date', summary.weekStartDate)
      .limit(1),
    'week_summaries.reconcile_select',
  )
  if (error) throw error
  const remoteRow = (data as Record<string, unknown>[] | null)?.[0]
  if (!remoteRow) return { status: 'retry', summary }
  const remoteUpdatedAt = Number(remoteRow.updated_at ?? 0)
  const localUpdatedAt = summary.updatedAt ?? 0

  if (remoteUpdatedAt >= localUpdatedAt) {
    const winner = rowToWeekSummary(remoteRow)
    let retryCandidate: WeekSummary | undefined
    const wrote = await runAthleteWrite(athleteId, async () => {
      await db.transaction('rw', db.weekSummaries, async () => {
        const current = await findLocalWeekSummaryForAthleteWeek(athleteId, summary.weekStartDate)
        if ((current?.updatedAt ?? 0) > remoteUpdatedAt) {
          retryCandidate = current
          return
        }
        if (winner.id !== summary.id) await db.weekSummaries.delete(summary.id)
        if (current && current.id !== winner.id) await db.weekSummaries.delete(current.id)
        await db.weekSummaries.put(winner)
      })
    })
    if (!wrote) return { status: 'done' }
    return retryCandidate ? { status: 'retry', summary: retryCandidate } : { status: 'done' }
  }

  const row = weekSummaryQueuePayload({ ...summary, id: remoteRow.id as string }, userId)
  const updated = await supabaseMutationCount(
    getSupabase().from('week_summaries').update(row as never)
      .eq('id', remoteRow.id as string)
      .eq('athlete_id', athleteId)
      .eq('week_start_date', summary.weekStartDate)
      .lt('updated_at', localUpdatedAt)
      .select('id'),
    'week_summaries.reconcile_update',
  )
  if (updated === 0) return { status: 'retry', summary }

  if ((remoteRow.id as string) !== summary.id) {
    let retryCandidate: WeekSummary | undefined
    const wrote = await runAthleteWrite(athleteId, async () => {
      await db.transaction('rw', db.weekSummaries, async () => {
        const current = await findLocalWeekSummaryForAthleteWeek(athleteId, summary.weekStartDate)
        if ((current?.updatedAt ?? 0) > localUpdatedAt) {
          retryCandidate = current
          return
        }
        if (current && current.id !== remoteRow.id) await db.weekSummaries.delete(current.id)
        await db.weekSummaries.put({ ...summary, id: remoteRow.id as string })
      })
    })
    if (!wrote) return { status: 'done' }
    if (retryCandidate) return { status: 'retry', summary: retryCandidate }
  }
  return { status: 'done' }
}

async function reconcileWeekSummaryNaturalKey(
  summary: WeekSummary,
  athleteId: string,
  userId: string,
): Promise<WeekSummaryExecutionOutcome> {
  let candidate = summary
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = await reconcileWeekSummaryNaturalKeyAttempt(candidate, athleteId, userId)
    if (outcome.status === 'done') return outcome
    candidate = outcome.summary
  }
  return { status: 'retry', summary: candidate }
}

async function executeWeekSummaryForAthleteRow(
  summary: WeekSummary,
  athleteId: string,
  userId: string,
): Promise<WeekSummaryExecutionOutcome> {
  const row = weekSummaryQueuePayload({ ...summary, athleteId }, userId)
  const updated = await supabaseMutationCount(
    getSupabase().from('week_summaries').update(row as never)
      .eq('id', summary.id).eq('athlete_id', athleteId).select('id'),
    'week_summaries.update_for_athlete',
  )
  if (updated > 0) return { status: 'done' }

  await ensureRemoteAthlete(userId, athleteId)
  const { error } = await withRequestTimeout(
    getSupabase().from('week_summaries').insert({
      ...row,
      user_id: userId,
      athlete_id: athleteId,
    } as never),
    'week_summaries.insert_for_athlete',
  )
  if (!error) return { status: 'done' }
  if ((error as { code?: string }).code !== '23505') throw error
  return reconcileWeekSummaryNaturalKey({ ...summary, athleteId }, athleteId, userId)
}

export async function pushWeekSummaryForAthlete(summary: WeekSummary): Promise<void> {
  const userId = getUserId()
  if (!userId || !isEnabled()) return
  if (!summary.athleteId) {
    syncLog('pushWeekSummaryForAthlete:unscoped_fallback', { id: summary.id }, 'warn')
    await pushWeekSummary(summary)
    return
  }
  const athleteId = summary.athleteId
  if (hasAthleteDeleteTombstoneForAthlete(athleteId)) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueWeekSummaryForAthlete(summary, userId)
    scheduleRetry(15000)
    return
  }
  const requestedAt = Date.now()
  const identity = { id: summary.id }
  await trackInFlightAthleteOp(athleteId, withSerializedEntityMutation(
    userId,
    'week_summaries',
    identity,
    async () => {
      try {
        const outcome = await executeWeekSummaryForAthleteRow(summary, athleteId, userId)
        if (outcome.status === 'retry') {
          enqueueWeekSummaryForAthlete(outcome.summary, userId)
          scheduleRetry(15000)
          return
        }
        clearQueuedOpsForEntityOlderThan(userId, 'week_summaries', identity, requestedAt)
      } catch (error) {
        const info = classifySyncError(error, 'week_summaries')
        if (info.retriable || info.autoRepairable) {
          const latest = await findLocalWeekSummaryForAthleteWeek(athleteId, summary.weekStartDate)
          enqueueWeekSummaryForAthlete(latest ?? summary, userId)
          applySyncFailure(error, info.userMessage, 'week_summaries')
          return
        }
        applySyncFailure(error, info.userMessage, 'week_summaries')
      }
    },
  ))
}

export async function deleteWeekSummaries(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await Promise.all(ids.map((id) => deleteRow('week_summaries', id)))
}

export async function pushChatMessage(msg: ChatMessage): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('chat_messages', withAthleteId(chatMessageToRow(msg, userId), msg.athleteId))
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
  await upsertRow('coach_proposals', withAthleteId(coachProposalToRow(proposal, userId), proposal.athleteId))
}

export async function pushAthleteProfile(
  profile: AthleteProfile,
  options?: { source?: AthleteProfileWriteSource },
): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  const source = options?.source ?? 'automatic'
  await upsertRow('athlete_profiles', withAthleteProfileWriteSource(withAthleteId(athleteProfileToRow(profile, userId), profile.athleteId), source), {
    athleteProfileWriteSource: source,
  })
}

export async function pushTrainingPlan(plan: TrainingPlan): Promise<SyncPushOutcome> {
  const userId = getUserId()
  if (!userId) return isEnabled() ? 'failed' : 'no_remote'
  if (!isSyncablePlanStatus(plan.status)) return 'no_remote'
  return upsertRow(
    'training_plans',
    withAthleteId(trainingPlanToRow(plan, userId) as unknown as Record<string, unknown>, plan.athleteId),
  )
}

export async function pushTrainingPlanWeeks(plan: TrainingPlan, weeks: TrainingPlanWeek[]): Promise<void> {
  const userId = getUserId()
  if (!userId || !isSyncablePlanStatus(plan.status)) return
  // Weeks derive their athlete scope from the parent plan (not user_id).
  await Promise.all(weeks.map((week) =>
    upsertRow('training_plan_weeks', withAthleteId(trainingPlanWeekToRow(week, userId), week.athleteId ?? plan.athleteId)),
  ))
}

export async function archiveTrainingPlan(plan: TrainingPlan, weeks: TrainingPlanWeek[]): Promise<void> {
  const archivedPlan: TrainingPlan = {
    ...plan,
    status: 'archived',
    // `closePlanCycle` already computes a timestamp newer than every candidate.
    // Never replace that logical clock with a smaller wall-clock value.
    updatedAt: Math.max(Date.now(), plan.updatedAt),
  }
  await pushTrainingPlan(archivedPlan)
  await pushTrainingPlanWeeks(archivedPlan, weeks)
}

function resolveRemotePlanAthleteId(plan: TrainingPlan, userId: string): string {
  if (isScopedAthleteId(plan.athleteId)) return plan.athleteId
  // Legacy/unscoped plan rows belong exclusively to the self athlete. Prefer
  // the hydrated id, with the deterministic owner id as a startup-safe fallback.
  return getSelfAthleteId() ?? athleteIdForOwner(userId)
}

function nextPlanDeleteTimestamp(plan: TrainingPlan, weeks: TrainingPlanWeek[]): number {
  return [plan, ...weeks].reduce((timestamp, row) => {
    if (!Number.isFinite(row.updatedAt)) return timestamp
    return Math.max(timestamp, row.updatedAt + 1)
  }, Date.now())
}

/**
 * The parent tombstone is the authoritative commit for deleting a cycle.
 * It is written first and sequentially: if it did not reach the remote (or its
 * durable queue), no child tombstone is attempted. Once the parent is pushed,
 * child tombstones are only remote cleanup and cannot downgrade the committed
 * result; mergeTrainingPlans suppresses/removes all local children by parent.
 */
export async function softDeleteTrainingPlan(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
): Promise<SyncPushOutcome> {
  const userId = getUserId()
  if (!userId) return isEnabled() ? 'failed' : 'no_remote'

  const deletedAt = nextPlanDeleteTimestamp(plan, weeks)
  const athleteId = resolveRemotePlanAthleteId(plan, userId)
  const scopedPlan = { ...plan, athleteId, updatedAt: deletedAt }
  const parentOutcome = await upsertRow(
    'training_plans',
    trainingPlanToRow(scopedPlan, userId, deletedAt),
  )

  if (parentOutcome !== 'pushed') return parentOutcome

  // Cleanup starts only after the parent commit. Every child inherits the
  // exact same remote athlete id, including legacy local rows.
  await Promise.all(weeks.map((week) =>
    upsertRow(
      'training_plan_weeks',
      trainingPlanWeekToRow({ ...week, athleteId, updatedAt: deletedAt }, userId, deletedAt),
    ).catch(() => 'failed' as const),
  ))

  return 'pushed'
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
  if (table === 'athlete_coach_notes') {
    const { data: memberships, error: membershipError } = await getSupabase()
      .from('athlete_memberships')
      .select('athlete_id')
      .eq('account_id', userId)
    if (membershipError) throw membershipError
    const athleteIds = (memberships ?? [])
      .map((row) => (row as { athlete_id?: unknown }).athlete_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (athleteIds.length === 0) return
    const { error } = await getSupabase()
      .from('athlete_coach_notes')
      .delete()
      .in('athlete_id', athleteIds)
    if (error) throw error
    return
  }
  if (table === 'athletes') {
    // Athlete rows are access keystones. Deleting one can cascade a claimed
    // self membership, so account reset never treats athlete deletion as wipe.
    return
  }
  if (table === 'readiness_daily' && options?.fullReset) {
    await deleteRemoteWhoopData(userId)
    return
  }

  const { error } = await getSupabase().from(table).delete().eq('user_id', userId)
  if (error) throw error
}

async function deleteRemoteWhoopData(userId: string): Promise<void> {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw Object.assign(new Error('No active Supabase session for WHOOP data deletion'), { status: 401 })
  }

  const response = await fetch(resolveApiUrl('/.netlify/functions/whoop-sync'), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status === 404) return
  if (!response.ok) {
    throw Object.assign(new Error(`WHOOP data deletion failed for ${userId}: ${response.status}`), {
      status: response.status,
    })
  }
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

/**
 * Pull the owner's athlete rows FIRST (Tier-A intent) and re-hydrate the active
 * athlete, so any athlete-scoped read/write later in the sync uses a resolved id.
 * Scoped by account_id. A failed read returns false so runFullSync can preserve
 * queued child writes until identity state has been confirmed remotely.
 */
export async function pullMemberships(userId: string): Promise<boolean> {
  if (!isEnabled()) return true
  try {
    const { data, error } = await withRequestTimeout(
      getSupabase().from('athlete_memberships').select('*').eq('account_id', userId),
      'athlete_memberships.select',
    )
    if (error) throw error
    const memberships = (data ?? []).map((row) => membershipFromRemoteRow(row as Record<string, unknown>))
    const tombstones = getAthleteDeleteTombstoneSnapshot()
    const alive = memberships.filter((membership) => !tombstones.hasAthlete(membership.athleteId))
    const athleteIds = [...new Set(alive.map((membership) => membership.athleteId))]
    await runAthleteWrites(athleteIds, async () => {
      await replaceMembershipCache(userId, alive)
    })
    return true
  } catch (error) {
    syncLog('memberships:pull_failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'warn')
    return false
  }
}

async function pullAthletes(userId: string): Promise<boolean> {
  try {
    await ensureRemoteAthlete(userId)
    const memberIds = await getMembershipAthleteIds(userId)
    const base = getSupabase().from('athletes').select('*')
    const { data, error } = await (memberIds.length > 0
      ? base.or(`id.in.(${memberIds.join(',')}),owner_account_id.eq.${userId}`)
      : base.eq('owner_account_id', userId))
    if (error) {
      syncLog('pullAthletes:error', { error: error.message }, 'warn')
      return false
    }
    const remoteRows = (data ?? []) as AthleteRow[]
    const remoteIds = new Set(remoteRows.map((row) => row.id))
    const acknowledged = loadAcknowledgedRemoteAthleteIds(userId)
    const selfAthleteId = groupingSelfAthleteId(userId)
    const localOwnedAthletes = (await db.athletes.toArray()).filter((athlete) => (
      athlete.ownerAccountId === userId && athlete.id !== selfAthleteId
    ))

    for (const local of localOwnedAthletes) {
      if (remoteIds.has(local.id) || !acknowledged.has(local.id)) continue

      // The device observed this exact identity remotely before, so its later
      // absence from a complete owner-scoped pull is the durable signal of a
      // hard delete (whose FK cascade also removed athlete_profiles).
      try {
        rememberAthleteDeleteTombstone(userId, local.id)
      } catch (error) {
        syncLog('pullAthletes:delete_tombstone_failed', {
          athleteId: local.id,
          error: error instanceof Error ? error.message : String(error),
        }, 'warn')
        // Fail closed: without the durable write barrier, neither the queue
        // nor Dexie nor the acknowledgement may change.
        return false
      }
      clearQueuedOpsForAthlete(userId, local.id)
      await waitForInFlightAthleteOps(local.id)
      await db.transaction('rw', getAllAthleteScopedTables(), async () => {
        await purgeAthleteScopedRows(local.id)
      })
      clearStoredChatSessionIdForAthlete(local.id)
      forgetRemoteAthleteAcknowledgement(userId, local.id)
      syncLog('pullAthletes:remote_delete_applied', { athleteId: local.id })
    }

    for (const row of remoteRows) {
      if (hasAthleteDeleteTombstone(userId, row.id)) continue
      await runAthleteWrite(row.id, () => db.athletes.put(rowToAthlete(row)))
    }
    rememberRemoteAthleteAcknowledgements(userId, remoteRows.map((row) => row.id))
    await hydrateActiveAthlete(userId)
    return true
  } catch (error) {
    syncLog('pullAthletes:exception', {
      error: error instanceof Error ? error.message : String(error),
    }, 'warn')
    return false
  }
}

async function pullRemoteAndMerge(userId: string): Promise<void> {
  return pullRemoteDedup.run(userId, async () => {
    if (!isEnabled()) return

    const queueDrained = await drainQueue()
    const { syncDetails } = useAuthStore.getState()
    const pendingRemoteWipeTables = getPendingRemoteWipeTables(userId)
    const readScope = resolveReadScope()
    // Legacy rows always belong to the SELF athlete (F2-lite legacy policy):
    // the merge fallback must never stamp/group them under a managed athlete.
    const activeAthleteId = getSelfAthleteId()
      ?? (readScope.mode === 'athlete' ? readScope.athleteId : getActiveAthleteId())
    const mergeContext: MergeContext = {
      allowDeletes: queueDrained,
      deleteBeforeTs: queueDrained ? (syncDetails.lastSuccessfulSyncAt ?? null) : null,
      readScope,
      activeAthleteId,
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
      mergeCoachNotes(userId, mergeContext),
      mergeSessionTemplates(userId, mergeContext),
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
  })
}

export async function runFullSync(userId: string): Promise<void> {
  if (!userId || !isEnabled()) return
  return fullSyncDedup.run(userId, async () => {
    startSyncAttempt()
    const failureCountAtStart = syncStoreState().syncDetails.consecutiveFailures ?? 0
    const fullSyncStartedAt = Date.now()
    trackSyncEvent({ kind: 'pull', status: 'ok', userId, detail: 'runFullSync:start' })

    try {
      await applyRemoteFullResetIfNeeded(userId)
      await repairLocalNaturalKeyConflicts()
      pruneExpiredTombstones(userId)
      pruneExpiredCoachProposalTombstones(userId)
      pruneStaleQueue(userId)
      await processPendingRemoteWipes(userId)
      await applyRemoteFullResetIfNeeded(userId)
      // Resolve durable athlete identities before replaying child writes. If
      // another device hard-deleted a previously acknowledged managed athlete,
      // its remote absence must tombstone/clear stale queued profile writes
      // before `ensureRemoteAthlete` can recreate the parent row.
      if (!await pullMemberships(userId)) {
        throw new Error('No se pudo confirmar el estado remoto de las membresías antes de drenar la cola.')
      }
      if (!await pullAthletes(userId)) {
        throw new Error('No se pudo confirmar el estado remoto de los atletas antes de drenar la cola.')
      }
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
  })
}

async function mergeSessions(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('sessions')) return
  const remoteRows = await fetchAll<Record<string, unknown>>('sessions', userId, context.readScope)
  const remoteIds = new Set<string>()
  const sessionTombstones = getSessionDeleteTombstones(userId)
  for (const row of remoteRows) {
    const remote = rowToSession(row)
    remoteIds.add(remote.id)

    if (resolveSessionAgainstTombstone(userId, remote, sessionTombstones) === 'skip') {
      context.pendingWrites.push(() => deleteRow('sessions', remote.id))
      continue
    }

    const local = await db.sessions.get(remote.id)
    if (!local || remoteSessionWins(local, remote)) {
      await runAthleteWrite(remote.athleteId, () => db.sessions.put(remote))
    } else {
      context.pendingWrites.push(() => pushSession(local))
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.sessions,
      remoteIds,
      (session: Session) => session.updatedAt,
      context.deleteBeforeTs,
      deleteAthleteScope(context),
    )
  }

  pruneSessionDeleteTombstones(userId, remoteIds, { pullWasComplete: true })
}

async function mergeDayLogs(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('day_logs')) return
  const activeAthleteId = context.activeAthleteId
  const remoteRows = await fetchAll<Record<string, unknown>>('day_logs', userId, context.readScope)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remoteAthleteId = getRemoteRowAthleteId(row)
    const remote = rowToDayLog(row)
    const localById = await db.dayLogs.get(remote.id)
    const localByDate = localById ?? await findDayLogConflictByDate(remote.date, remoteAthleteId, activeAthleteId)
    const resolution = resolveDayLogConflict(localByDate, remote)
    const stamped = stampAthleteIdIfLegacy(resolution.winner, activeAthleteId)
    const winner = stamped.row

    remoteIds.add(remote.id)
    remoteIds.add(winner.id)

    if (!localByDate) {
      await runAthleteWrite(winner.athleteId, () => db.dayLogs.put(winner))
      if (stamped.changed) {
        context.pendingWrites.push(() => pushDayLog(winner))
      }
      continue
    }

    if (winner.id !== localByDate.id) {
      await db.dayLogs.delete(localByDate.id)
      await runAthleteWrite(winner.athleteId, () => db.dayLogs.put(winner))
      if (remote.id !== localByDate.id) {
        context.pendingWrites.push(() => deleteRow('day_logs', localByDate.id))
      }
      if (winner.id !== remote.id) {
        context.pendingWrites.push(() => deleteRow('day_logs', remote.id))
      }
      context.pendingWrites.push(() => pushDayLog(winner))
      continue
    }

    if (resolution.winner === remote) {
      await runAthleteWrite(winner.athleteId, () => db.dayLogs.put(winner))
      if (stamped.changed) {
        context.pendingWrites.push(() => pushDayLog(winner))
      }
    } else {
      if (stamped.changed) {
        await runAthleteWrite(winner.athleteId, () => db.dayLogs.put(winner))
      }
      if (stamped.changed || winner.updatedAt > remote.updatedAt) {
        context.pendingWrites.push(() => pushDayLog(winner))
      }
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.dayLogs,
      remoteIds,
      (dayLog: DayLog) => dayLog.updatedAt,
      context.deleteBeforeTs,
      deleteAthleteScope(context),
    )
  }
}

async function mergeWeekSummaries(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('week_summaries')) return
  const activeAthleteId = context.activeAthleteId
  const remoteRows = await fetchAll<Record<string, unknown>>('week_summaries', userId, context.readScope)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remoteAthleteId = getRemoteRowAthleteId(row)
    const remote = rowToWeekSummary(row)
    const remoteUpdatedAt = (row.updated_at as number) ?? 0
    const localById = await db.weekSummaries.get(remote.id)
    const localByWeek = localById ?? await findWeekSummaryConflictByWeekStart(remote.weekStartDate, remoteAthleteId, activeAthleteId)
    const resolution = resolveWeekSummaryConflict(localByWeek, remote, remoteUpdatedAt)
    const stamped = stampAthleteIdIfLegacy(resolution.winner, activeAthleteId)
    const winner = stamped.row

    remoteIds.add(remote.id)
    remoteIds.add(winner.id)

    if (!localByWeek) {
      await runAthleteWrite(winner.athleteId, () => db.weekSummaries.put(winner))
      if (stamped.changed) {
        context.pendingWrites.push(() => pushWeekSummary(winner))
      }
      continue
    }

    if (winner.id !== localByWeek.id) {
      await db.weekSummaries.delete(localByWeek.id)
      await runAthleteWrite(winner.athleteId, () => db.weekSummaries.put(winner))
      if (remote.id !== localByWeek.id) {
        context.pendingWrites.push(() => deleteRow('week_summaries', localByWeek.id))
      }
      if (winner.id !== remote.id) {
        context.pendingWrites.push(() => deleteRow('week_summaries', remote.id))
      }
      context.pendingWrites.push(() => pushWeekSummary(winner))
      continue
    }

    const winnerUpdatedAt = getWeekSummaryUpdatedAt(winner)

    if (resolution.winner === remote) {
      await runAthleteWrite(winner.athleteId, () => db.weekSummaries.put(winner))
      if (stamped.changed) {
        context.pendingWrites.push(() => pushWeekSummary(winner))
      }
    } else {
      if (stamped.changed) {
        await runAthleteWrite(winner.athleteId, () => db.weekSummaries.put(winner))
      }
      if (stamped.changed || winnerUpdatedAt > remoteUpdatedAt) {
        context.pendingWrites.push(() => pushWeekSummary(winner))
      }
    }
  }

  if (context.allowDeletes) {
    await deleteMissingLocalRows(
      db.weekSummaries,
      remoteIds,
      (summary: WeekSummary) => ((summary as unknown as { updatedAt?: number }).updatedAt) ?? null,
      context.deleteBeforeTs,
      deleteAthleteScope(context),
    )
  }
}

async function mergeChatMessages(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('chat_messages')) return
  const remoteRows = await fetchAll<Record<string, unknown>>('chat_messages', userId, context.readScope)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToChatMessage(row)
    remoteIds.add(remote.id)

    const local = await db.chatMessages.get(remote.id)
    if (!local) {
      await runAthleteWrite(remote.athleteId, () => db.chatMessages.put(remote))
    } else if (remote.timestamp >= local.timestamp && JSON.stringify(remote) !== JSON.stringify(local)) {
      await runAthleteWrite(remote.athleteId, () => db.chatMessages.put(remote))
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
      deleteAthleteScope(context),
    )
  }
}

async function mergeCoachProposals(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('coach_proposals')) return
  const remoteRows = await fetchAll<Record<string, unknown>>('coach_proposals', userId, context.readScope)
  const remoteIds = new Set<string>()
  const tombstones = getCoachProposalDeleteTombstones(userId)

  for (const row of remoteRows) {
    const remote = rowToCoachProposal(row)
    remoteIds.add(remote.id)

    const remoteUpdatedAt = (row.updated_at as number) ?? 0
    const deletedAt = tombstones[remote.id]
    if (typeof deletedAt === 'number') {
      if (deletedAt >= remoteUpdatedAt) {
        context.pendingWrites.push(() => deleteRow('coach_proposals', remote.id))
        continue
      }
      clearCoachProposalDeleteTombstone(userId, remote.id)
    }

    const local = await db.coachProposals.get(remote.id)
    const localUpdatedAt = local?.resolvedAt ?? local?.createdAt ?? 0

    if (!local || remoteUpdatedAt > localUpdatedAt) {
      await runAthleteWrite(remote.athleteId, () => db.coachProposals.put(remote))
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
      deleteAthleteScope(context),
    )
  }

  pruneCoachProposalDeleteTombstones(userId, remoteIds, { pullWasComplete: true })
}

async function mergeAthleteProfile(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('athlete_profiles')) return
  let remoteRows: AthleteProfileSyncRow[]
  try {
    remoteRows = await fetchAthleteProfileRows(userId)
  } catch (error) {
    throw new Error(classifyAthleteProfileSyncError(error))
  }

  const selfAthleteId = groupingSelfAthleteId(userId)
  const groups = groupAthleteProfileRows(remoteRows, selfAthleteId)
  const selfRows = groups.get(ATHLETE_PROFILE_SELF_GROUP) ?? []

  const profileResetLock = getProfileResetLock(userId)
  if (isProfileResetLockActive(profileResetLock)) {
    if (selfRows.length > 0) {
      const canonicalLockedRow = coalesceAthleteProfileRows(selfRows)
      const resetAt = getAthleteProfileFullResetAt(canonicalLockedRow.data)
      if (resetAt != null) {
        markProfileResetLockStatus(userId, 'awaiting_onboarding_recreation', resetAt)
      }
    }
    await db.athleteProfiles.clear()
    return
  }

  await mergeSelfProfileGroup(userId, selfRows, context)

  for (const [groupKey, rows] of groups) {
    if (groupKey === ATHLETE_PROFILE_SELF_GROUP) continue
    await mergeManagedProfileGroup(userId, groupKey, rows, context, selfAthleteId)
  }

  const localProfiles = await db.athleteProfiles.toArray()
  for (const local of localProfiles) {
    if (local.id === ATHLETE_PROFILE_LOCAL_ID) continue
    if (groups.has(local.id)) continue
    // Remote absence is not a deletion signal for managed profiles. A local
    // save whose queued push expired is indistinguishable from a remote delete
    // here, and profile deletion has no durable tombstone to disambiguate it.
    // Explicit athlete deletion/reset removes the local row through its own
    // flow; otherwise preserve Dexie as the recoverable source and repair the
    // missing remote row.
    const localAthlete = await db.athletes.get(local.athleteId ?? local.id)
    if (!localAthlete || hasAthleteDeleteTombstone(userId, local.athleteId ?? local.id)) {
      await db.athleteProfiles.delete(local.id)
      continue
    }
    context.pendingWrites.push(() => pushAthleteProfile(local))
  }
}

async function mergeCoachNotes(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('athlete_coach_notes')) return
  let remoteRows: Record<string, unknown>[]
  try {
    remoteRows = await fetchAll<Record<string, unknown>>('athlete_coach_notes', userId, context.readScope)
  } catch (error) {
    syncLog('coach_notes:pull_failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'warn')
    return
  }

  const remoteAthleteIds: string[] = []
  for (const row of remoteRows) {
    const remote: AthleteCoachNote = {
      athleteId: row.athlete_id as string,
      coachMemory: (row.coach_memory as string | null) ?? undefined,
      updatedByAccountId: (row.updated_by_account_id as string | null) ?? undefined,
      updatedAt: (row.updated_at as number) ?? 0,
    }
    remoteAthleteIds.push(remote.athleteId)
    const local = await db.athleteCoachNotes.get(remote.athleteId)
    if (!local || remote.updatedAt > local.updatedAt) {
      await runAthleteWrite(remote.athleteId, () => db.athleteCoachNotes.put(remote))
    } else if (local.updatedAt > remote.updatedAt) {
      context.pendingWrites.push(() => pushCoachNote(local))
    }
  }

  if (context.allowDeletes && context.deleteBeforeTs != null) {
    await pruneCoachNotesMissingFromRemote(
      await getMembershipAthleteIds(userId),
      remoteAthleteIds,
      context.deleteBeforeTs,
    )
  }
}

export async function mergeSessionTemplates(userId: string, context: MergeContext): Promise<void> {
  // A reset whose remote wipe has not completed must not rehydrate local rows
  // from the data it is still trying to remove.
  if (context.pendingRemoteWipeTables.has('session_templates')) return

  let remoteRows: Record<string, unknown>[]
  try {
    remoteRows = await fetchAll<Record<string, unknown>>(
      'session_templates',
      userId,
      context.readScope,
    )
  } catch (error) {
    const info = classifySyncError(error, 'session_templates')
    if (info.category === 'schema_mismatch') {
      // Migration 015 may be deployed after this client. Templates are an
      // optional sync surface and must not block the remaining pull.
      syncLog('session_templates:pull_skipped_schema', {}, 'warn')
      return
    }
    throw error
  }

  const remoteById = new Map<string, StoredSessionTemplate>()
  for (const row of remoteRows) {
    const remote = rowToStoredSessionTemplate(row)
    remoteById.set(remote.id, remote)
  }

  const locals = await db.sessionTemplates.toArray()
  const localById = new Map(locals.map((local) => [local.id, local]))

  // Template deletes are durable rows rather than localStorage tombstones, so
  // they need the same retention bound as every other delete marker. Expiry is
  // only ever applied to rows both sides already agree are deleted; a live row
  // never takes this path, so convergence semantics are unchanged.
  const tombstoneCutoff = Date.now() - TOMBSTONE_TTL_MS
  const isExpiredTombstone = (row: StoredSessionTemplate): boolean => (
    row.deletedAt != null && row.deletedAt < tombstoneCutoff
  )
  const expiredLocalIds: string[] = []

  for (const [id, remote] of remoteById) {
    const local = localById.get(id)

    if (isExpiredTombstone(remote) && (!local || isExpiredTombstone(local))) {
      if (local) expiredLocalIds.push(id)
      continue
    }

    if (!local || remote.updatedAt > local.updatedAt) {
      await db.sessionTemplates.put(remote)
      continue
    }

    if (remote.updatedAt < local.updatedAt) {
      // Every local winner repairs the server, including live-over-tombstone.
      // The SQL guard turns that latter case into a versioned tombstone.
      context.pendingWrites.push(() => pushSessionTemplate(local))
      continue
    }

    const remoteDeleted = remote.deletedAt != null
    const localDeleted = local.deletedAt != null
    if (remoteDeleted !== localDeleted) {
      if (remoteDeleted) {
        // Equal versions with different states converge on deletion.
        await db.sessionTemplates.put(remote)
      } else {
        // Symmetric delete-wins: the local tombstone must repair remote live.
        context.pendingWrites.push(() => pushSessionTemplate(local))
      }
      continue
    }

    // Same timestamp and state: the server row (OLD in the SQL trigger) is the
    // canonical tiebreaker, but an already converged row needs no IndexedDB write.
    if (!jsonStructurallyEqual(local, remote)) {
      await db.sessionTemplates.put(remote)
    }
  }

  // Remote absence is never interpreted as deletion. Once the queue is known
  // to be drained, re-push every absent local row (live or tombstone).
  if (context.allowDeletes && !context.pendingRemoteWipeTables.has('session_templates')) {
    for (const local of locals) {
      if (remoteById.has(local.id)) continue
      if (isExpiredTombstone(local)) {
        // Expired and already absent upstream: there is nothing left to converge.
        expiredLocalIds.push(local.id)
        continue
      }
      context.pendingWrites.push(() => pushSessionTemplate(local))
    }
  }

  if (expiredLocalIds.length > 0) {
    await db.sessionTemplates.bulkDelete(expiredLocalIds)
    syncLog('session_templates:tombstones_pruned', { count: expiredLocalIds.length }, 'info')
  }
}

async function mergeSelfProfileGroup(
  userId: string,
  selfRows: AthleteProfileSyncRow[],
  context: MergeContext,
): Promise<void> {
  let groupRows = selfRows
  if (groupRows.length > 1) {
    const localPreferred = await db.athleteProfiles.get(ATHLETE_PROFILE_LOCAL_ID)
    const preferredRow = localPreferred
      ? toAthleteProfileSyncRow(athleteProfileToRow(localPreferred, userId))
      : undefined

    await repairRemoteAthleteProfileRows(userId, groupRows, preferredRow)
    groupRows = await fetchAthleteProfileRowsForGroup(userId, ATHLETE_PROFILE_SELF_GROUP)
  }

  if (groupRows.length === 0) {
    if (context.allowDeletes && context.deleteBeforeTs != null) {
      const local = await db.athleteProfiles.get(ATHLETE_PROFILE_LOCAL_ID)
      if (local && local.updatedAt <= context.deleteBeforeTs) {
        await db.athleteProfiles.delete(ATHLETE_PROFILE_LOCAL_ID)
      }
    }
    return
  }

  const canonicalRow = coalesceAthleteProfileRows(groupRows)
  if (isAthleteProfileFullResetRow(canonicalRow)) {
    markProfileResetLockStatus(
      userId,
      'awaiting_onboarding_recreation',
      getAthleteProfileFullResetAt(canonicalRow.data) ?? Date.now(),
    )
    await db.athleteProfiles.clear()
    return
  }

  const local = await db.athleteProfiles.get(ATHLETE_PROFILE_LOCAL_ID)
  const localRow = local ? toAthleteProfileSyncRow(athleteProfileToRow(local, userId)) : null
  const mergedRow = localRow ? coalesceAthleteProfileRows([localRow, canonicalRow]) : canonicalRow
  const mergedProfile = rowToAthleteProfile(mergedRow, groupingSelfAthleteId(userId))

  if (!localRow || !athleteProfileRowsEqual(localRow, mergedRow)) {
    await runAthleteWrite(mergedProfile.athleteId, () =>
      db.athleteProfiles.put({ ...mergedProfile, id: ATHLETE_PROFILE_LOCAL_ID }))
  }

  if (!athleteProfileRowsEqual(canonicalRow, mergedRow)) {
    context.pendingWrites.push(() => pushAthleteProfile(mergedProfile))
  }
}

async function mergeManagedProfileGroup(
  userId: string,
  groupKey: string,
  rows: AthleteProfileSyncRow[],
  context: MergeContext,
  selfAthleteId: string | null,
): Promise<void> {
  let groupRows = rows
  if (groupRows.length > 1) {
    const localPreferred = await db.athleteProfiles.get(groupKey)
    const preferredRow = localPreferred
      ? toAthleteProfileSyncRow(athleteProfileToRow(localPreferred, userId))
      : undefined
    await repairRemoteAthleteProfileRows(userId, groupRows, preferredRow)
    groupRows = await fetchAthleteProfileRowsForGroup(userId, groupKey)
    if (groupRows.length === 0) return
  }

  const canonicalRow = coalesceAthleteProfileRows(groupRows)
  const local = await db.athleteProfiles.get(groupKey)
  const localRow = local ? toAthleteProfileSyncRow(athleteProfileToRow(local, userId)) : null
  const mergedRow = localRow ? coalesceAthleteProfileRows([localRow, canonicalRow]) : canonicalRow
  const mergedProfile = rowToAthleteProfile(mergedRow, selfAthleteId)

  if (!localRow || !athleteProfileRowsEqual(localRow, mergedRow)) {
    await runAthleteWrite(mergedProfile.athleteId ?? groupKey, () =>
      db.athleteProfiles.put({ ...mergedProfile, id: groupKey }))
  }
  if (!athleteProfileRowsEqual(canonicalRow, mergedRow)) {
    context.pendingWrites.push(() => pushAthleteProfile({ ...mergedProfile, id: groupKey }))
  }
}

async function deleteLocalTrainingPlan(planId: string): Promise<void> {
  await db.transaction(
    'rw',
    db.trainingPlans,
    db.trainingPlanWeeks,
    db.planGenerationJobs,
    async () => {
      await db.trainingPlanWeeks.where('planId').equals(planId).delete()
      await db.planGenerationJobs.where('planId').equals(planId).delete()
      await db.trainingPlans.delete(planId)
    },
  )
}

/**
 * Campos de `TrainingPlan` que sólo existen en el cliente y nunca viajan a
 * Supabase — `planRows.ts` (`trainingPlanToRow`/`rowToTrainingPlan`) no los
 * mapea a ninguna columna a propósito, así que `remotePlan` (siempre
 * `rowToTrainingPlan(row)`) jamás los trae. Hoy sólo `pendingRecalibration`
 * (marcador de recuperación de una recalibración cuya pestaña se cerró antes
 * de reconciliar el calendario — ver `usePlanBuilderStore.ts`).
 *
 * Sin esto, un LWW remoto-gana pisaba el plan local COMPLETO con
 * `remotePlan` y borraba el marcador en silencio — justo en el escenario en
 * que existe para ayudar: el job termina en el servidor (que actualiza
 * `updated_at`), el usuario reabre la app, `runFullSync` corre antes de que
 * el usuario llegue a Plan Builder, y el merge normal ya había destruido la
 * única pista de que había una reconciliación pendiente.
 *
 * Al agregar el próximo campo local-only del plan, sumarlo aquí — no hace
 * falta volver a razonar este bug.
 */
function preserveLocalOnlyTrainingPlanFields(remotePlan: TrainingPlan, localPlan: TrainingPlan): TrainingPlan {
  if (localPlan.pendingRecalibration === undefined) return remotePlan
  return { ...remotePlan, pendingRecalibration: localPlan.pendingRecalibration }
}

async function mergeTrainingPlans(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('training_plans')) return
  if (isSchemaMismatchBlocked('training_plans')) return
  let remoteRows: Record<string, unknown>[]
  try {
    remoteRows = await fetchAll<Record<string, unknown>>('training_plans', userId, context.readScope)
  } catch (error) {
    const errorInfo = classifySyncError(error, 'training_plans')
    if (isOptionalPlanSchemaMismatch(errorInfo, 'training_plans')) {
      trackOptionalPlanSyncSkip('training_plans', errorInfo, 'pull')
      return
    }
    throw error
  }
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
      await runAthleteWrite(remotePlan.athleteId, () => db.trainingPlans.put(remotePlan))
      continue
    }

    if (remotePlan.updatedAt > localPlan.updatedAt) {
      const mergedPlan = preserveLocalOnlyTrainingPlanFields(remotePlan, localPlan)
      await runAthleteWrite(remotePlan.athleteId, () => db.trainingPlans.put(mergedPlan))
    } else if (localPlan.updatedAt > remotePlan.updatedAt && isSyncablePlanStatus(localPlan.status)) {
      context.pendingWrites.push(() => pushTrainingPlan(localPlan))
    }
  }

  if (!context.allowDeletes || context.deleteBeforeTs == null) return

  const localPlans = await db.trainingPlans.toArray()
  const athleteScope = deleteAthleteScope(context)
  for (const localPlan of localPlans) {
    if (athleteScope !== undefined && !isInAthleteScope(localPlan.athleteId, athleteScope)) continue
    if (!isSyncablePlanStatus(localPlan.status)) continue
    if (remoteIds.has(localPlan.id)) continue
    if (localPlan.updatedAt > context.deleteBeforeTs) continue
    await deleteLocalTrainingPlan(localPlan.id)
  }
}

async function mergeTrainingPlanWeeks(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('training_plan_weeks')) return
  if (isSchemaMismatchBlocked('training_plan_weeks')) return
  let remoteRows: Record<string, unknown>[]
  try {
    remoteRows = await fetchAll<Record<string, unknown>>('training_plan_weeks', userId, context.readScope)
  } catch (error) {
    const errorInfo = classifySyncError(error, 'training_plan_weeks')
    if (isOptionalPlanSchemaMismatch(errorInfo, 'training_plan_weeks')) {
      trackOptionalPlanSyncSkip('training_plan_weeks', errorInfo, 'pull')
      return
    }
    throw error
  }
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
      await runAthleteWrite(remoteWeek.athleteId, () => db.trainingPlanWeeks.put(remoteWeek))
      continue
    }

    if (remoteWeek.updatedAt > localWeek.updatedAt) {
      await runAthleteWrite(remoteWeek.athleteId, () => db.trainingPlanWeeks.put(remoteWeek))
    } else if (localWeek.updatedAt > remoteWeek.updatedAt) {
      const localPlan = localPlans.find((plan) => plan.id === localWeek.planId)
      if (localPlan && isSyncablePlanStatus(localPlan.status)) {
        context.pendingWrites.push(() => pushTrainingPlanWeeks(localPlan, [localWeek]))
      }
    }
  }

  if (!context.allowDeletes || context.deleteBeforeTs == null) return

  const localWeeks = await db.trainingPlanWeeks.toArray()
  const athleteScope = deleteAthleteScope(context)
  for (const localWeek of localWeeks) {
    if (athleteScope !== undefined && !isInAthleteScope(localWeek.athleteId, athleteScope)) continue
    if (!syncablePlanIds.has(localWeek.planId)) continue
    if (remoteIds.has(localWeek.id)) continue
    if (localWeek.updatedAt > context.deleteBeforeTs) continue
    await db.trainingPlanWeeks.delete(localWeek.id)
  }
}

async function deleteMissingLocalRows<T extends { id: string; athleteId?: string }>(
  table: { toArray: () => Promise<T[]>; bulkDelete: (keys: string[]) => Promise<void> },
  remoteIds: Set<string>,
  getLocalUpdatedAt: (row: T) => number | null | undefined,
  deleteBeforeTs: number | null,
  athleteScope?: string | null,
): Promise<void> {
  if (deleteBeforeTs == null) {
    return
  }

  const localRows = await table.toArray()
  const idsToDelete = localRows
    .filter((row) => {
      if (remoteIds.has(row.id)) return false
      if (athleteScope !== undefined && !isInAthleteScope(row.athleteId, athleteScope)) return false

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

async function findDayLogConflictByDate(
  date: string,
  remoteAthleteId: string | undefined,
  activeAthleteId: string | null,
): Promise<DayLog | undefined> {
  const remoteKey = effectiveAthleteKey(remoteAthleteId, activeAthleteId)
  const candidates = await db.dayLogs.where('date').equals(date).toArray()
  return candidates
    .filter((row) => effectiveAthleteKey(row.athleteId, activeAthleteId) === remoteKey)
    .sort(compareDayLogConflictCandidates)[0]
}

async function findWeekSummaryConflictByWeekStart(
  weekStartDate: string,
  remoteAthleteId: string | undefined,
  activeAthleteId: string | null,
): Promise<WeekSummary | undefined> {
  const remoteKey = effectiveAthleteKey(remoteAthleteId, activeAthleteId)
  const candidates = await db.weekSummaries.where('weekStartDate').equals(weekStartDate).toArray()
  return candidates
    .filter((row) => effectiveAthleteKey(row.athleteId, activeAthleteId) === remoteKey)
    .sort(compareWeekSummaryConflictCandidates)[0]
}

function compareDayLogConflictCandidates(a: DayLog, b: DayLog): number {
  const scopedDelta = Number(isScopedAthleteId(b.athleteId)) - Number(isScopedAthleteId(a.athleteId))
  if (scopedDelta !== 0) return scopedDelta
  return compareDayLogsForRepair(a, b)
}

function compareWeekSummaryConflictCandidates(a: WeekSummary, b: WeekSummary): number {
  const scopedDelta = Number(isScopedAthleteId(b.athleteId)) - Number(isScopedAthleteId(a.athleteId))
  if (scopedDelta !== 0) return scopedDelta
  return compareWeekSummariesForRepair(a, b)
}

/**
 * Coalescencia sólo para el primer bulk-upsert. La reparación durable de Dexie
 * queda en `repairLocalNaturalKeyConflicts`, que se ejecuta en el sync completo
 * inmediatamente posterior a una migración exitosa.
 */
function coalesceMigrationDayLogs(rows: DayLog[], userId: string): DayLog[] {
  const selfAthleteId = athleteIdForOwner(userId)
  return coalesceRowsByNaturalKey(
    rows,
    (row) => `${effectiveAthleteKey(row.athleteId, selfAthleteId)}::${row.date}`,
    compareDayLogsForRepair,
  )
}

function coalesceMigrationWeekSummaries(rows: WeekSummary[], userId: string): WeekSummary[] {
  const selfAthleteId = athleteIdForOwner(userId)
  return coalesceRowsByNaturalKey(
    rows,
    (row) => `${effectiveAthleteKey(row.athleteId, selfAthleteId)}::${row.weekStartDate}`,
    compareWeekSummariesForRepair,
  )
}

function coalesceRowsByNaturalKey<T>(
  rows: T[],
  keyFor: (row: T) => string,
  compare: (a: T, b: T) => number,
): T[] {
  const winners = new Map<string, T>()
  for (const row of rows) {
    const key = keyFor(row)
    const current = winners.get(key)
    if (!current || compare(row, current) < 0) winners.set(key, row)
  }
  return [...winners.values()]
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
  // Legacy rows group/stamp under the SELF athlete, never a managed active one.
  const activeAthleteId = getSelfAthleteId() ?? getActiveAthleteId()
  const groups = groupRowsBy(rows, (row) => `${effectiveAthleteKey(row.athleteId, activeAthleteId)}::${row.date}`)

  for (const duplicates of groups.values()) {
    if (duplicates.length <= 1) continue
    const sorted = [...duplicates].sort(compareDayLogsForRepair)
    const stamped = stampAthleteIdIfLegacy(sorted[0], activeAthleteId)
    const winner = stamped.row
    const loserIds = sorted.slice(1).map((row) => row.id)
    if (loserIds.length > 0) {
      await db.dayLogs.bulkDelete(loserIds)
      if (stamped.changed) {
        await db.dayLogs.put(winner)
      }
      await Promise.all(loserIds.map((id) => deleteRow('day_logs', id)))
      await pushDayLog(winner)
    }
  }
}

async function repairLocalWeekSummaryConflicts(): Promise<void> {
  const rows = await db.weekSummaries.toArray()
  // Legacy rows group/stamp under the SELF athlete, never a managed active one.
  const activeAthleteId = getSelfAthleteId() ?? getActiveAthleteId()
  const groups = groupRowsBy(rows, (row) => `${effectiveAthleteKey(row.athleteId, activeAthleteId)}::${row.weekStartDate}`)

  for (const duplicates of groups.values()) {
    if (duplicates.length <= 1) continue
    const sorted = [...duplicates].sort(compareWeekSummariesForRepair)
    const stamped = stampAthleteIdIfLegacy(sorted[0], activeAthleteId)
    const winner = stamped.row
    const loserIds = sorted.slice(1).map((row) => row.id)
    if (loserIds.length > 0) {
      await db.weekSummaries.bulkDelete(loserIds)
      if (stamped.changed) {
        await db.weekSummaries.put(winner)
      }
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
  return getDeleteTombstones(SESSION_DELETE_TOMBSTONES_KEY, userId)
}

function getCoachProposalDeleteTombstones(userId: string): Record<string, number> {
  return getDeleteTombstones(COACH_PROPOSAL_DELETE_TOMBSTONES_KEY, userId)
}

function getDeleteTombstones(storageKey: string, userId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey)
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
  pruneExpiredTombstoneGroup(SESSION_DELETE_TOMBSTONES_KEY, userId)
}

function pruneExpiredCoachProposalTombstones(userId: string): void {
  pruneExpiredTombstoneGroup(COACH_PROPOSAL_DELETE_TOMBSTONES_KEY, userId)
}

function pruneExpiredTombstoneGroup(storageKey: string, userId: string): void {
  try {
    const raw = localStorage.getItem(storageKey)
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
      localStorage.setItem(storageKey, JSON.stringify(parsed))
    }
  } catch {
    // Ignore storage failures
  }
}

function saveSessionDeleteTombstones(userId: string, tombstones: Record<string, number>): void {
  saveDeleteTombstones(SESSION_DELETE_TOMBSTONES_KEY, userId, tombstones)
}

function saveCoachProposalDeleteTombstones(userId: string, tombstones: Record<string, number>): void {
  saveDeleteTombstones(COACH_PROPOSAL_DELETE_TOMBSTONES_KEY, userId, tombstones)
}

function saveDeleteTombstones(storageKey: string, userId: string, tombstones: Record<string, number>): void {
  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) as Record<string, Record<string, number>> : {}
    const next = { ...parsed, [userId]: tombstones }
    if (Object.keys(tombstones).length === 0) {
      delete next[userId]
    }
    localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // Ignore storage failures.
  }
}

function clearSyncArtifactsForUser(userId: string): void {
  clearQueuedOpsForTables(userId, REMOTE_WIPE_ORDER)
  clearSessionDeleteTombstoneGroup(userId)
  clearCoachProposalDeleteTombstoneGroup(userId)
  localStorage.removeItem(getMigrationKey(userId))
  localStorage.removeItem(getRemoteAthleteAckKey(userId))
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
  if (selection.coachProposals) {
    clearCoachProposalDeleteTombstoneGroup(userId)
  }
}

function clearSessionDeleteTombstoneGroup(userId: string): void {
  clearDeleteTombstoneGroup(SESSION_DELETE_TOMBSTONES_KEY, userId)
}

function clearCoachProposalDeleteTombstoneGroup(userId: string): void {
  clearDeleteTombstoneGroup(COACH_PROPOSAL_DELETE_TOMBSTONES_KEY, userId)
}

function clearDeleteTombstoneGroup(storageKey: string, userId: string): void {
  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) as Record<string, Record<string, number>> : {}
    if (!(userId in parsed)) return
    delete parsed[userId]
    localStorage.setItem(storageKey, JSON.stringify(parsed))
  } catch {
    // Ignore storage failures.
  }
}

function rememberDeleteTombstoneForTable(table: SupabaseTable, userId: string, id: string): void {
  if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
  if (table === 'coach_proposals') rememberCoachProposalDeleteTombstone(userId, id)
  if (table === 'athletes') {
    try {
      rememberAthleteDeleteTombstone(userId, id)
    } catch {
      syncLog('rememberDeleteTombstoneForTable:athletes_tombstone_failed', { id }, 'warn')
    }
  }
}

export function rememberSessionDeleteTombstone(userId: string, sessionId: string): void {
  const tombstones = getSessionDeleteTombstones(userId)
  tombstones[sessionId] = Date.now()
  saveSessionDeleteTombstones(userId, tombstones)
}

function rememberCoachProposalDeleteTombstone(userId: string, proposalId: string): void {
  const tombstones = getCoachProposalDeleteTombstones(userId)
  tombstones[proposalId] = Date.now()
  saveCoachProposalDeleteTombstones(userId, tombstones)
}

function clearSessionDeleteTombstone(userId: string, sessionId: string): void {
  const tombstones = getSessionDeleteTombstones(userId)
  if (!(sessionId in tombstones)) return
  delete tombstones[sessionId]
  saveSessionDeleteTombstones(userId, tombstones)
}

function clearCoachProposalDeleteTombstone(userId: string, proposalId: string): void {
  const tombstones = getCoachProposalDeleteTombstones(userId)
  if (!(proposalId in tombstones)) return
  delete tombstones[proposalId]
  saveCoachProposalDeleteTombstones(userId, tombstones)
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

function pruneCoachProposalDeleteTombstones(
  userId: string,
  remoteIds: Set<string>,
  options: { pullWasComplete: boolean },
): void {
  const tombstones = getCoachProposalDeleteTombstones(userId)
  let changed = false
  const now = Date.now()

  for (const proposalId of Object.keys(tombstones)) {
    const deletedAt = tombstones[proposalId]
    if (now - deletedAt >= TOMBSTONE_TTL_MS) {
      delete tombstones[proposalId]
      changed = true
    }
  }

  if (options.pullWasComplete) {
    for (const proposalId of Object.keys(tombstones)) {
      if (!remoteIds.has(proposalId)) {
        delete tombstones[proposalId]
        changed = true
      }
    }
  }

  if (changed) {
    saveCoachProposalDeleteTombstones(userId, tombstones)
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
    await clearAllLocalAppDataForSync(previousUserId)
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
    await ensureRemoteAthlete(userId)
    const localAthletes = await db.athletes.toArray()
    for (const athlete of localAthletes) {
      if (athlete.ownerAccountId !== userId) continue
      if (athlete.id === athleteIdForOwner(userId)) continue
      await ensureRemoteAthlete(userId, athlete.id)
    }

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

    // La migración inicial ocurre antes de `runFullSync`, que normalmente repara
    // duplicados locales por clave natural. Un cliente que conserva una fila
    // legacy y otra ya scoped para la misma fecha/semana no puede enviarlas juntas:
    // Postgres rechaza un `ON CONFLICT DO UPDATE` que intenta actualizar dos veces
    // la misma clave. Coalescemos sólo el payload de migración con la misma regla
    // LWW determinista; el full sync posterior limpia la fila perdedora en Dexie.
    const migrationDayLogs = coalesceMigrationDayLogs(dayLogs, userId)
    const migrationWeekSummaries = coalesceMigrationWeekSummaries(weekSummaries, userId)

    const syncablePlans = trainingPlans.filter((plan) => isSyncablePlanStatus(plan.status))
    const syncablePlanIds = new Set(syncablePlans.map((plan) => plan.id))
    const syncablePlanAthleteIds = new Map(syncablePlans.map((plan) => [plan.id, plan.athleteId]))
    const syncableWeeks = trainingPlanWeeks.filter((week) => syncablePlanIds.has(week.planId))

    const sessionRows = sessions.map((session) => withAthleteId(sessionToRow(session, userId), session.athleteId))
    const dayLogRows = migrationDayLogs.map((dayLog) => withAthleteId(dayLogToRow(dayLog, userId), dayLog.athleteId))
    const weekRows = migrationWeekSummaries.map((summary) => withAthleteId(weekSummaryToRow(summary, userId), summary.athleteId))
    const trainingPlanRows = syncablePlans.map((plan) => trainingPlanToRow(plan, userId))
    const trainingPlanWeekRows = syncableWeeks.map((week) =>
      withAthleteId(trainingPlanWeekToRow(week, userId), week.athleteId ?? syncablePlanAthleteIds.get(week.planId)),
    )
    const chatRows = chatMessages.map((message) => withAthleteId(chatMessageToRow(message, userId), message.athleteId))
    const proposalRows = coachProposals.map((proposal) => withAthleteId(coachProposalToRow(proposal, userId), proposal.athleteId))
    const profileRows = athleteProfiles.map((profile) => withAthleteId(athleteProfileToRow(profile, userId), profile.athleteId))

    const upsertMigrationRows = async (
      table: SupabaseTable,
      rows: Array<Record<string, unknown>>,
      options?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) => {
      if (rows.length === 0) return { table, error: null }
      const result = options
        ? await getSupabase().from(table).upsert(rows as never, options)
        : await getSupabase().from(table).upsert(rows as never)
      return { table, error: result.error }
    }

    const migrationResults = await Promise.all([
      upsertMigrationRows('sessions', sessionRows, { onConflict: 'id' }),
      upsertMigrationRows('day_logs', dayLogRows, { onConflict: 'athlete_id,date' }),
      upsertMigrationRows('week_summaries', weekRows, { onConflict: 'athlete_id,week_start_date' }),
      upsertMigrationRows('chat_messages', chatRows),
      upsertMigrationRows('coach_proposals', proposalRows, { onConflict: 'id' }),
    ])
    const trainingPlanResult = trainingPlanRows.length > 0
      ? await getSupabase()
        .from('training_plans')
        .upsert(trainingPlanRows as never, { onConflict: 'id' })
        .then((result) => normalizeOptionalPlanMigrationResult('training_plans', result.error))
      : { table: 'training_plans' as const, error: null }
    const trainingPlanWeekResult = trainingPlanWeekRows.length > 0
      ? await getSupabase()
        .from('training_plan_weeks')
        .upsert(trainingPlanWeekRows as never, { onConflict: 'id' })
        .then((result) => normalizeOptionalPlanMigrationResult('training_plan_weeks', result.error))
      : { table: 'training_plan_weeks' as const, error: null }
    if (profileRows.length > 0 && !getProfileResetLock(userId)) {
      const syncRows = profileRows.map(toAthleteProfileSyncRow)
      const migrateGroups = groupAthleteProfileRows(syncRows, groupingSelfAthleteId(userId))
      for (const groupRows of migrateGroups.values()) {
        const coalesced = coalesceAthleteProfileRows(groupRows)
        await persistAthleteProfileRow(coalesced as unknown as Record<string, unknown>, userId)
      }
    }
    const profileResult = { table: 'athlete_profiles' as const, error: null }
    migrationResults.push(trainingPlanResult, trainingPlanWeekResult, profileResult)

    const failedTables = migrationResults.filter((result) => result.error != null)
    if (failedTables.length > 0) {
      throw new MigrationPartialFailure(failedTables as Array<{ table: SupabaseTable; error: unknown }>)
    }

    localStorage.setItem(getMigrationKey(userId), '1')
    localStorage.setItem(LAST_SYNC_USER_KEY, userId)
    console.log('[sync] Initial migration complete')
  } catch (error) {
    const blockedTable = error instanceof MigrationPartialFailure
      ? error.failures[0]?.table
      : undefined
    const rootCause = error instanceof MigrationPartialFailure
      ? error.failures[0]?.error ?? error
      : error
    applySyncFailure(rootCause, 'No se pudo migrar los datos locales a la nube.', blockedTable)
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
    const groups = groupAthleteProfileRows(remoteRows, groupingSelfAthleteId(userId))
    const duplicateGroups = [...groups.values()].filter((rows) => rows.length > 1)
    if (duplicateGroups.length === 0) {
      syncStoreState().setSyncDetails({
        autoRepairInProgress: false,
        lastAutoRepairAt: Date.now(),
      })
      return { remoteRowsBefore: remoteRows.length, repaired: false }
    }
    for (const rows of duplicateGroups) {
      await repairRemoteAthleteProfileRows(userId, rows)
    }
    syncStoreState().setSyncDetails({
      autoRepairInProgress: false,
      lastAutoRepairAt: Date.now(),
    })
    trackSyncEvent({
      kind: 'repair',
      status: 'ok',
      entity: 'athlete_profiles',
      userId,
      detail: `repaired_${duplicateGroups.length}_profile_groups`,
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

function normalizeOptionalPlanMigrationResult(
  table: 'training_plans' | 'training_plan_weeks',
  error: null,
): { table: 'training_plans' | 'training_plan_weeks'; error: null }
function normalizeOptionalPlanMigrationResult<TError>(
  table: 'training_plans' | 'training_plan_weeks',
  error: TError,
): { table: 'training_plans' | 'training_plan_weeks'; error: TError | null }
function normalizeOptionalPlanMigrationResult<TError>(
  table: 'training_plans' | 'training_plan_weeks',
  error: TError | null,
): { table: 'training_plans' | 'training_plan_weeks'; error: TError | null } {
  if (!error) return { table, error: null }
  const errorInfo = classifySyncError(error, table)
  if (isOptionalPlanSchemaMismatch(errorInfo, table)) {
    trackOptionalPlanSyncSkip(table, errorInfo, 'migration')
    return { table, error: null }
  }
  return { table, error }
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
    await clearAllLocalAppDataForSync(userId)
    clearSyncArtifactsForUser(userId)
    clearProfileResetLock(userId)
    acknowledgeRemoteFullReset(userId, Date.now())
    return { ...outcome, pending: [], completed: true }
  }

  markProfileResetLockStatus(userId, 'pending_remote_wipe')
  clearQueuedOpsForTables(userId, allTables)
  clearSessionDeleteTombstoneGroup(userId)
  clearCoachProposalDeleteTombstoneGroup(userId)
  registerPendingRemoteWipe(userId, allTables, { fullReset: true })

  const processed = await processPendingRemoteWipes(userId)
  if (!processed.completed) return processed

  await clearAllLocalAppDataForSync(userId)
  clearSyncArtifactsForUser(userId)
  const remoteResetAt = await fetchRemoteFullResetAtBestEffort(userId)
  acknowledgeRemoteFullReset(userId, remoteResetAt ?? Date.now())
  markProfileResetLockStatus(userId, 'awaiting_bootstrap_ack', remoteResetAt ?? undefined)

  return { ...processed, pending: [], completed: true }
}

async function clearRemoteAthleteProfileData(userId: string): Promise<void> {
  const clearedProfile: AthleteProfile = {
    id: ATHLETE_PROFILE_LOCAL_ID,
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
  const persistResetMarker = async (remoteRows?: AthleteProfileSyncRow[]): Promise<void> => {
    // The marker now has athlete_id, so the self athlete must exist and must
    // survive the later athletes wipe; otherwise the FK cascade removes it.
    await ensureRemoteAthlete(userId)
    await persistAthleteProfileRow(marker, userId, remoteRows, { mode: 'technical_marker' })
  }
  try {
    await persistResetMarker([])
  } catch {
    try {
      await persistResetMarker(undefined)
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
