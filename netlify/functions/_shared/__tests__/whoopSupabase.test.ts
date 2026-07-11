import { beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  consumeOAuthState,
  deleteAllWhoopData,
  getConnection,
  READINESS_METRIC_CLEAR,
  resolveSelfAthleteId,
  upsertBiometricReadings,
  upsertConnection,
  upsertReadiness,
  upsertWorkouts,
  reconcileWorkouts,
} from '../whoopSupabase'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
type Predicate = (row: Row) => boolean
type RecordedCall = {
  tableName: string
  op: 'upsert' | 'delete'
  rows?: Row[]
  options?: unknown
  filters: unknown[][]
}

process.env['WHOOP_TOKEN_ENC_KEY'] = randomBytes(32).toString('base64')

function makeFakeDb(initial: Partial<Tables> = {}) {
  const tables: Tables = {
    athletes: [],
    athlete_memberships: [],
    whoop_oauth_states: [],
    whoop_connections: [],
    readiness_daily: [],
    biometric_readings: [],
    whoop_workouts: [],
    ...initial,
  }
  const upsertCalls: Array<{ tableName: string; rows: Row[] }> = []
  const calls: RecordedCall[] = []
  return {
    tables,
    upsertCalls,
    calls,
    from(tableName: string) {
      const api = {
        filters: [] as Predicate[],
        filterCalls: [] as unknown[][],
        pendingUpdate: null as Row | null,
        pendingDelete: false,
        select() {
          return api
        },
        eq(column: string, value: unknown) {
          api.filters.push((row: Row) => row[column] === value)
          api.filterCalls.push(['eq', column, value])
          return api
        },
        gte(column: string, value: unknown) {
          api.filters.push((row: Row) => String(row[column]) >= String(value))
          api.filterCalls.push(['gte', column, value])
          return api
        },
        not(column: string, operator: string, value: unknown) {
          const ids = operator === 'in'
            ? String(value).replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''))
            : []
          api.filters.push((row: Row) => !ids.includes(String(row[column])))
          api.filterCalls.push(['not', column, operator, value])
          return api
        },
        in(column: string, values: unknown[]) {
          api.filters.push((row: Row) => values.includes(row[column]))
          return api
        },
        then(onFulfilled: (value: { data: Row[]; error: null }) => unknown) {
          if (api.pendingUpdate) {
            tables[tableName] = tables[tableName].map((row) => (
              api.filters.every((filter) => filter(row)) ? { ...row, ...api.pendingUpdate } : row
            ))
            return Promise.resolve(onFulfilled({ data: [], error: null }))
          }
          if (api.pendingDelete) {
            calls.push({ tableName, op: 'delete', filters: [...api.filterCalls] })
            tables[tableName] = tables[tableName].filter((row) => !api.filters.every((filter) => filter(row)))
            return Promise.resolve(onFulfilled({ data: [], error: null }))
          }
          return Promise.resolve(onFulfilled({
            data: tables[tableName].filter((row) => api.filters.every((filter) => filter(row))),
            error: null,
          }))
        },
        async maybeSingle() {
          return { data: tables[tableName].find((row) => api.filters.every((filter) => filter(row))) ?? null, error: null }
        },
        async insert(row: Row) {
          tables[tableName].push(row)
          return { error: null }
        },
        async upsert(rowOrRows: Row | Row[], options?: unknown) {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          upsertCalls.push({ tableName, rows })
          calls.push({ tableName, op: 'upsert', rows, options, filters: [] })
          for (const row of rows) {
            const idx = tables[tableName].findIndex((existing) => {
              if (tableName === 'whoop_connections') return existing.user_id === row.user_id
              if (tableName === 'readiness_daily') {
                return existing.athlete_id === row.athlete_id
                  && existing.date === row.date
                  && existing.source === row.source
              }
              if (tableName === 'whoop_workouts') return existing.workout_id === row.workout_id
              return existing.id === row.id
            })
            if (idx >= 0) {
              tables[tableName][idx] = { ...tables[tableName][idx], ...row }
            } else {
              tables[tableName].push(row)
            }
          }
          return { error: null }
        },
        update(row: Row) {
          api.pendingUpdate = row
          return api
        },
        delete() {
          api.pendingDelete = true
          return api
        },
      }
      return api
    },
  }
}

describe('whoopSupabase', () => {
  beforeEach(() => {
    process.env['WHOOP_TOKEN_ENC_KEY'] = randomBytes(32).toString('base64')
  })

  it('upserts and reads back a connection, decrypting tokens', async () => {
    const db = makeFakeDb()
    await upsertConnection(db, {
      userId: 'u1',
      accessToken: 'acc',
      refreshToken: 'ref',
      keyVersion: 1,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    })

    const conn = await getConnection(db, 'u1')

    expect(conn?.accessToken).toBe('acc')
    expect(conn?.refreshToken).toBe('ref')
    expect(db.tables.whoop_connections[0].access_token).not.toBe('acc')
  })

  it('consumeOAuthState returns userId once then deletes', async () => {
    const db = makeFakeDb({
      whoop_oauth_states: [
        { state: 's1', user_id: 'u1', expires_at: new Date(Date.now() + 60_000).toISOString() },
      ],
    })

    const first = await consumeOAuthState(db, 's1')
    const second = await consumeOAuthState(db, 's1')

    expect(first?.userId).toBe('u1')
    expect(second).toBeNull()
  })

  it('consumeOAuthState returns null for expired state', async () => {
    const db = makeFakeDb({
      whoop_oauth_states: [
        { state: 's2', user_id: 'u1', expires_at: new Date(Date.now() - 1000).toISOString() },
      ],
    })

    await expect(consumeOAuthState(db, 's2')).resolves.toBeNull()
  })

  it('resolveSelfAthleteId returns the deterministic self athlete when present', async () => {
    const db = makeFakeDb({
      athletes: [{ id: 'ath_u1', owner_account_id: 'u1', status: 'active' }],
    })

    await expect(resolveSelfAthleteId(db, 'u1')).resolves.toBe('ath_u1')
  })

  it('resolveSelfAthleteId prefers the canonical self membership', async () => {
    const db = makeFakeDb({
      athlete_memberships: [{ athlete_id: 'ath_claimed', account_id: 'u1', role: 'self' }],
      athletes: [{ id: 'ath_u1', owner_account_id: 'u1', status: 'active' }],
    })

    await expect(resolveSelfAthleteId(db, 'u1')).resolves.toBe('ath_claimed')
  })

  it('batch upserts readiness rows', async () => {
    const db = makeFakeDb()

    await upsertReadiness(db, 'u1', 'ath_u1', [
      { date: '2026-06-21', recoveryScore: 28 },
      { date: '2026-06-22', recoveryScore: 66 },
    ])

    expect(db.upsertCalls.filter((call) => call.tableName === 'readiness_daily')).toHaveLength(1)
    expect(db.tables.readiness_daily).toHaveLength(2)
  })

  it('preserves existing readiness metrics when a partial WHOOP row arrives', async () => {
    const db = makeFakeDb({
      readiness_daily: [{
        user_id: 'u1',
        athlete_id: 'ath_u1',
        date: '2026-06-21',
        source: 'whoop',
        recovery_score: 74,
        hrv_ms: 55,
        sleep_hours: 7.5,
      }],
    })

    await upsertReadiness(db, 'u1', 'ath_u1', [
      { date: '2026-06-21', strain: 9.4 },
    ])

    expect(db.tables.readiness_daily[0]).toMatchObject({
      recovery_score: 74,
      hrv_ms: 55,
      sleep_hours: 7.5,
      strain: 9.4,
    })
  })

  it('clears existing readiness metrics when WHOOP marks them invalid', async () => {
    const db = makeFakeDb({
      readiness_daily: [{
        user_id: 'u1',
        athlete_id: 'ath_u1',
        date: '2026-06-21',
        source: 'whoop',
        recovery_score: 74,
        hrv_ms: 55,
        rhr_bpm: 48,
        sleep_hours: 7.5,
      }],
    })

    await upsertReadiness(db, 'u1', 'ath_u1', [
      {
        date: '2026-06-21',
        recoveryScore: READINESS_METRIC_CLEAR,
        hrvMs: READINESS_METRIC_CLEAR,
        rhrBpm: READINESS_METRIC_CLEAR,
      },
    ])

    expect(db.tables.readiness_daily[0]).toMatchObject({
      recovery_score: null,
      hrv_ms: null,
      rhr_bpm: null,
      sleep_hours: 7.5,
    })
  })

  it('skips all-null readiness rows when there is no existing data to clear', async () => {
    const db = makeFakeDb()

    await upsertReadiness(db, 'u1', 'ath_u1', [
      {
        date: '2026-06-21',
        recoveryScore: READINESS_METRIC_CLEAR,
        hrvMs: READINESS_METRIC_CLEAR,
        rhrBpm: READINESS_METRIC_CLEAR,
      },
    ])

    expect(db.upsertCalls.filter((call) => call.tableName === 'readiness_daily')).toHaveLength(0)
    expect(db.tables.readiness_daily).toHaveLength(0)
  })

  it('batch upserts biometric readings and dedupes duplicate ids', async () => {
    const db = makeFakeDb()

    await upsertBiometricReadings(db, 'u1', 'ath_u1', [
      { source: 'whoop', metric: 'recovery', value: 28, recordedAt: '2026-06-21T10:00:00Z', rawId: '101' },
      { source: 'whoop', metric: 'recovery', value: 29, recordedAt: '2026-06-21T10:00:00Z', rawId: '101' },
    ])

    expect(db.upsertCalls.filter((call) => call.tableName === 'biometric_readings')).toHaveLength(1)
    expect(db.tables.biometric_readings).toHaveLength(1)
    expect(db.tables.biometric_readings[0].value).toBe(29)
  })

  it('upserts snake_case workout rows keyed by workout_id', async () => {
    const db = makeFakeDb()
    await upsertWorkouts(db, 'u1', 'ath_u1', [{
      workoutId: 'w-1',
      date: '2026-07-09',
      sportName: 'running',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T14:45:00.000Z',
      durationMin: 45,
      strain: 10.5,
      avgHr: 140,
      maxHr: 172,
      distanceM: null,
      scoreState: 'SCORED',
    }])

    const call = db.calls.find((entry) => entry.tableName === 'whoop_workouts' && entry.op === 'upsert')
    expect(call?.options).toEqual({ onConflict: 'workout_id' })
    expect(call?.rows?.[0]).toMatchObject({
      workout_id: 'w-1',
      user_id: 'u1',
      athlete_id: 'ath_u1',
      sport_name: 'running',
      start_at: '2026-07-09T14:00:00.000Z',
      duration_min: 45,
      score_state: 'SCORED',
      updated_at: expect.any(Number),
    })
  })

  it('does not write workouts for an empty normalized collection', async () => {
    const db = makeFakeDb()
    await upsertWorkouts(db, 'u1', 'ath_u1', [])
    expect(db.calls.some((entry) => entry.tableName === 'whoop_workouts')).toBe(false)
  })

  it('reconciles by exact start_at instant and excludes fetched ids', async () => {
    const db = makeFakeDb()
    const windowStart = '2026-06-25T12:00:00.000Z'
    await reconcileWorkouts(db, 'u1', 'ath_u1', windowStart, ['w-1', 'w-2'])
    const call = db.calls.find((entry) => entry.tableName === 'whoop_workouts' && entry.op === 'delete')
    expect(call?.filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'u1'],
      ['eq', 'athlete_id', 'ath_u1'],
      ['gte', 'start_at', windowStart],
      ['not', 'workout_id', 'in', '("w-1","w-2")'],
    ]))
    expect(call?.filters.some((filter) => filter[1] === 'date')).toBe(false)
  })

  it('reconciles the whole window when fetched workouts are empty', async () => {
    const db = makeFakeDb()
    const windowStart = '2026-06-25T12:00:00.000Z'
    await reconcileWorkouts(db, 'u1', 'ath_u1', windowStart, [])
    const call = db.calls.find((entry) => entry.tableName === 'whoop_workouts' && entry.op === 'delete')
    expect(call?.filters).toContainEqual(['gte', 'start_at', windowStart])
    expect(call?.filters.some((filter) => filter[0] === 'not')).toBe(false)
  })

  it('tolerates missing WHOOP tables during full data deletion', async () => {
    const db = {
      from() {
        return {
          delete() {
            return {
              async eq() {
                return {
                  error: {
                    code: 'PGRST205',
                    message: "Could not find the table 'public.whoop_connections' in the schema cache",
                  },
                }
              },
            }
          },
        }
      },
    }

    await expect(deleteAllWhoopData(db, 'u1')).resolves.toBeUndefined()
  })

  it('includes workouts in full data deletion', async () => {
    const deletedTables: string[] = []
    const db = {
      from(tableName: string) {
        return {
          delete() {
            return {
              async eq() {
                deletedTables.push(tableName)
                return { error: null }
              },
            }
          },
        }
      },
    }

    await deleteAllWhoopData(db, 'u1')
    expect(deletedTables).toContain('whoop_workouts')
  })
})
