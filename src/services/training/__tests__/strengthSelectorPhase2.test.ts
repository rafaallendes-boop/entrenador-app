import { describe, expect, it } from 'vitest'

import { findStrengthExerciseByName, getExerciseById } from '../exerciseLibrary'
import { selectStarLift, selectStrengthSession, type StrengthContext } from '../strengthSelector'

function context(overrides: Partial<StrengthContext> = {}): StrengthContext {
  return {
    fatigueLevel: 2,
    phase: 'build',
    recentExercises: [],
    goal: 'squash competitivo',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'advanced',
    sessionDurationMin: 60,
    available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'],
    weekIndexInBlock: 0,
    safetyConstraints: [],
    ...overrides,
  }
}

function hasPattern(names: string[], predicate: (id: string | undefined) => boolean): boolean {
  return names.some((name) => predicate(findStrengthExerciseByName(name)?.id))
}

describe('selectStrengthSession Fase 2', () => {
  it('rotates star lifts across 3 consecutive build weeks', () => {
    const week0 = selectStrengthSession(context({ weekIndexInBlock: 0 }))
    const week1 = selectStrengthSession(context({ weekIndexInBlock: 1, recentExercises: week0.exercises.map((e) => e.name) }))
    const week2 = selectStrengthSession(context({ weekIndexInBlock: 2, recentExercises: [...week0.exercises, ...week1.exercises].map((e) => e.name) }))

    expect(new Set([week0.starLift?.name, week1.starLift?.name, week2.starLift?.name]).size).toBe(3)
  })

  it('builds a coherent 60-minute strength session', () => {
    const session = selectStrengthSession(context())
    const definitions = session.exercises.map((exercise) => findStrengthExerciseByName(exercise.name))
    const names = session.exercises.map((exercise) => exercise.name)

    expect(session.exercises.length).toBeGreaterThanOrEqual(5)
    expect(definitions.some((exercise) => exercise?.category === 'core')).toBe(true)
    expect(definitions.some((exercise) => exercise?.movement === 'squat' || exercise?.movement === 'hinge')).toBe(true)
    expect(definitions.some((exercise) => exercise?.movement === 'push' || exercise?.movement === 'pull')).toBe(true)
    expect(definitions.some((exercise) => exercise?.unilateral)).toBe(true)
    expect(hasPattern(names, (id) => id === 'back_squat' || id === 'front_squat' || id === 'romanian_deadlift' || id === 'deadlift')).toBe(true)
  })

  it('does not pick overhead press as star lift when overheadPress 1RM is absent', () => {
    const session = selectStrengthSession(context({
      available1RM: ['squat', 'deadlift', 'benchPress'],
      weekIndexInBlock: 1,
    }))

    expect(session.starLift?.name).not.toMatch(/overhead|press sobre cabeza|press militar|push press/i)
  })

  it('applies rpeAdjustment to selected exercises', () => {
    const fresh = selectStrengthSession(context({ rpeAdjustment: 0 }))
    const tired = selectStrengthSession(context({ rpeAdjustment: -1 }))

    expect(tired.exercises[0]?.targetRpe).toBeLessThan(fresh.exercises[0]?.targetRpe ?? 0)
  })

  it('exposes starLift metadata with 1RM progression', () => {
    const week0 = selectStrengthSession(context({ weekIndexInBlock: 0 }))
    const week1 = selectStrengthSession(context({ weekIndexInBlock: 1 }))

    expect(week0.starLift?.targetPercent1RM).toBe(75)
    expect(week1.starLift?.targetPercent1RM).toBe(80)
  })

  it('requires selectorEligible in addition to an available 1RM', () => {
    const eligibleWithoutFactor = getExerciseById('landmine_press')!
    const loadOnly = getExerciseById('half_kneeling_row')!

    expect(selectStarLift(eligibleWithoutFactor, context()).targetPercent1RM).toBe(75)
    expect(selectStarLift(loadOnly, context()).targetPercent1RM).toBeUndefined()
  })

  it('reduces target density when requireExtraRecovery is true', () => {
    const baseline = selectStrengthSession(context({ phase: 'peak', requireExtraRecovery: false }))
    const easier = selectStrengthSession(context({ phase: 'peak', requireExtraRecovery: true }))
    const fatigueRank = (name: string): number => {
      const fatigueCost = findStrengthExerciseByName(name)?.fatigueCost
      if (fatigueCost === 'high') return 3
      if (fatigueCost === 'medium') return 2
      if (fatigueCost === 'low') return 1
      return 0
    }

    expect(easier.exercises.length).toBeLessThanOrEqual(baseline.exercises.length)
    expect(Math.max(...easier.exercises.map((exercise) => fatigueRank(exercise.name)))).toBeLessThanOrEqual(
      Math.max(...baseline.exercises.map((exercise) => fatigueRank(exercise.name))),
    )
  })
})
