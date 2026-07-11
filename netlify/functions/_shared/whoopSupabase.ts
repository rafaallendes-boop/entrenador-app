import { CURRENT_KEY_VERSION, decryptTokenForVersion, encryptToken } from './tokenCrypto'

export interface WhoopDb {
  from(table: string): unknown
}

interface QueryResult<T = unknown> {
  data?: T | null
  error?: { message?: string } | null
}

interface QueryBuilder<T = unknown> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): QueryBuilder<T>
  eq(column: string, value: unknown): QueryBuilder<T>
  gte(column: string, value: unknown): QueryBuilder<T>
  not(column: string, operator: string, value: unknown): QueryBuilder<T>
  in?(column: string, values: unknown[]): QueryBuilder<T>
  lt?(column: string, value: unknown): QueryBuilder<T>
  maybeSingle(): Promise<QueryResult<T>>
  insert(row: unknown): Promise<QueryResult<T>>
  upsert(row: unknown, options?: unknown): Promise<QueryResult<T>>
  update(row: unknown): QueryBuilder<T>
  delete(): QueryBuilder<T>
}

export interface StoredConnection {
  userId: string
  accessToken: string
  refreshToken: string
  keyVersion: number
  expiresAt: string
  whoopUserId?: string | null
  scopes?: string | null
  lastSyncAt?: string | null
  lastManualSyncAt?: string | null
  lastSyncStatus?: 'ok' | 'error' | null
}

export const READINESS_METRIC_CLEAR = Symbol('readiness_metric_clear')

export type ReadinessMetricPatch = number | null | undefined | typeof READINESS_METRIC_CLEAR

export interface ReadinessRow {
  date: string
  recoveryScore?: ReadinessMetricPatch
  hrvMs?: ReadinessMetricPatch
  rhrBpm?: ReadinessMetricPatch
  strain?: ReadinessMetricPatch
  sleepHours?: ReadinessMetricPatch
  sleepPerformance?: ReadinessMetricPatch
}

export interface BiometricReadingRow {
  source: string
  metric: string
  value?: number | null
  recordedAt: string
  rawId?: string | null
}

export type WorkoutScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'

export interface WorkoutRow {
  workoutId: string
  date: string
  sportName: string
  startAt: string
  endAt: string
  durationMin: number
  strain: number | null
  avgHr: number | null
  maxHr: number | null
  distanceM: number | null
  scoreState: WorkoutScoreState
}

function table<T = unknown>(db: WhoopDb, name: string): QueryBuilder<T> {
  return db.from(name) as QueryBuilder<T>
}

function message(error: { message?: string } | null | undefined): string {
  return error?.message ?? 'unknown error'
}

function isMissingRelationError(error: { code?: unknown; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const normalized = (error?.message ?? '').toLowerCase()
  return code === '42P01'
    || code === 'PGRST205'
    || normalized.includes('could not find the table')
    || normalized.includes('relation') && normalized.includes('does not exist')
}

function optionalDbNumber(row: Record<string, unknown> | undefined, key: string): number | null {
  const value = row?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const READINESS_DB_METRIC_KEYS = [
  'recovery_score',
  'hrv_ms',
  'rhr_bpm',
  'strain',
  'sleep_hours',
  'sleep_performance',
] as const

function hasAnyDbReadinessMetric(row: Record<string, unknown> | undefined): boolean {
  return READINESS_DB_METRIC_KEYS.some((key) => optionalDbNumber(row, key) != null)
}

function mergeReadinessMetric(next: ReadinessMetricPatch, existing: number | null): number | null {
  if (next === READINESS_METRIC_CLEAR) return null
  return next == null ? existing : next
}

export async function insertOAuthState(
  db: WhoopDb,
  input: { state: string; userId: string; expiresAt: string },
): Promise<void> {
  const { error } = await table(db, 'whoop_oauth_states').insert({
    state: input.state,
    user_id: input.userId,
    expires_at: input.expiresAt,
  })
  if (error) throw new Error(`insertOAuthState: ${message(error)}`)
}

export async function consumeOAuthState(db: WhoopDb, state: string): Promise<{ userId: string } | null> {
  const { data, error } = await table<Record<string, unknown>>(db, 'whoop_oauth_states')
    .select('*')
    .eq('state', state)
    .maybeSingle()
  if (error) throw new Error(`consumeOAuthState: ${message(error)}`)
  if (!data) return null

  const { error: deleteError } = await table(db, 'whoop_oauth_states').delete().eq('state', state)
  if (deleteError) throw new Error(`consumeOAuthState delete: ${message(deleteError)}`)

  const expiresAt = typeof data.expires_at === 'string' ? data.expires_at : ''
  if (new Date(expiresAt).getTime() < Date.now()) return null
  return typeof data.user_id === 'string' ? { userId: data.user_id } : null
}

export async function deleteExpiredOAuthStates(db: WhoopDb, nowIso = new Date().toISOString()): Promise<void> {
  const query = table(db, 'whoop_oauth_states').delete()
  const result = query.lt ? await query.lt('expires_at', nowIso) : { error: null }
  if (result.error) throw new Error(`deleteExpiredOAuthStates: ${message(result.error)}`)
}

export async function upsertConnection(db: WhoopDb, conn: StoredConnection): Promise<void> {
  const { error } = await table(db, 'whoop_connections').upsert({
    user_id: conn.userId,
    access_token: encryptToken(conn.accessToken),
    refresh_token: encryptToken(conn.refreshToken),
    key_version: CURRENT_KEY_VERSION,
    expires_at: conn.expiresAt,
    whoop_user_id: conn.whoopUserId ?? null,
    scopes: conn.scopes ?? null,
  })
  if (error) throw new Error(`upsertConnection: ${message(error)}`)
}

export async function getConnection(db: WhoopDb, userId: string): Promise<StoredConnection | null> {
  const { data, error } = await table<Record<string, unknown>>(db, 'whoop_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`getConnection: ${message(error)}`)
  if (!data) return null

  const keyVersion = typeof data.key_version === 'number' ? data.key_version : CURRENT_KEY_VERSION
  return {
    userId: String(data.user_id),
    accessToken: decryptTokenForVersion(String(data.access_token), keyVersion),
    refreshToken: decryptTokenForVersion(String(data.refresh_token), keyVersion),
    keyVersion,
    expiresAt: String(data.expires_at),
    whoopUserId: typeof data.whoop_user_id === 'string' ? data.whoop_user_id : null,
    scopes: typeof data.scopes === 'string' ? data.scopes : null,
    lastSyncAt: typeof data.last_sync_at === 'string' ? data.last_sync_at : null,
    lastManualSyncAt: typeof data.last_manual_sync_at === 'string' ? data.last_manual_sync_at : null,
    lastSyncStatus: data.last_sync_status === 'ok' || data.last_sync_status === 'error' ? data.last_sync_status : null,
  }
}

export async function resolveSelfAthleteId(db: WhoopDb, userId: string): Promise<string | null> {
  try {
    const membership = await table<{ athlete_id?: string }>(db, 'athlete_memberships')
      .select('athlete_id')
      .eq('account_id', userId)
      .eq('role', 'self')
      .maybeSingle()
    if (!membership.error && membership.data?.athlete_id) return membership.data.athlete_id
  } catch {
    // Pre-SP1 environments fall back to the deterministic legacy athlete.
  }
  const { data, error } = await table<{ id?: string }>(db, 'athletes')
    .select('id')
    .eq('id', `ath_${userId}`)
    .maybeSingle()
  if (error) throw new Error(`resolveSelfAthleteId: ${message(error)}`)
  return data?.id ?? null
}

export async function setSyncResult(
  db: WhoopDb,
  userId: string,
  input: { lastSyncAt: string; lastManualSyncAt?: string; status: 'ok' | 'error' },
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_sync_at: input.lastSyncAt,
    last_sync_status: input.status,
  }
  if (input.lastManualSyncAt) patch.last_manual_sync_at = input.lastManualSyncAt

  const { error } = await table(db, 'whoop_connections').update(patch).eq('user_id', userId)
  if (error) throw new Error(`setSyncResult: ${message(error)}`)
}

export async function upsertReadiness(
  db: WhoopDb,
  userId: string,
  athleteId: string,
  rows: ReadinessRow[],
): Promise<void> {
  if (rows.length === 0) return
  const updatedAt = Date.now()
  const dates = [...new Set(rows.map((row) => row.date))]
  const existingByDate = new Map<string, Record<string, unknown>>()
  const existingQuery = table<Record<string, unknown>[]>(db, 'readiness_daily')
    .select('date,recovery_score,hrv_ms,rhr_bpm,strain,sleep_hours,sleep_performance')
    .eq('user_id', userId)
    .eq('athlete_id', athleteId)
    .eq('source', 'whoop')
  if (!existingQuery.in) throw new Error('upsertReadiness existing: query builder does not support in()')
  const existingResult = await existingQuery.in('date', dates)
  if (existingResult.error) throw new Error(`upsertReadiness existing: ${message(existingResult.error)}`)
  for (const existing of existingResult.data ?? []) {
    if (typeof existing.date === 'string') existingByDate.set(existing.date, existing)
  }

  const payload = rows.flatMap((row) => {
    const existing = existingByDate.get(row.date)
    const merged = {
      user_id: userId,
      athlete_id: athleteId,
      date: row.date,
      recovery_score: mergeReadinessMetric(row.recoveryScore, optionalDbNumber(existing, 'recovery_score')),
      hrv_ms: mergeReadinessMetric(row.hrvMs, optionalDbNumber(existing, 'hrv_ms')),
      rhr_bpm: mergeReadinessMetric(row.rhrBpm, optionalDbNumber(existing, 'rhr_bpm')),
      strain: mergeReadinessMetric(row.strain, optionalDbNumber(existing, 'strain')),
      sleep_hours: mergeReadinessMetric(row.sleepHours, optionalDbNumber(existing, 'sleep_hours')),
      sleep_performance: mergeReadinessMetric(row.sleepPerformance, optionalDbNumber(existing, 'sleep_performance')),
      source: 'whoop',
      updated_at: updatedAt,
    }

    return hasAnyDbReadinessMetric(merged) || hasAnyDbReadinessMetric(existing) ? [merged] : []
  })
  if (payload.length === 0) return

  const { error } = await table(db, 'readiness_daily').upsert(payload, { onConflict: 'athlete_id,date,source' })
  if (error) throw new Error(`upsertReadiness: ${message(error)}`)
}

export async function upsertBiometricReadings(
  db: WhoopDb,
  userId: string,
  athleteId: string,
  rows: BiometricReadingRow[],
): Promise<void> {
  if (rows.length === 0) return
  const payloadById = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const id = `whoop:${athleteId}:${row.metric}:${row.rawId ?? row.recordedAt}`
    payloadById.set(id, {
      id,
      user_id: userId,
      athlete_id: athleteId,
      source: row.source,
      metric: row.metric,
      value: row.value ?? null,
      recorded_at: row.recordedAt,
      raw_id: row.rawId ?? null,
    })
  }
  const { error } = await table(db, 'biometric_readings').upsert([...payloadById.values()], { onConflict: 'id' })
  if (error) throw new Error(`upsertBiometricReadings: ${message(error)}`)
}

export async function upsertWorkouts(
  db: WhoopDb,
  userId: string,
  athleteId: string,
  rows: WorkoutRow[],
): Promise<void> {
  if (rows.length === 0) return
  const updatedAt = Date.now()
  const payload = rows.map((row) => ({
    workout_id: row.workoutId,
    user_id: userId,
    athlete_id: athleteId,
    date: row.date,
    sport_name: row.sportName,
    start_at: row.startAt,
    end_at: row.endAt,
    duration_min: row.durationMin,
    strain: row.strain,
    avg_hr: row.avgHr,
    max_hr: row.maxHr,
    distance_m: row.distanceM,
    score_state: row.scoreState,
    updated_at: updatedAt,
  }))
  const { error } = await table(db, 'whoop_workouts').upsert(payload, { onConflict: 'workout_id' })
  if (error) throw new Error(`upsertWorkouts: ${message(error)}`)
}

export async function reconcileWorkouts(
  db: WhoopDb,
  userId: string,
  athleteId: string,
  windowStartIso: string,
  keepWorkoutIds: string[],
): Promise<void> {
  let query = table(db, 'whoop_workouts')
    .delete()
    .eq('user_id', userId)
    .eq('athlete_id', athleteId)
    .gte('start_at', windowStartIso)
  if (keepWorkoutIds.length > 0) {
    const list = keepWorkoutIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')
    query = query.not('workout_id', 'in', `(${list})`)
  }
  const { error } = await query
  if (error) throw new Error(`reconcileWorkouts: ${message(error)}`)
}

export async function deleteAllWhoopData(db: WhoopDb, userId: string): Promise<void> {
  for (const name of ['whoop_oauth_states', 'biometric_readings', 'readiness_daily', 'whoop_workouts', 'whoop_connections']) {
    const { error } = await table(db, name).delete().eq('user_id', userId)
    if (error && !isMissingRelationError(error)) {
      throw new Error(`deleteAllWhoopData ${name}: ${message(error)}`)
    }
  }
}
