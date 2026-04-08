import type { AthleteProfile } from '../types'

export type SupabaseTable =
  | 'sessions'
  | 'day_logs'
  | 'week_summaries'
  | 'chat_messages'
  | 'coach_proposals'
  | 'athlete_profiles'

export interface OfflineOp {
  userId: string
  table: SupabaseTable
  action: 'upsert' | 'delete'
  payload: Record<string, unknown>
  enqueuedAt: number
}

export interface AthleteProfileSyncRow extends Record<string, unknown> {
  id: string
  user_id: string
  coach_memory: string | null
  updated_at: number
  data: Record<string, unknown> | null
}

function getSyncErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export function classifyAthleteProfileSyncError(error: unknown): string {
  const message = getSyncErrorMessage(error, 'Error desconocido de athlete_profiles.')
  const normalized = message.toLowerCase()

  if (
    normalized.includes("could not find the 'data' column") ||
    normalized.includes('column athlete_profiles.data does not exist') ||
    normalized.includes('invalid input syntax for type json') ||
    normalized.includes('json')
  ) {
    return 'Schema remoto de athlete_profiles incompatible. Falta la estructura esperada del perfil en Supabase.'
  }

  if (
    normalized.includes('row-level security') ||
    normalized.includes('permission denied') ||
    normalized.includes('new row violates row-level security')
  ) {
    return 'athlete_profiles bloqueado por RLS/permisos. Revisa policies de user_id para select/insert/update/delete.'
  }

  if (
    normalized.includes('duplicate key') ||
    normalized.includes('multiple') ||
    normalized.includes('more than one row') ||
    normalized.includes('json object requested')
  ) {
    return 'Perfil remoto inconsistente o duplicado. Se detecto un conflicto en athlete_profiles y requiere reparacion.'
  }

  return `No se pudo sincronizar athlete_profiles. ${message}`
}

export function athleteProfileToRow(profile: AthleteProfile, userId: string): Record<string, unknown> {
  const { id, coachMemory, updatedAt, ...rest } = profile
  return {
    id,
    user_id: userId,
    coach_memory: coachMemory ?? null,
    updated_at: updatedAt,
    data: Object.keys(rest).length > 0 ? rest : null,
  }
}

export function rowToAthleteProfile(row: Record<string, unknown>): AthleteProfile {
  const data = (row.data as Record<string, unknown> | null) ?? {}
  return {
    id: 'default',
    coachMemory: (row.coach_memory as string | null) ?? undefined,
    updatedAt: row.updated_at as number,
    ...data,
  } as AthleteProfile
}

export function toAthleteProfileSyncRow(row: Record<string, unknown>): AthleteProfileSyncRow {
  return {
    id: String(row.id ?? 'default'),
    user_id: String(row.user_id ?? ''),
    coach_memory: (row.coach_memory as string | null) ?? null,
    updated_at: Number(row.updated_at ?? 0),
    data: ((row.data as Record<string, unknown> | null) ?? null),
  }
}

export function scoreEntityData(value: unknown): number {
  if (value == null) return 0
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + scoreEntityData(item), value.length > 0 ? 1 : 0)
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce((total, [key, item]) => {
      if (key === 'id' || key === 'updatedAt') return total
      return total + scoreEntityData(item)
    }, 0)
  }
  if (typeof value === 'string') return value.trim().length > 0 ? 1 : 0
  if (typeof value === 'number') return Number.isFinite(value) ? 1 : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  return 0
}

function scoreAthleteProfileRow(row: AthleteProfileSyncRow): number {
  return scoreEntityData({
    coachMemory: row.coach_memory,
    updatedAt: row.updated_at,
    ...((row.data as Record<string, unknown> | null) ?? {}),
  })
}

export function pickCanonicalAthleteProfileRow(rows: AthleteProfileSyncRow[]): AthleteProfileSyncRow {
  const sorted = [...rows].sort((a, b) => {
    if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at
    const scoreDiff = scoreAthleteProfileRow(b) - scoreAthleteProfileRow(a)
    if (scoreDiff !== 0) return scoreDiff
    if (a.id === 'default') return -1
    if (b.id === 'default') return 1
    return a.id.localeCompare(b.id)
  })
  return sorted[0]
}

export function compactQueue(queue: OfflineOp[], incoming: OfflineOp): OfflineOp[] {
  const next = queue.filter((queued) => !shouldReplaceQueuedOp(queued, incoming))
  next.push(incoming)
  return next
}

export function shouldReplaceQueuedOp(existing: OfflineOp, incoming: OfflineOp): boolean {
  if (existing.userId !== incoming.userId || existing.table !== incoming.table) return false

  const existingId = getOfflineOpEntityId(existing)
  const incomingId = getOfflineOpEntityId(incoming)
  if (!existingId || !incomingId || existingId !== incomingId) return false

  if (incoming.action === 'delete') {
    return true
  }

  return existing.action === 'upsert'
}

export function getOfflineOpEntityId(op: OfflineOp): string | null {
  const id = op.payload.id
  return typeof id === 'string' && id.length > 0 ? id : null
}
