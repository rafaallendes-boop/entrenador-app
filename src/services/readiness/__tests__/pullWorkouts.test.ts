import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseRows: unknown[] = []
let supabaseError: { message: string } | null = null
let queryGate: Promise<void> | null = null
let activeQueries = 0
let maxActiveQueries = 0
const tombstonedAthletes = vi.hoisted(() => new Set<string>())

vi.mock('../../sync/athleteDeleteTombstones', () => ({
  hasAthleteDeleteTombstone: vi.fn((_userId: string, athleteId: string) => tombstonedAthletes.has(athleteId)),
  hasAthleteDeleteTombstoneForAthlete: vi.fn((athleteId: string) => tombstonedAthletes.has(athleteId)),
  rememberAthleteDeleteTombstone: vi.fn((_userId: string, athleteId: string) => {
    tombstonedAthletes.add(athleteId)
    return 'test-token'
  }),
}))

vi.mock('../../sync/syncSupabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: async () => {
            activeQueries += 1
            maxActiveQueries = Math.max(maxActiveQueries, activeQueries)
            try {
              if (queryGate) await queryGate
              return supabaseError
                ? { data: null, error: supabaseError }
                : { data: supabaseRows, error: null }
            } finally {
              activeQueries -= 1
            }
          },
        }),
      }),
    }),
  }),
}))

import { db } from '../../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import { pullWorkouts } from '../pullWorkouts'

function remoteRow(overrides: Record<string, unknown> = {}) {
  return {
    workout_id: 'w-1', athlete_id: 'ath_1', date: '2026-07-09', sport_name: 'squash',
    start_at: '2026-07-09T14:00:00.000Z', end_at: '2026-07-09T14:48:00.000Z',
    duration_min: 48, strain: 12.1, avg_hr: 150, max_hr: 178, distance_m: null,
    score_state: 'SCORED', updated_at: 1000, ...overrides,
  }
}

const localWorkout = {
  id: 'whoop:ath_1:w-1', workoutId: 'w-1', athleteId: 'ath_1', date: '2026-07-09',
  sportName: 'squash', startAt: '2026-07-09T14:00:00.000Z', endAt: '2026-07-09T14:48:00.000Z',
  durationMin: 48, scoreState: 'SCORED' as const, updatedAt: 500,
}

describe('pullWorkouts', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    supabaseRows.length = 0
    supabaseError = null
    queryGate = null
    activeQueries = 0
    maxActiveQueries = 0
    tombstonedAthletes.clear()
    setSelfAthleteId('ath_1')
    setActiveAthleteId('ath_1')
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('pulls remote workouts into Dexie', async () => {
    supabaseRows.push(remoteRow())
    await pullWorkouts()
    expect(await db.whoopWorkouts.get('whoop:ath_1:w-1')).toMatchObject({
      sportName: 'squash', durationMin: 48, strain: 12.1,
    })
  })

  it('preserves local autoComplete state on refresh', async () => {
    await db.whoopWorkouts.put({
      ...localWorkout,
      autoComplete: { status: 'completed', sessionId: 's-1', processedAt: 999 },
    })
    supabaseRows.push(remoteRow({ updated_at: 2000 }))
    await pullWorkouts()
    expect(await db.whoopWorkouts.get(localWorkout.id)).toMatchObject({
      updatedAt: 2000,
      autoComplete: { status: 'completed', sessionId: 's-1', processedAt: 999 },
    })
  })

  it('drops invalid rows', async () => {
    supabaseRows.push(remoteRow({ score_state: 'WEIRD' }), remoteRow({ workout_id: 'w-2', start_at: 'bad' }))
    await pullWorkouts()
    expect(await db.whoopWorkouts.count()).toBe(0)
  })

  it('rejects when Supabase returns an error', async () => {
    supabaseError = { message: 'network down' }
    await expect(pullWorkouts()).rejects.toThrow(/pullWorkouts/)
  })

  it('reconciles successful responses by removing missing in-window rows', async () => {
    const startAt = new Date().toISOString()
    await db.whoopWorkouts.put({ ...localWorkout, id: 'whoop:ath_1:stale', workoutId: 'stale', startAt })
    await pullWorkouts()
    expect(await db.whoopWorkouts.get('whoop:ath_1:stale')).toBeUndefined()
  })

  it('canonicalizes offset-form timestamps to Z', async () => {
    supabaseRows.push(remoteRow({
      start_at: '2026-07-09T14:00:00+00:00', end_at: '2026-07-09T14:48:00+00:00',
    }))
    await pullWorkouts()
    expect(await db.whoopWorkouts.get(localWorkout.id)).toMatchObject({
      startAt: '2026-07-09T14:00:00.000Z', endAt: '2026-07-09T14:48:00.000Z',
    })
  })

  it('rejects without writing if the athlete changes during the remote query', async () => {
    let release!: () => void
    queryGate = new Promise<void>((resolve) => { release = resolve })
    supabaseRows.push(remoteRow())
    const pulling = pullWorkouts()
    setActiveAthleteId('ath_2')
    release()
    await expect(pulling).rejects.toThrow(/athlete switched/)
    expect(await db.whoopWorkouts.count()).toBe(0)
  })

  it('no reintroduce workouts si el atleta queda tombstoned durante el fetch', async () => {
    let release!: () => void
    queryGate = new Promise<void>((resolve) => { release = resolve })
    supabaseRows.push(remoteRow())

    const pulling = pullWorkouts()
    await vi.waitFor(() => expect(activeQueries).toBe(1))
    tombstonedAthletes.add('ath_1')
    release()
    await pulling

    expect(await db.whoopWorkouts.count()).toBe(0)
  })

  it('serializes concurrent pulls so reconcile snapshots cannot race', async () => {
    let release!: () => void
    queryGate = new Promise<void>((resolve) => { release = resolve })
    supabaseRows.push(remoteRow())
    const first = pullWorkouts()
    const second = pullWorkouts()
    await vi.waitFor(() => expect(activeQueries).toBe(1))
    release()
    await Promise.all([first, second])
    expect(maxActiveQueries).toBe(1)
  })
})
