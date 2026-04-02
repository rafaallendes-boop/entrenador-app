/**
 * syncService.ts
 *
 * Sync layer between local Dexie (source of truth) and Supabase (cloud backup).
 *
 * Strategy:
 * - All reads always go through Dexie — no UI waits for cloud.
 * - Every Dexie write fires a fire-and-forget push to Supabase.
 * - On app load (after auth), pullAll() merges remote data into Dexie using last-write-wins.
 * - If offline or Supabase errors: ops are queued in localStorage and drained on reconnect.
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

// ─── Offline Queue ────────────────────────────────────────────────────────────

type SupabaseTable =
  | 'sessions'
  | 'day_logs'
  | 'week_summaries'
  | 'chat_messages'
  | 'coach_proposals'
  | 'athlete_profiles'

interface OfflineOp {
  table: SupabaseTable
  action: 'upsert' | 'delete'
  payload: Record<string, unknown>
  enqueuedAt: number
}

const QUEUE_KEY = 'entrenador_sync_queue_v1'
const MIGRATION_KEY = 'entrenador_migrated_v1'
const MAX_QUEUE_SIZE = 500

function loadQueue(): OfflineOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as OfflineOp[]) : []
  } catch {
    return []
  }
}

function saveQueue(queue: OfflineOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // localStorage full — silently ignore
  }
}

function enqueue(op: OfflineOp): void {
  const queue = loadQueue()
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift() // drop oldest
  }
  queue.push(op)
  saveQueue(queue)
}

async function drainQueue(): Promise<void> {
  const queue = loadQueue()
  if (queue.length === 0) return

  const remaining: OfflineOp[] = []
  for (const op of queue) {
    try {
      if (op.action === 'upsert') {
        const { error } = await supabase.from(op.table).upsert(op.payload as never)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from(op.table)
          .delete()
          .eq('id', (op.payload as { id: string }).id)
        if (error) throw error
      }
    } catch {
      remaining.push(op)
      break // stop on first failure — will retry next trigger
    }
  }
  saveQueue(remaining)
}

// Listen for reconnection to drain pending ops
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void drainQueue() })
}

export { drainQueue }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null
}

function isEnabled(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  return Boolean(url)
}

async function upsertRow(table: SupabaseTable, row: Record<string, unknown>): Promise<void> {
  if (!isEnabled()) return
  const userId = getUserId()
  if (!userId) return

  if (!navigator.onLine) {
    enqueue({ table, action: 'upsert', payload: row, enqueuedAt: Date.now() })
    return
  }

  try {
    const { error } = await supabase.from(table).upsert(row as never)
    if (error) throw error
    void drainQueue() // piggyback any queued ops
  } catch {
    enqueue({ table, action: 'upsert', payload: row, enqueuedAt: Date.now() })
  }
}

async function deleteRow(table: SupabaseTable, id: string): Promise<void> {
  if (!isEnabled()) return
  const userId = getUserId()
  if (!userId) return

  if (!navigator.onLine) {
    enqueue({ table, action: 'delete', payload: { id }, enqueuedAt: Date.now() })
    return
  }

  try {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  } catch {
    enqueue({ table, action: 'delete', payload: { id }, enqueuedAt: Date.now() })
  }
}

// ─── Row mappers: local type → Supabase row ───────────────────────────────────

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
  // updatedAt may not exist in all WeekSummary rows — derive from existing field or now
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

// ─── Push functions (called after every local write) ─────────────────────────

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

// ─── Pull & merge helpers ─────────────────────────────────────────────────────

async function fetchAll<T>(table: SupabaseTable, userId: string): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error(`[sync] fetch error on ${table}:`, error.message)
    return []
  }
  return (data ?? []) as T[]
}

// ─── pullAll: merge remote into local Dexie ───────────────────────────────────

export async function pullAll(userId: string): Promise<void> {
  if (!isEnabled()) return

  const { setSyncStatus } = useAuthStore.getState()
  setSyncStatus('syncing')

  try {
    // Drain queued ops before pulling so the server sees our latest writes
    await drainQueue()

    await Promise.all([
      mergeSessions(userId),
      mergeDayLogs(userId),
      mergeWeekSummaries(userId),
      mergeChatMessages(userId),
      mergeCoachProposals(userId),
      mergeAthleteProfile(userId),
    ])

    setSyncStatus('idle')
  } catch (e) {
    console.error('[sync] pullAll error:', e)
    setSyncStatus('error', e instanceof Error ? e.message : 'Error de sincronizacion')
  }
}

async function mergeSessions(userId: string): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('sessions', userId)
  for (const row of remoteRows) {
    const remote = rowToSession(row)
    const local = await db.sessions.get(remote.id)
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.sessions.put(remote)
    } else if (local.updatedAt > remote.updatedAt) {
      void pushSession(local)
    }
  }
}

async function mergeDayLogs(userId: string): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('day_logs', userId)
  for (const row of remoteRows) {
    const remote = rowToDayLog(row)
    const local = await db.dayLogs.get(remote.id)
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.dayLogs.put(remote)
    } else if (local.updatedAt > remote.updatedAt) {
      void pushDayLog(local)
    }
  }
}

async function mergeWeekSummaries(userId: string): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('week_summaries', userId)
  for (const row of remoteRows) {
    const remote = rowToWeekSummary(row)
    const remoteUpdatedAt = (row.updated_at as number) ?? 0
    const local = await db.weekSummaries.get(remote.id)
    const localUpdatedAt = (local as Record<string, unknown> | undefined)?.updatedAt as number ?? 0
    if (!local || remoteUpdatedAt > localUpdatedAt) {
      await db.weekSummaries.put(remote)
    } else if (localUpdatedAt > remoteUpdatedAt) {
      void pushWeekSummary(local)
    }
  }
}

async function mergeChatMessages(userId: string): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('chat_messages', userId)
  // Chat messages are append-only — just add any we don't have locally
  for (const row of remoteRows) {
    const remote = rowToChatMessage(row)
    const local = await db.chatMessages.get(remote.id)
    if (!local) {
      await db.chatMessages.put(remote)
    }
  }
}

async function mergeCoachProposals(userId: string): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('coach_proposals', userId)
  for (const row of remoteRows) {
    const remote = rowToCoachProposal(row)
    const remoteUpdatedAt = (row.updated_at as number) ?? 0
    const local = await db.coachProposals.get(remote.id)
    const localUpdatedAt = (local?.resolvedAt ?? local?.createdAt ?? 0)
    if (!local || remoteUpdatedAt > localUpdatedAt) {
      await db.coachProposals.put(remote)
    } else if (localUpdatedAt > remoteUpdatedAt) {
      void pushCoachProposal(local)
    }
  }
}

async function mergeAthleteProfile(userId: string): Promise<void> {
  const remoteRows = await fetchAll<Record<string, unknown>>('athlete_profiles', userId)
  if (remoteRows.length === 0) return
  const remote = rowToAthleteProfile(remoteRows[0])
  const remoteUpdatedAt = (remoteRows[0].updated_at as number) ?? 0
  const local = await db.athleteProfiles.get('default')
  if (!local || remoteUpdatedAt > local.updatedAt) {
    await db.athleteProfiles.put({ ...remote, id: 'default' })
  } else if (local.updatedAt > remoteUpdatedAt) {
    void pushAthleteProfile(local)
  }
}

// ─── Initial migration (one-time on first login) ──────────────────────────────

export async function migrateLocalDataToCloud(userId: string): Promise<void> {
  if (!isEnabled()) return
  if (localStorage.getItem(MIGRATION_KEY)) return

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

    // Bulk push all local data to Supabase
    const sessionRows = tables.sessions.map((s: Session) => sessionToRow(s, userId))
    const dayLogRows = tables.dayLogs.map((d: DayLog) => dayLogToRow(d, userId))
    const weekRows = tables.weekSummaries.map((w: WeekSummary) => weekSummaryToRow(w, userId))
    const chatRows = tables.chatMessages.map((m: ChatMessage) => chatMessageToRow(m, userId))
    const proposalRows = tables.coachProposals.map((p: CoachProposal) => coachProposalToRow(p, userId))
    const profileRows = tables.athleteProfiles.map((a: AthleteProfile) => athleteProfileToRow(a, userId))

    await Promise.all([
      sessionRows.length > 0 && supabase.from('sessions').upsert(sessionRows as never),
      dayLogRows.length > 0 && supabase.from('day_logs').upsert(dayLogRows as never),
      weekRows.length > 0 && supabase.from('week_summaries').upsert(weekRows as never),
      chatRows.length > 0 && supabase.from('chat_messages').upsert(chatRows as never),
      proposalRows.length > 0 && supabase.from('coach_proposals').upsert(proposalRows as never),
      profileRows.length > 0 && supabase.from('athlete_profiles').upsert(profileRows as never),
    ])

    localStorage.setItem(MIGRATION_KEY, '1')
    console.log('[sync] Initial migration complete')
  } catch (e) {
    console.error('[sync] Migration failed:', e)
    // Don't set the flag — will retry on next login
  }
}
