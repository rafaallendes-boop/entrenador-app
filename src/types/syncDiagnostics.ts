import type { SupabaseTable, SyncErrorCategory } from '../services/syncUtils'

export type SyncTier = 'A' | 'B' | 'C'

export type SyncTierHealth = 'healthy' | 'degraded' | 'blocked' | 'unknown'

export type SyncEventStatus = 'ok' | 'error' | 'retry' | 'skip' | 'dropped'

export type SyncEventKind =
  | 'push'
  | 'delete'
  | 'drain'
  | 'pull'
  | 'merge'
  | 'repair'
  | 'migration'
  | 'timeout'

export interface SyncDiagnosticEvent {
  id?: number
  timestamp: number
  userId: string | null
  kind: SyncEventKind
  entity?: SupabaseTable | null
  tier?: SyncTier | null
  status: SyncEventStatus
  durationMs?: number | null
  errorCategory?: SyncErrorCategory | null
  detail?: string | null
}

export interface SyncErrorLogEntry {
  id?: number
  timestamp: number
  userId: string | null
  entity: SupabaseTable | null
  tier: SyncTier | null
  errorCategory: SyncErrorCategory
  userMessage: string
  technicalMessage: string
  retriable: boolean
  autoRepairable: boolean
}

export interface SyncTierHealthMap {
  A: SyncTierHealth
  B: SyncTierHealth
  C: SyncTierHealth
}

export const ENTITY_TIER: Record<SupabaseTable, SyncTier> = {
  athletes: 'A',
  athlete_profiles: 'A',
  athlete_memberships: 'A',
  athlete_coach_notes: 'B',
  sessions: 'A',
  training_plans: 'A',
  training_plan_weeks: 'A',
  day_logs: 'B',
  readiness_daily: 'B',
  week_summaries: 'B',
  coach_proposals: 'B',
  chat_messages: 'C',
  session_templates: 'B',
}

export function getEntityTier(entity: SupabaseTable | null | undefined): SyncTier | null {
  if (!entity) return null
  return ENTITY_TIER[entity] ?? null
}
