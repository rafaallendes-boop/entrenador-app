import { describe, expect, it } from 'vitest'

import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'

describe('ExerciseDefinition schema Fase 2', () => {
  it('declares 1RM references for main barbell lifts', () => {
    expect(STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === 'back_squat')?.loadReference?.lift).toBe('squat')
    expect(STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === 'deadlift')?.loadReference?.lift).toBe('deadlift')
    expect(STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === 'bench_press')?.loadReference?.lift).toBe('benchPress')
    expect(STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === 'overhead_press')?.loadReference?.lift).toBe('overheadPress')
  })

  it('every exercise declares appropriateForPhases as a non-empty valid subset', () => {
    const validPhases = new Set(['base', 'build', 'peak', 'taper', 'transition', 'race'])

    for (const exercise of STRENGTH_EXERCISE_LIBRARY) {
      expect(exercise.appropriateForPhases, `exercise ${exercise.id}`).toBeDefined()
      expect(exercise.appropriateForPhases?.length).toBeGreaterThan(0)
      for (const phase of exercise.appropriateForPhases ?? []) {
        expect(validPhases.has(phase)).toBe(true)
      }
    }
  })

  it('main strength exercises declare a rotation group', () => {
    const mainLiftIds = ['back_squat', 'front_squat', 'romanian_deadlift', 'bench_press', 'overhead_press', 'pull_up']

    for (const id of mainLiftIds) {
      expect(STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === id)?.blockRotationGroup, id).toMatch(/^[ABC]$/)
    }
  })
})
