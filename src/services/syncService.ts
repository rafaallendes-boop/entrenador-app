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

type SupabaseTable =
  | 'sessions'
  | 'day_logs'
  | 'week_summaries'
  | 'chat_messages'
  | 'coach_proposals'
  | 'athlete_profiles'

interface OfflineOp {
  userId: string
  table: SupabaseTable
  action: 'upsert' | 'delete'
  payload: Record<string, unknown>
  enqueuedAt: number
}

const QUEUE_KEY = 'entrenador_sync_queue_v1'
const LAST_SYNC_USER_KEY = 'entrenador_sync_user_v1'
const MIGRATION_KEY_PREFIX = 'entrenador_migrated_v1'
const MAX_QUEUE_SIZE = 500

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
}

function enqueue(op: OfflineOp): void {
  const queue = loadQueue()
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
  }
  queue.push(op)
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

async function drainQueue(): Promise<boolean> {
  const queue = loadQueue()
  const userId = getUserId()

  if (!userId) {
    return queue.length === 0
  }

  const otherUsersQueue = queue.filter((op) => op.userId !== userId)
  const currentUserQueue = queue.filter((op) => op.userId === userId)

  if (currentUserQueue.length === 0) {
    saveQueue(otherUsersQueue)
    return true
  }

  const remaining: OfflineOp[] = []

  for (const op of currentUserQueue) {
    try {
      if (op.action === 'upsert') {
        const { error } = await supabase.from(op.table).upsert(op.payload as never)
        if (error) throw error
      } else {
        const payload = op.payload as { id: string; userId?: string }
        const targetUserId = payload.userId ?? op.userId
        const { error } = await supabase
          .from(op.table)
          .delete()
          .eq('id', payload.id)
          .eq('user_id', targetUserId)
        if (error) throw error
      }
    } catch {
      remaining.push(op)
      break
    }
  }

  saveQueue([...otherUsersQueue, ...remaining])
  return remaining.length === 0
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void drainQueue()
  })
}

export { drainQueue }

async function upsertRow(table: SupabaseTable, row: Record<string, unknown>): Promise<void> {
  if (!isEnabled()) return

  const userId = getUserId()
  if (!userId) return

  if (!navigator.onLine) {
    enqueue({ userId, table, action: 'upsert', payload: row, enqueuedAt: Date.now() })
    return
  }

  try {
    const { error } = await supabase.from(table).upsert(row as never)
    if (error) throw error
    void drainQueue()
  } catch {
    enqueue({ userId, table, action: 'upsert', payload: row, enqueuedAt: Date.now() })
  }
}

async function deleteRow(table: SupabaseTable, id: string): Promise<void> {
  if (!isEnabled()) return

  const userId = getUserId()
  if (!userId) return

  if (!navigator.onLine) {
    enqueue({ userId, table, action: 'delete', payload: { id, userId }, enqueuedAt: Date.now() })
    return
  }

  try {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  } catch {
    enqueue({ userId, table, action: 'delete', payload: { id, userId }, enqueuedAt: Date.now() })
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

function athleteProfileToRow(profile: AthleteProfile, userId: string): Record<string, unknown> {
  return {
    id: profile.id,
    user_id: userId,
    coach_memory: profile.coachMemory ?? null,
    updated_at: profile.updatedAt,
  }
}

function rowToAthleteProfile(row: Record<string, unknown>): AthleteProfile {
  return {
    id: (row.id as string) ?? 'default',
    coachMemory: (row.coach_memory as string | null) ?? undefined,
    updatedAt: row.updated_at as number,
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
  if (!isEnabled()) return

  const { setSyncStatus } = useAuthStore.getState()
  setSyncStatus('syncing')

  try {
    const queueDrained = await drainQueue()

    await Promise.all([
      mergeSessions(userId, queueDrained),
      mergeDayLogs(userId, queueDrained),
      mergeWeekSummaries(userId, queueDrained),
      mergeChatMessages(userId, queueDrained),
      mergeCoachProposals(userId, queueDrained),
      mergeAthleteProfile(userId, queueDrained),
    ])

    setSyncStatus('idle')
  } catch (error) {
    console.error('[sync] pullAll error:', error)
    setSyncStatus('error', error instanceof Error ? error.message : 'Error de sincronizacion')
  }
}

async function mergeSessions(userId: string, allowDeletes: boolean): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('sessions', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToSession(row)
    remoteIds.add(remote.id)

    const local = await db.sessions.get(remote.id)
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.sessions.put(remote)
    } else if (local.updatedAt > remote.updatedAt) {
      void pushSession(local)
    }
  }

  if (allowDeletes) {
    await deleteMissingLocalRows(db.sessions, remoteIds)
  }
}

async function mergeDayLogs(userId: string, allowDeletes: boolean): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('day_logs', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToDayLog(row)
    remoteIds.add(remote.id)

    const local = await db.dayLogs.get(remote.id)
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.dayLogs.put(remote)
    } else if (local.updatedAt > remote.updatedAt) {
      void pushDayLog(local)
    }
  }

  if (allowDeletes) {
    await deleteMissingLocalRows(db.dayLogs, remoteIds)
  }
}

async function mergeWeekSummaries(userId: string, allowDeletes: boolean): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('week_summaries', userId)
  const remoteIds = new Set<string>()

  for (const row of remoteRows) {
    const remote = rowToWeekSummary(row)
    remoteIds.add(remote.id)

    const remoteUpdatedAt = (row.updated_at as number) ?? 0
    const local = await db.weekSummaries.get(remote.id)
    const localUpdatedAt = ((local as Record<string, unknown> | undefined)?.updatedAt as number) ?? 0

    if (!local || remoteUpdatedAt > localUpdatedAt) {
      await db.weekSummaries.put(remote)
    } else if (localUpdatedAt > remoteUpdatedAt) {
      void pushWeekSummary(local)
    }
  }

  if (allowDeletes) {
    await deleteMissingLocalRows(db.weekSummaries, remoteIds)
  }
}

async function mergeChatMessages(userId: string, allowDeletes: boolean): Promise<void> {
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

  if (allowDeletes) {
    await deleteMissingLocalRows(db.chatMessages, remoteIds)
  }
}

async function mergeCoachProposals(userId: string, allowDeletes: boolean): Promise<void> {
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

  if (allowDeletes) {
    await deleteMissingLocalRows(db.coachProposals, remoteIds)
  }
}

async function mergeAthleteProfile(userId: string, allowDeletes: boolean): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('athlete_profiles', userId)

  if (remoteRows.length === 0) {
    if (allowDeletes) {
      await db.athleteProfiles.clear()
    }
    return
  }

  const remote = rowToAthleteProfile(remoteRows[0])
  const remoteUpdatedAt = (remoteRows[0].updated_at as number) ?? 0
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
): Promise<void> {
  const localRows = await table.toArray()
  const idsToDelete = localRows
    .map((row) => row.id)
    .filter((id) => !remoteIds.has(id))

  if (idsToDelete.length > 0) {
    await table.bulkDelete(idsToDelete)
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
      profileRows.length > 0 && supabase.from('athlete_profiles').upsert(profileRows as never),
    ])

    localStorage.setItem(getMigrationKey(userId), '1')
    localStorage.setItem(LAST_SYNC_USER_KEY, userId)
    console.log('[sync] Initial migration complete')
  } catch (error) {
    console.error('[sync] Migration failed:', error)
  }
}
