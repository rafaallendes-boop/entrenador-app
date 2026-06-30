import type { AthleteProfile } from '../types'
import { ATHLETE_PROFILE_LOCAL_ID } from './athlete/activeAthlete'

export type SupabaseTable =
  | 'sessions'
  | 'day_logs'
  | 'week_summaries'
  | 'chat_messages'
  | 'coach_proposals'
  | 'athletes'
  | 'athlete_profiles'
  | 'training_plans'
  | 'training_plan_weeks'

// ─── Typed error classification ──────────────────────────────────────────────

export type SyncErrorCategory =
  | 'duplicate_remote_profile'
  | 'schema_mismatch'
  | 'network_error'
  | 'auth_error'
  | 'validation_error'
  | 'supabase_not_configured'
  | 'rls_error'
  | 'unknown_error'

export interface SyncErrorInfo {
  category: SyncErrorCategory
  /** Whether this error should be retried automatically */
  retriable: boolean
  /** Whether the system can self-repair without user intervention */
  autoRepairable: boolean
  /** User-facing message (non-technical) */
  userMessage: string
  /** Technical details for diagnostics */
  technicalMessage: string
  /** The original underlying error */
  originalError: unknown
}

/**
 * Classify a sync error into a typed category with actionable metadata.
 * This enables programmatic decisions about retry, repair, and UI messaging.
 */
export function classifySyncError(error: unknown, table?: SupabaseTable): SyncErrorInfo {
  // Null/undefined supabase client or custom category
  const isCustomNull = typeof error === 'object' && error !== null && (error as Record<string, unknown>).category === 'supabase_not_configured'
  const isTypeNull = error instanceof TypeError && /cannot read properties of null/i.test(error.message)

  if (isCustomNull || isTypeNull) {
    return {
      category: 'supabase_not_configured',
      retriable: false,
      autoRepairable: false,
      userMessage: 'La conexión a la nube no está configurada.',
      technicalMessage: 'Supabase client is null — check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      originalError: error,
    }
  }

  const message = extractErrorMessage(error)
  const normalized = message.toLowerCase()
  const statusCode = extractStatusCode(error)

  // Network / offline errors
  if (isNetworkErrorMessage(normalized)) {
    return {
      category: 'network_error',
      retriable: true,
      autoRepairable: false,
      userMessage: 'Sin conexión. Tus cambios se subirán automáticamente cuando vuelvas online.',
      technicalMessage: `Network error: ${message}`,
      originalError: error,
    }
  }

  // Auth errors
  if (statusCode === 401 || statusCode === 403) {
    const isRetryableAuth = isRetryableAuthMessage(normalized)
    if (statusCode === 401 && isRetryableAuth) {
      return {
        category: 'auth_error',
        retriable: true,
        autoRepairable: false,
        userMessage: 'Tu sesión expiró. Reintentando automáticamente.',
        technicalMessage: `Retryable auth error (${statusCode}): ${message}`,
        originalError: error,
      }
    }
    if (isRlsErrorMessage(normalized)) {
      return {
        category: 'rls_error',
        retriable: false,
        autoRepairable: false,
        userMessage: 'No se pudo acceder a tus datos en la nube. Puede ser un problema de permisos.',
        technicalMessage: `RLS/permission error on ${table ?? 'unknown'}: ${message}`,
        originalError: error,
      }
    }
    return {
      category: 'auth_error',
      retriable: false,
      autoRepairable: false,
      userMessage: 'Problema de autenticación. Intenta cerrar sesión y volver a entrar.',
      technicalMessage: `Non-retryable auth error (${statusCode}): ${message}`,
      originalError: error,
    }
  }

  // RLS errors without HTTP status code (e.g. thrown directly from PostgREST message)
  if (isRlsErrorMessage(normalized)) {
    return {
      category: 'rls_error',
      retriable: false,
      autoRepairable: false,
      userMessage: 'No se pudo acceder a tus datos en la nube. Puede ser un problema de permisos.',
      technicalMessage: `RLS/permission error on ${table ?? 'unknown'}: ${message}`,
      originalError: error,
    }
  }

  // Schema mismatch
  if (isSchemaErrorMessage(normalized)) {
    return {
      category: 'schema_mismatch',
      retriable: false,
      autoRepairable: false,
      userMessage: 'Hay un problema de configuración en el servidor. Contacta soporte.',
      technicalMessage: `Schema mismatch on ${table ?? 'unknown'}: ${message}`,
      originalError: error,
    }
  }

  // Duplicate key / conflict
  if (isDuplicateErrorMessage(normalized)) {
    return {
      category: 'duplicate_remote_profile',
      retriable: false,
      autoRepairable: table === 'athlete_profiles',
      userMessage: table === 'athlete_profiles'
        ? 'Reparando un perfil duplicado en la nube.'
        : 'Conflicto de datos duplicados.',
      technicalMessage: `Duplicate/conflict on ${table ?? 'unknown'}: ${message}`,
      originalError: error,
    }
  }

  // Validation / data errors (4xx that aren't auth)
  if (statusCode != null && statusCode >= 400 && statusCode < 500) {
    return {
      category: 'validation_error',
      retriable: false,
      autoRepairable: false,
      userMessage: 'Los datos enviados no son válidos. Intenta guardar de nuevo.',
      technicalMessage: `Validation error (${statusCode}) on ${table ?? 'unknown'}: ${message}`,
      originalError: error,
    }
  }

  // PGRST errors (PostgREST — infrastructure)
  if (isPgrstError(error)) {
    return {
      category: 'schema_mismatch',
      retriable: false,
      autoRepairable: false,
      userMessage: 'Hay un problema de configuración en el servidor.',
      technicalMessage: `PostgREST error on ${table ?? 'unknown'}: ${message}`,
      originalError: error,
    }
  }

  // Fallback
  return {
    category: 'unknown_error',
    retriable: true,
    autoRepairable: false,
    userMessage: 'No se pudo sincronizar. Reintentando.',
    technicalMessage: `Unknown sync error on ${table ?? 'unknown'}: ${message}`,
    originalError: error,
  }
}

// ─── Error message helpers ───────────────────────────────────────────────────

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
    if (typeof obj.details === 'string' && obj.details.trim()) return obj.details
  }
  return String(error)
}

function extractStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const obj = error as Record<string, unknown>
  if (typeof obj.status === 'number') return obj.status
  if (typeof obj.code === 'number') return obj.code
  return null
}

function isNetworkErrorMessage(normalized: string): boolean {
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('load failed') ||
    normalized.includes('offline') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  )
}

function isRetryableAuthMessage(normalized: string): boolean {
  if (normalized.includes('invalid api key') || normalized.includes('anon key')) {
    return false
  }
  return (
    normalized.includes('jwt') ||
    normalized.includes('token') ||
    normalized.includes('session') ||
    normalized.includes('expired') ||
    normalized.includes('auth')
  )
}

function isSchemaErrorMessage(normalized: string): boolean {
  return (
    normalized.includes('schema cache') ||
    normalized.includes("could not find the 'data' column") ||
    normalized.includes('column athlete_profiles.data does not exist') ||
    normalized.includes('invalid input syntax for type json') ||
    normalized.includes('undefined_table') ||
    (normalized.includes('relation') && normalized.includes('does not exist')) ||
    (normalized.includes('schema') && normalized.includes('not found')) ||
    (normalized.includes('column') && normalized.includes('does not exist'))
  )
}

function isRlsErrorMessage(normalized: string): boolean {
  return (
    normalized.includes('row-level security') ||
    normalized.includes('permission denied') ||
    normalized.includes('new row violates row-level security') ||
    normalized.includes('not authorized') ||
    (normalized.includes('permission') && normalized.includes('denied')) ||
    normalized.includes('does not have permission')
  )
}

function isDuplicateErrorMessage(normalized: string): boolean {
  return (
    normalized.includes('duplicate key') ||
    normalized.includes('unique constraint') ||
    normalized.includes('more than one row') ||
    normalized.includes('json object requested') ||
    normalized.includes('multiple rows returned') ||
    (normalized.includes('multiple') && normalized.includes('rows'))
  )
}

function isPgrstError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const obj = error as Record<string, unknown>
  if (typeof obj.code === 'string' && obj.code.startsWith('PGRST')) return true
  if (typeof obj.code === 'string' && obj.code === '42P01') return true
  return false
}

// ─── Legacy error helpers (backwards compatible) ─────────────────────────────

export function getSyncErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export function classifyAthleteProfileSyncError(error: unknown): string {
  const info = classifySyncError(error, 'athlete_profiles')
  return info.technicalMessage
}

// ─── Offline op types ────────────────────────────────────────────────────────

export interface OfflineOp {
  userId: string
  table: SupabaseTable
  action: 'upsert' | 'delete'
  payload: Record<string, unknown>
  enqueuedAt: number
  /** Number of times this op has been attempted and failed */
  retryCount?: number
  /** Error category from last failed attempt */
  lastErrorCategory?: SyncErrorCategory
}

/** Maximum retries per queued op before it's considered permanently failed */
export const MAX_RETRIES_PER_OP = 5

// ─── Athlete profile sync row ────────────────────────────────────────────────

export interface AthleteProfileSyncRow extends Record<string, unknown> {
  id: string
  user_id: string
  athlete_id: string | null
  coach_memory: string | null
  updated_at: number
  data: Record<string, unknown> | null
}

const ATHLETE_PROFILE_DELETED_FIELDS_KEY = '__deletedFields'
const ATHLETE_PROFILE_CLEAR_COACH_MEMORY_KEY = '__clearCoachMemory'
const ATHLETE_PROFILE_FULL_RESET_AT_KEY = '__fullResetAt'
const ATHLETE_PROFILE_RESETTABLE_FIELDS = [
  'onboardingDeferredAt',
  'name',
  'age',
  'weightKg',
  'primarySport',
  'secondarySports',
  'sportContext',
  'mainGoal',
  'secondaryGoal',
  'runningProfile',
  'strengthProfile',
  'recoveryProfile',
  'scheduleProfile',
  'nutritionProfile',
  'goalEvents',
  'macroPlan',
  'planWizardConfig',
] as const

/** Known columns in the remote athlete_profiles table */
const ATHLETE_PROFILE_REMOTE_COLUMNS = new Set([
  'id',
  'user_id',
  'athlete_id',
  'coach_memory',
  'updated_at',
  'data',
])

function getAthleteProfileRemoteId(userId: string): string {
  return `profile:${userId}`
}

export function athleteProfileToRow(profile: AthleteProfile, userId: string): Record<string, unknown> {
  const { id: _localId, coachMemory, updatedAt, ...rest } = profile
  void _localId
  const deletedFields: string[] = []
  const dataEntries: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) {
      deletedFields.push(key)
      continue
    }
    dataEntries[key] = value
  }

  if (deletedFields.length > 0) {
    dataEntries[ATHLETE_PROFILE_DELETED_FIELDS_KEY] = deletedFields
  }

  if (Object.prototype.hasOwnProperty.call(profile, 'coachMemory') && coachMemory === undefined) {
    dataEntries[ATHLETE_PROFILE_CLEAR_COACH_MEMORY_KEY] = true
  }

  return {
    id: getAthleteProfileRemoteId(userId),
    user_id: userId,
    athlete_id: profile.athleteId ?? null,
    coach_memory: coachMemory ?? null,
    updated_at: updatedAt,
    data: Object.keys(dataEntries).length > 0 ? dataEntries : null,
  }
}

export function rowToAthleteProfile(row: Record<string, unknown>): AthleteProfile {
  const { data } = parseAthleteProfileData(row.data as Record<string, unknown> | null)
  const athleteIdValue = row.athlete_id ?? data.athleteId
  const athleteId = typeof athleteIdValue === 'string' ? athleteIdValue : undefined
  return {
    id: ATHLETE_PROFILE_LOCAL_ID,
    coachMemory: (row.coach_memory as string | null) ?? undefined,
    updatedAt: row.updated_at as number,
    ...data,
    ...(athleteId !== undefined ? { athleteId } : {}),
  } as AthleteProfile
}

export function createAthleteProfileFullResetRow(userId: string, resetAt: number): AthleteProfileSyncRow {
  return normalizeAthleteProfilePayload({
    id: getAthleteProfileRemoteId(userId),
    user_id: userId,
    coach_memory: null,
    updated_at: resetAt,
    data: {
      [ATHLETE_PROFILE_FULL_RESET_AT_KEY]: resetAt,
      [ATHLETE_PROFILE_DELETED_FIELDS_KEY]: [...ATHLETE_PROFILE_RESETTABLE_FIELDS],
      [ATHLETE_PROFILE_CLEAR_COACH_MEMORY_KEY]: true,
    },
  })
}

export function getAthleteProfileFullResetAt(data: Record<string, unknown> | null | undefined): number | null {
  if (!isPlainObject(data)) return null
  const value = data[ATHLETE_PROFILE_FULL_RESET_AT_KEY]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isAthleteProfileFullResetRow(row: AthleteProfileSyncRow): boolean {
  const fullResetAt = getAthleteProfileFullResetAt(row.data)
  if (fullResetAt == null) return false

  const { data, clearCoachMemory } = parseAthleteProfileData(row.data)
  return Object.keys(data).length === 0 && clearCoachMemory && row.coach_memory == null
}

export function toAthleteProfileSyncRow(row: Record<string, unknown>): AthleteProfileSyncRow {
  const data = ((row.data as Record<string, unknown> | null) ?? null)
  return {
    id: String(row.id ?? ATHLETE_PROFILE_LOCAL_ID),
    user_id: String(row.user_id ?? ''),
    athlete_id: getAthleteProfileAthleteId(row, data),
    coach_memory: (row.coach_memory as string | null) ?? null,
    updated_at: Number(row.updated_at ?? 0),
    data,
  }
}

function getAthleteProfileAthleteId(
  row: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string | null {
  const value = row.athlete_id ?? row.athleteId ?? data?.athleteId
  return typeof value === 'string' ? value : null
}

/**
 * Normalize and validate an athlete profile payload before sending to Supabase.
 * - Strips unknown columns that don't exist in the remote schema
 * - Ensures types are correct (updated_at is number, data is object or null)
 * - Returns a clean row safe to upsert
 */
export function normalizeAthleteProfilePayload(
  row: Record<string, unknown>,
): AthleteProfileSyncRow {
  const normalized = toAthleteProfileSyncRow(row)

  // Strip any keys that aren't in the remote schema
  const cleaned: Record<string, unknown> = {}
  for (const key of ATHLETE_PROFILE_REMOTE_COLUMNS) {
    if (key in normalized) {
      cleaned[key] = normalized[key]
    }
  }

  // Validate updated_at is a finite number
  const updatedAt = Number(cleaned.updated_at ?? 0)
  cleaned.updated_at = Number.isFinite(updatedAt) ? updatedAt : Date.now()

  // Ensure data is JSON-serializable (or null)
  if (cleaned.data != null) {
    try {
      JSON.stringify(cleaned.data)
    } catch {
      cleaned.data = null
    }
  }

  return cleaned as unknown as AthleteProfileSyncRow
}

// ─── Scoring & canonical selection ───────────────────────────────────────────

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
  const { data } = parseAthleteProfileData(row.data)
  return scoreEntityData({
    coachMemory: row.coach_memory,
    updatedAt: row.updated_at,
    ...data,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return Object.values(value).some((item) => hasMeaningfulValue(item))
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  return false
}

function hasConfiguredSports(data: Record<string, unknown> | null): boolean {
  if (!data) return false

  const sportContext = isPlainObject(data.sportContext) ? data.sportContext : null
  const enabledSports = Array.isArray(sportContext?.enabledSports) ? sportContext.enabledSports : []
  const primarySport = typeof data.primarySport === 'string' ? data.primarySport.trim() : ''
  const secondarySports = Array.isArray(data.secondarySports) ? data.secondarySports : []

  return enabledSports.length > 0 || primarySport.length > 0 || secondarySports.length > 0
}

function parseAthleteProfileData(data: Record<string, unknown> | null): {
  data: Record<string, unknown>
  deletedFields: string[]
  clearCoachMemory: boolean
  fullResetAt: number | null
} {
  if (!isPlainObject(data)) {
    return { data: {}, deletedFields: [], clearCoachMemory: false, fullResetAt: null }
  }

  const deletedFields = Array.isArray(data[ATHLETE_PROFILE_DELETED_FIELDS_KEY])
    ? (data[ATHLETE_PROFILE_DELETED_FIELDS_KEY] as unknown[]).filter((item): item is string => typeof item === 'string')
    : []
  const clearCoachMemory = data[ATHLETE_PROFILE_CLEAR_COACH_MEMORY_KEY] === true
  const fullResetAt = getAthleteProfileFullResetAt(data)
  const cleanData = Object.fromEntries(
    Object.entries(data).filter(([key]) =>
      key !== ATHLETE_PROFILE_DELETED_FIELDS_KEY
      && key !== ATHLETE_PROFILE_CLEAR_COACH_MEMORY_KEY
      && key !== ATHLETE_PROFILE_FULL_RESET_AT_KEY,
    ),
  )

  return {
    data: cleanData,
    deletedFields,
    clearCoachMemory,
    fullResetAt,
  }
}

function serializeAthleteProfileData(
  data: Record<string, unknown>,
  deletedFields: string[],
  clearCoachMemory: boolean,
): Record<string, unknown> | null {
  const nextData: Record<string, unknown> = { ...data }
  const uniqueDeletedFields = [...new Set(deletedFields)].filter(Boolean)

  if (uniqueDeletedFields.length > 0) {
    nextData[ATHLETE_PROFILE_DELETED_FIELDS_KEY] = uniqueDeletedFields
  }
  if (clearCoachMemory) {
    nextData[ATHLETE_PROFILE_CLEAR_COACH_MEMORY_KEY] = true
  }

  return Object.keys(nextData).length > 0 ? nextData : null
}

function countMissingDurableKeys(
  baseData: Record<string, unknown> | null,
  incomingData: Record<string, unknown> | null,
  incomingDeletedFields: string[] = [],
): number {
  if (!baseData) return 0

  const durableKeys = [
    'name',
    'primarySport',
    'secondarySports',
    'sportContext',
    'mainGoal',
    'secondaryGoal',
    'runningProfile',
    'strengthProfile',
    'recoveryProfile',
    'scheduleProfile',
    'nutritionProfile',
    'goalEvents',
    'macroPlan',
    'planWizardConfig',
  ] as const

  return durableKeys.reduce((missing, key) => {
    if (!hasMeaningfulValue(baseData[key])) return missing
    if (incomingDeletedFields.includes(key)) return missing
    if (incomingData && key in incomingData) return missing
    return missing + 1
  }, 0)
}

function shouldHydrateFromRicherAthleteProfileRow(
  richerRow: AthleteProfileSyncRow,
  candidateRow: AthleteProfileSyncRow,
): boolean {
  const richerScore = scoreAthleteProfileRow(richerRow)
  const candidateScore = scoreAthleteProfileRow(candidateRow)
  if (richerScore <= candidateScore + 1) return false

  const richerData = richerRow.data
  const {
    data: normalizedRicherData,
  } = parseAthleteProfileData(richerData)
  const {
    data: normalizedCandidateData,
    deletedFields: candidateDeletedFields,
    clearCoachMemory: candidateClearsCoachMemory,
  } = parseAthleteProfileData(candidateRow.data)

  if (hasConfiguredSports(normalizedRicherData) && !hasConfiguredSports(normalizedCandidateData)) {
    return true
  }

  const richerName = typeof normalizedRicherData?.name === 'string' ? normalizedRicherData.name.trim() : ''
  const candidateNamePresent = ('name' in normalizedCandidateData) || candidateDeletedFields.includes('name')
  if (richerName.length > 0 && !candidateNamePresent) {
    return true
  }

  const richerCoachMemory = richerRow.coach_memory?.trim() ?? ''
  if (richerCoachMemory.length > 0 && candidateRow.coach_memory == null && !candidateClearsCoachMemory) {
    return true
  }

  return countMissingDurableKeys(normalizedRicherData, normalizedCandidateData, candidateDeletedFields) >= 1
}

function mergeDefinedObjects(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) {
      delete merged[key]
      continue
    }

    const existing = merged[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeDefinedObjects(existing, value)
      continue
    }

    merged[key] = value
  }

  return merged
}

export function mergeAthleteProfileRows(
  baseRow: AthleteProfileSyncRow,
  incomingRow: AthleteProfileSyncRow,
): AthleteProfileSyncRow {
  const {
    data: baseData,
    deletedFields: baseDeletedFields,
    clearCoachMemory: baseClearsCoachMemory,
  } = parseAthleteProfileData(baseRow.data)
  const {
    data: incomingData,
    deletedFields: incomingDeletedFields,
    clearCoachMemory: incomingClearsCoachMemory,
  } = parseAthleteProfileData(incomingRow.data)
  const mergedData = mergeDefinedObjects(baseData, incomingData)
  const restoredKeys = Object.keys(incomingData)
  const mergedDeletedFields = [...new Set([...baseDeletedFields, ...incomingDeletedFields])]
    .filter((key) => !restoredKeys.includes(key))

  for (const key of incomingDeletedFields) {
    delete mergedData[key]
  }

  const mergedCoachMemory = incomingClearsCoachMemory
    ? null
    : incomingRow.coach_memory ?? (baseClearsCoachMemory ? null : baseRow.coach_memory)

  return normalizeAthleteProfilePayload({
    id: incomingRow.id,
    user_id: incomingRow.user_id,
    athlete_id: incomingRow.athlete_id ?? baseRow.athlete_id,
    coach_memory: mergedCoachMemory,
    updated_at: incomingRow.updated_at,
    data: serializeAthleteProfileData(mergedData, mergedDeletedFields, incomingClearsCoachMemory),
  })
}

export function coalesceAthleteProfileRows(rows: AthleteProfileSyncRow[]): AthleteProfileSyncRow {
  const winner = normalizeAthleteProfilePayload(pickCanonicalAthleteProfileRow(rows))
  const richerRows = rows
    .map((row) => normalizeAthleteProfilePayload(row))
    .filter((row) => !athleteProfileRowsEqual(row, winner))
    .sort((a, b) => scoreAthleteProfileRow(b) - scoreAthleteProfileRow(a))

  return richerRows.reduce((current, row) => {
    if (!shouldHydrateFromRicherAthleteProfileRow(row, current)) {
      return current
    }
    return mergeAthleteProfileRows(row, current)
  }, winner)
}

export function athleteProfileRowsEqual(a: AthleteProfileSyncRow, b: AthleteProfileSyncRow): boolean {
  return JSON.stringify(normalizeAthleteProfilePayload(a)) === JSON.stringify(normalizeAthleteProfilePayload(b))
}

export function pickCanonicalAthleteProfileRow(rows: AthleteProfileSyncRow[]): AthleteProfileSyncRow {
  const sorted = [...rows].sort((a, b) => {
    if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at
    const scoreDiff = scoreAthleteProfileRow(b) - scoreAthleteProfileRow(a)
    if (scoreDiff !== 0) return scoreDiff
    if (a.id === ATHLETE_PROFILE_LOCAL_ID) return -1
    if (b.id === ATHLETE_PROFILE_LOCAL_ID) return 1
    return a.id.localeCompare(b.id)
  })
  return sorted[0]
}

// ─── Queue compaction ────────────────────────────────────────────────────────

export function compactQueue(queue: OfflineOp[], incoming: OfflineOp): OfflineOp[] {
  let preservedRetryCount = incoming.retryCount ?? 0
  let preservedLastErrorCategory = incoming.lastErrorCategory
  const next = queue.filter((queued) => {
    if (!shouldReplaceQueuedOp(queued, incoming)) return true

    preservedRetryCount = Math.max(preservedRetryCount, queued.retryCount ?? 0)
    preservedLastErrorCategory = incoming.lastErrorCategory ?? queued.lastErrorCategory
    return false
  })
  const compacted: OfflineOp = {
    ...incoming,
  }
  if (preservedRetryCount > 0) {
    compacted.retryCount = preservedRetryCount
  }
  if (preservedLastErrorCategory != null) {
    compacted.lastErrorCategory = preservedLastErrorCategory
  }
  next.push(compacted)
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
