import { describe, expect, it } from 'vitest'
import {
  EXERCISE_LIBRARY,
  getExerciseById,
  type StrengthLoadReference,
} from '../exerciseLibrary'

/** Ledger independiente de las dos fuentes retiradas durante la migración. */
const EXPECTED_LOAD_REFERENCES = {
  back_squat: { lift: 'squat', factor: 1, selectorEligible: true },
  front_squat: { lift: 'squat', factor: 0.85, selectorEligible: true },
  goblet_squat: { lift: 'squat', factor: 0.3, selectorEligible: true },
  bulgarian_split_squat: { lift: 'squat', factor: 0.35, selectorEligible: false },
  walking_lunge: { lift: 'squat', factor: 0.4, selectorEligible: false },
  hip_thrust: { lift: 'squat', factor: 1.2, selectorEligible: false },
  deadlift: { lift: 'deadlift', factor: 1, selectorEligible: true },
  sumo_deadlift: { lift: 'deadlift', factor: 0.95, selectorEligible: true },
  romanian_deadlift: { lift: 'deadlift', factor: 0.8, selectorEligible: true },
  trap_bar_deadlift: { lift: 'deadlift', factor: 0.95, selectorEligible: true },
  bench_press: { lift: 'benchPress', factor: 1, selectorEligible: true },
  incline_bench_press: { lift: 'benchPress', factor: 0.85, selectorEligible: true },
  close_grip_bench_press: { lift: 'benchPress', factor: 0.9, selectorEligible: true },
  incline_dumbbell_press: { lift: 'benchPress', factor: 0.85, selectorEligible: true },
  overhead_press: { lift: 'overheadPress', factor: 1, selectorEligible: true },
  landmine_press: { lift: 'overheadPress', selectorEligible: true },
  push_press: { lift: 'overheadPress', factor: 1.15, selectorEligible: true },
  barbell_jump_squat: { lift: 'squat', factor: 1, selectorEligible: false },
  bb_reverse_lunge: { lift: 'squat', factor: 0.4, selectorEligible: false },
  bb_side_lunge: { lift: 'squat', factor: 0.4, selectorEligible: false },
  single_leg_hip_thrust: { lift: 'squat', factor: 1.2, selectorEligible: false },
  z_press: { lift: 'overheadPress', factor: 0.65, selectorEligible: true },
  half_kneeling_row: { lift: 'benchPress', factor: 0.35, selectorEligible: false },
  jump_squat: { lift: 'squat', factor: 1, selectorEligible: false },
  split_squat: { lift: 'squat', factor: 0.4, selectorEligible: false },
} satisfies Record<string, StrengthLoadReference>

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
    expect(exercise?.loadReference?.lift).toBe(ref)
    expect(exercise?.loadReference?.selectorEligible).toBe(true)
  })

  it('declares exactly the migrated load-reference sets', () => {
    const actual = Object.fromEntries(
      EXERCISE_LIBRARY
        .filter((exercise) => exercise.loadReference != null)
        .map((exercise) => [exercise.id, exercise.loadReference]),
    )

    expect(actual).toEqual(EXPECTED_LOAD_REFERENCES)
  })

  it('keeps 1RM references on compatible movement patterns', () => {
    const patternMap: Record<string, string[]> = {
      squat: ['squat'],
      deadlift: ['hinge'],
      benchPress: ['push'],
      overheadPress: ['push'],
    }

    for (const exercise of EXERCISE_LIBRARY) {
      if (!exercise.loadReference?.selectorEligible) continue
      expect(patternMap[exercise.loadReference.lift]).toContain(exercise.movement)
    }
  })

  it('keeps bodyweight squats and pull-ups outside numeric load derivation', () => {
    for (const id of ['bodyweight_squat', 'pull_up', 'assisted_pull_up', 'mixed_grip_pull_up', 'weighted_pull_up']) {
      expect(getExerciseById(id)?.loadReference, id).toBeUndefined()
    }
  })
})
