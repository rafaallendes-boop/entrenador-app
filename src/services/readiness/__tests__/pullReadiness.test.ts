import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const remoteRows: unknown[] = []
const tombstonedAthletes = vi.hoisted(() => new Set<string>())
let queryGate: Promise<void> | null = null
let activeQueries = 0

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
            try {
              if (queryGate) await queryGate
              return { data: remoteRows, error: null }
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
import { pullReadiness } from '../pullReadiness'

function remoteRow() {
  return {
    athlete_id: 'ath_1',
    date: '2026-07-14',
    recovery_score: 82,
    hrv_ms: 65,
    rhr_bpm: 48,
    strain: 4.2,
    sleep_hours: 7.5,
    sleep_performance: 91,
    source: 'whoop',
    updated_at: 100,
  }
}

describe('pullReadiness', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    remoteRows.length = 0
    tombstonedAthletes.clear()
    queryGate = null
    activeQueries = 0
    setSelfAthleteId('ath_1')
    setActiveAthleteId('ath_1')
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('hidrata readiness del atleta activo', async () => {
    remoteRows.push(remoteRow())
    await pullReadiness()
    expect(await db.readinessDaily.get('whoop:ath_1:2026-07-14')).toMatchObject({
      athleteId: 'ath_1',
      recoveryScore: 82,
      hrvMs: 65,
    })
  })

  it('no reintroduce readiness si el atleta queda tombstoned durante el fetch', async () => {
    let release!: () => void
    queryGate = new Promise<void>((resolve) => { release = resolve })
    remoteRows.push(remoteRow())

    const pulling = pullReadiness()
    await vi.waitFor(() => expect(activeQueries).toBe(1))
    tombstonedAthletes.add('ath_1')
    release()
    await pulling

    expect(await db.readinessDaily.count()).toBe(0)
  })
})
