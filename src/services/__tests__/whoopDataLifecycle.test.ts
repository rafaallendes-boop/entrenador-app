import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { clearAllLocalAppData } from '../appMaintenance'
import { exportAppData, importAppDataFromFile } from '../dataExport'
import { clearLocalWhoopWorkouts } from '../readiness/localReadiness'

const seedWorkout = {
  id: 'whoop:ath_1:w-1',
  workoutId: 'w-1',
  athleteId: 'ath_1',
  date: '2026-07-09',
  sportName: 'squash',
  startAt: '2026-07-09T14:00:00.000Z',
  endAt: '2026-07-09T14:48:00.000Z',
  durationMin: 48,
  scoreState: 'SCORED' as const,
  updatedAt: 1,
}

function installLocalStorage() {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return state.size
      },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => {
        state.set(key, value)
      },
      removeItem: (key: string) => {
        state.delete(key)
      },
      clear: () => {
        state.clear()
      },
    },
  })
}

describe('whoop data lifecycle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    installLocalStorage()
    await db.readinessDaily.put({
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      source: 'whoop',
      updatedAt: 1,
    })
  })

  afterEach(() => {
    db.close()
    delete (globalThis as { localStorage?: Storage }).localStorage
  })

  it('clearAllLocalAppData removes readinessDaily', async () => {
    await clearAllLocalAppData()
    expect(await db.readinessDaily.count()).toBe(0)
  })

  it('exports readinessDaily in the app backup', async () => {
    const { json } = await exportAppData()
    const backup = JSON.parse(json) as { tables: { readinessDaily: unknown[] } }

    expect(backup.tables.readinessDaily).toHaveLength(1)
    expect(backup.tables.readinessDaily[0]).toMatchObject({
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      source: 'whoop',
    })
  })

  it('restores readinessDaily from an app backup', async () => {
    const { json } = await exportAppData()
    await db.readinessDaily.clear()

    const file = new File([json], 'backup.json', { type: 'application/json' })
    await importAppDataFromFile(file, 'merge')

    const row = await db.readinessDaily.get('whoop:ath_u1:2026-06-21')
    expect(row?.source).toBe('whoop')
  })

  it('includes whoopWorkouts in export and restores it on replace import', async () => {
    await db.whoopWorkouts.put(seedWorkout)
    const { json } = await exportAppData()
    const backup = JSON.parse(json) as { tables: { whoopWorkouts: unknown[] } }
    expect(backup.tables.whoopWorkouts).toHaveLength(1)

    await db.whoopWorkouts.clear()
    await importAppDataFromFile(new File([json], 'backup.json', { type: 'application/json' }), 'replace')
    expect(await db.whoopWorkouts.count()).toBe(1)
  })

  it('clears whoopWorkouts on full local wipe', async () => {
    await db.whoopWorkouts.put(seedWorkout)
    await clearAllLocalAppData()
    expect(await db.whoopWorkouts.count()).toBe(0)
  })

  it('preserves session.autoCompletion across export and import', async () => {
    await db.sessions.put({
      id: 's-1', athleteId: 'ath_1', date: '2026-07-09', timeBlock: 'AM', type: 'squash',
      status: 'completed', title: 'Sesion', durationMin: 60, createdAt: 1, updatedAt: 1,
      autoCompletion: {
        source: 'whoop_workout', workoutId: 'w-1', completedAt: '2026-07-09T15:00:00.000Z',
      },
    })
    const { json } = await exportAppData()
    await db.sessions.clear()
    await importAppDataFromFile(new File([json], 'backup.json', { type: 'application/json' }), 'replace')
    expect((await db.sessions.get('s-1'))?.autoCompletion).toEqual({
      source: 'whoop_workout', workoutId: 'w-1', completedAt: '2026-07-09T15:00:00.000Z',
    })
  })

  it('clearLocalWhoopWorkouts removes only the given athlete rows', async () => {
    await db.whoopWorkouts.bulkPut([
      seedWorkout,
      { ...seedWorkout, id: 'whoop:ath_2:w-2', workoutId: 'w-2', athleteId: 'ath_2' },
    ])
    await clearLocalWhoopWorkouts('ath_1')
    expect(await db.whoopWorkouts.toArray()).toEqual([
      expect.objectContaining({ athleteId: 'ath_2' }),
    ])
  })

  it('merge import keeps newer local workout data and local terminal telemetry', async () => {
    await db.whoopWorkouts.put(seedWorkout)
    const { json } = await exportAppData()
    await db.whoopWorkouts.put({
      ...seedWorkout,
      sportName: 'running',
      updatedAt: 2,
      autoComplete: { status: 'completed', sessionId: 's-local', processedAt: 3 },
    })

    await importAppDataFromFile(new File([json], 'backup.json', { type: 'application/json' }), 'merge')

    expect(await db.whoopWorkouts.get(seedWorkout.id)).toMatchObject({
      sportName: 'running',
      updatedAt: 2,
      autoComplete: { status: 'completed', sessionId: 's-local', processedAt: 3 },
    })
  })
})
