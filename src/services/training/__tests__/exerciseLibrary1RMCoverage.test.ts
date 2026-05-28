import { describe, expect, it } from 'vitest'
import { EXERCISE_LIBRARY, getExerciseById } from '../exerciseLibrary'

const REQUIRED = [
  ['incline_bench_press', 'benchPress'],
  ['close_grip_bench_press', 'benchPress'],
  ['sumo_deadlift', 'deadlift'],
  ['landmine_press', 'overheadPress'],
] as const

describe('Exercise library 1RM coverage', () => {
  it.each(REQUIRED)('%s exists and references %s', (id, ref) => {
    const exercise = getExerciseById(id)
    expect(exercise).toBeDefined()
    expect(exercise?.has1RMReference).toBe(ref)
  })

  it('has at least 15 exercises with has1RMReference', () => {
    const withRef = EXERCISE_LIBRARY.filter((exercise) => exercise.has1RMReference != null)
    expect(withRef.length).toBeGreaterThanOrEqual(15)
  })

  it('keeps 1RM references on compatible movement patterns', () => {
    const patternMap: Record<string, string[]> = {
      squat: ['squat'],
      deadlift: ['hinge'],
      benchPress: ['push'],
      overheadPress: ['push'],
    }

    for (const exercise of EXERCISE_LIBRARY) {
      if (!exercise.has1RMReference) continue
      expect(patternMap[exercise.has1RMReference]).toContain(exercise.movement)
    }
  })
})
