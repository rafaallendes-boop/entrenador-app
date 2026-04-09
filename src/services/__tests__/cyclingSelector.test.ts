import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { selectCyclingSession } from '../training/cyclingSelector'

function makeHistoricalSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-08',
    timeBlock: overrides.timeBlock ?? 'AM',
    type: overrides.type ?? 'cycling',
    status: overrides.status ?? 'completed',
    title: overrides.title ?? 'Sesion',
    durationMin: overrides.durationMin ?? 60,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  } as Session
}

describe('cyclingSelector', () => {
  it('selects low-intensity activation or recovery in taper with high fatigue', () => {
    const result = selectCyclingSession({
      phase: 'taper',
      role: 'primary',
      fatigueLevel: 8,
      sportProfile: 'cycling_primary',
      recentSessionIds: ['sweetspot_tempo', 'intervals_vo2'],
      competitionSoon: true,
      daysToCompetition: 2,
    })

    expect(['activation', 'recovery', 'z2_aerobic']).toContain(result.session.family)
  })

  it('stays conservative for support cycling in hybrid contexts', () => {
    const result = selectCyclingSession({
      phase: 'build',
      role: 'support',
      fatigueLevel: 5,
      sportProfile: 'hybrid',
      recentSessionIds: ['sweetspot_tempo'],
      historicalSessions: [
        makeHistoricalSession({ id: 's1', type: 'running', title: 'Running tempo' }),
        makeHistoricalSession({ id: 's2', type: 'strength', title: 'Fuerza' }),
        makeHistoricalSession({ id: 's3', type: 'squash', title: 'Squash training' }),
      ],
    })

    expect(['z2_aerobic', 'recovery', 'activation', 'sweetspot_tempo']).toContain(result.session.family)
    expect(result.session.intensity).not.toBe('high')
  })

  it('rotates away from repeated families when recent history is dense', () => {
    const result = selectCyclingSession({
      phase: 'build',
      role: 'primary',
      fatigueLevel: 4,
      sportProfile: 'cycling_primary',
      recentSessionIds: ['sweetspot_tempo', 'sweetspot_tempo', 'sweetspot_tempo'],
      historicalSessions: [
        makeHistoricalSession({ id: 'c1', type: 'cycling', title: 'Tempo continuo', objective: 'sweetspot tempo' }),
        makeHistoricalSession({ id: 'c2', type: 'cycling', title: 'Tempo continuo', objective: 'sweetspot tempo' }),
      ],
    })

    expect(result.progressionSummary.toLowerCase()).toContain('rot')
  })
})
