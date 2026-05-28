import { describe, expect, it } from 'vitest'
import { findStrengthExerciseByName } from '../../training/exerciseLibrary'
import { selectStrengthSession, type StrengthContext } from '../../training/strengthSelector'

function context(phase: StrengthContext['phase'], weekIndexInBlock: number, recentExercises: string[] = []): StrengthContext {
  return {
    phase,
    weekIndexInBlock,
    recentExercises,
    fatigueLevel: 2,
    goal: 'squash competitivo',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'advanced',
    sessionDurationMin: 60,
    available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'],
  }
}

function ids(session: ReturnType<typeof selectStrengthSession>): string[] {
  return session.exercises.map((exercise) => findStrengthExerciseByName(exercise.name)?.id ?? exercise.name)
}

function intersect(a: string[], b: string[]): string[] {
  const bSet = new Set(b)
  return a.filter((id) => bSet.has(id))
}

describe('Cross-week strength duplicates within block', () => {
  it('build block weeks 1-3 share at most 2 exercise ids', () => {
    const w1 = selectStrengthSession(context('build', 0))
    const w2 = selectStrengthSession(context('build', 1, ids(w1)))
    const w3 = selectStrengthSession(context('build', 2, [...ids(w1), ...ids(w2)]))

    expect(intersect(ids(w1), ids(w2)).length).toBeLessThan(3)
    expect(intersect(ids(w2), ids(w3)).length).toBeLessThan(3)
  })

  it('peak block weeks 1-3 also rotate', () => {
    const w1 = selectStrengthSession(context('peak', 0))
    const w2 = selectStrengthSession(context('peak', 1, ids(w1)))
    const w3 = selectStrengthSession(context('peak', 2, [...ids(w1), ...ids(w2)]))

    expect(intersect(ids(w1), ids(w2)).length).toBeLessThan(3)
    expect(intersect(ids(w2), ids(w3)).length).toBeLessThan(3)
  })
})
