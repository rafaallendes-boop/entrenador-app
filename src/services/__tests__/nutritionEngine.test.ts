import { describe, expect, it } from 'vitest'

import type { AthleteProfile, Session } from '../../types'
import { classifyDayLoad, getDayNutrition } from '../nutritionEngine'

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-11',
    timeBlock: overrides.timeBlock ?? 'AM',
    type: overrides.type ?? 'running',
    status: overrides.status ?? 'planned',
    title: overrides.title ?? 'Sesion',
    durationMin: overrides.durationMin ?? 60,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  }
}

describe('nutritionEngine', () => {
  it('classifies cycling long rides as long_run using sessionFamily', () => {
    const loadType = classifyDayLoad([
      makeSession({
        type: 'cycling',
        cyclingDetails: {
          sessionCategory: 'primary build',
          sessionFamily: 'long_ride',
          targetStructure: 'Rodaje largo continuo',
        },
      }),
    ])

    expect(loadType).toBe('long_run')
  })

  it('calculates avgRpe from explicit numeric values including zero without double-filtering', () => {
    const loadType = classifyDayLoad([
      makeSession({ id: 'a', durationMin: 20, rpe: 0 }),
      makeSession({ id: 'b', durationMin: 20 }),
    ])

    expect(loadType).toBe('medium')
  })

  it('personalizes protein target by profile-specific factor instead of fixed 2.0 in consumers', () => {
    const profile: AthleteProfile = {
      id: 'athlete-1',
      updatedAt: 1,
      weightKg: 80,
    }

    const rec = getDayNutrition([
      makeSession({ type: 'running', runningDetails: { runningType: 'tempo' }, durationMin: 45, rpe: 6 }),
    ], profile)

    expect(rec.loadType).toBe('medium')
    expect(rec.proteinTarget).toBe('~144g proteína')
  })
})
