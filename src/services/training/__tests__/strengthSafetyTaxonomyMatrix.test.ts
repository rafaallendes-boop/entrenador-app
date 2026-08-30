import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import {
  isExerciseAllowed,
  resolveStrengthSafetyConstraints,
} from '../strengthSafetyConstraints'
import type {
  BodyRegion,
  LoadPattern,
  StrengthConstraint,
} from '../../../types/strengthSafety'

const byId = (id: string) => {
  const exercise = STRENGTH_EXERCISE_LIBRARY.find((entry) => entry.id === id)
  if (!exercise) throw new Error(`Ejercicio inexistente: ${id}`)
  return exercise
}

const region = (value: BodyRegion): StrengthConstraint[] => [{
  kind: 'region',
  // The constraint source is irrelevant for the policy, but keeping it real
  // ensures this matrix uses the public constraint contract.
  region: value,
  sources: ['current_injuries'],
}]

const pattern = (value: LoadPattern): StrengthConstraint[] => [{
  kind: 'load_pattern',
  pattern: value,
  sources: ['restrictions'],
}]

const REGION_MATRIX: ReadonlyArray<readonly [BodyRegion, string, string, string, string | undefined]> = [
  ['lumbar', 'deadlift', 'lat_pulldown', 'dolor lumbar', 'sin dolor lumbar'],
  ['thoracic', 'bent_over_row', 'lateral_band_walk', 'dolor dorsal', undefined],
  ['cervical', 'farmer_carry', 'lateral_band_walk', 'dolor cervical', undefined],
  ['trunk_core', 'dead_bug', 'lat_pulldown', 'molestia en zona media', undefined],
  ['chest_ribs', 'bench_press', 'lat_pulldown', 'dolor costal', undefined],
  ['pelvis_sacroiliac', 'farmer_carry', 'lat_pulldown', 'dolor sacroiliaco', undefined],
  ['shoulder', 'overhead_press', 'lateral_band_walk', 'dolor de hombro', 'sin dolor de hombro'],
  ['elbow', 'pull_up', 'lateral_band_walk', 'epicondilitis', undefined],
  ['wrist', 'front_squat', 'lateral_band_walk', 'dolor de muneca', undefined],
  ['hip', 'hip_thrust', 'bench_press', 'dolor de cadera', undefined],
  ['groin', 'copenhagen_side_plank', 'bench_press', 'pubalgia', undefined],
  ['hamstring', 'romanian_deadlift', 'bench_press', 'dolor isquiotibial', undefined],
  ['knee', 'back_squat', 'bench_press', 'tendinitis rotuliana', 'sin dolor de rodilla'],
  ['calf', 'pogo_jumps', 'bench_press', 'dolor de gemelo', undefined],
  ['achilles', 'depth_jump', 'bench_press', 'tendinitis de aquiles', undefined],
  ['ankle', 'box_jump', 'bench_press', 'esguince de tobillo', undefined],
  ['foot', 'pogo_jumps', 'bench_press', 'fascitis plantar', undefined],
]

const PATTERN_MATRIX: ReadonlyArray<readonly [LoadPattern, string, string, string]> = [
  ['axial_load', 'back_squat', 'lat_pulldown', 'sin carga axial'],
  ['loaded_hinge', 'deadlift', 'lat_pulldown', 'evitar peso muerto'],
  ['impact', 'box_jump', 'lat_pulldown', 'sin impacto'],
  ['deep_flexion', 'bodyweight_squat', 'lat_pulldown', 'evitar flexion profunda'],
  ['overhead', 'overhead_press', 'lat_pulldown', 'evitar trabajo sobre la cabeza'],
  ['rotation', 'cable_chop', 'lat_pulldown', 'evitar rotacion'],
  ['grip_demand', 'pull_up', 'bench_press', 'evitar demanda de agarre'],
]

describe('strength safety taxonomy matrix', () => {
  it.each(REGION_MATRIX)('enforces region %s', (value, excluded, kept, positive, negated) => {
    expect(isExerciseAllowed(byId(excluded), region(value))).toBe(false)
    expect(isExerciseAllowed(byId(kept), region(value))).toBe(true)

    const parsed = resolveStrengthSafetyConstraints({
      currentInjuries: positive,
      userMessages: [],
    })
    expect(parsed.some((constraint) => constraint.kind === 'region' && constraint.region === value)).toBe(true)

    if (negated) {
      expect(resolveStrengthSafetyConstraints({
        currentInjuries: negated,
        userMessages: [],
      })).toEqual([])
    }
  })

  it.each(PATTERN_MATRIX)('enforces pattern %s', (value, excluded, kept, positive) => {
    expect(isExerciseAllowed(byId(excluded), pattern(value))).toBe(false)
    expect(isExerciseAllowed(byId(kept), pattern(value))).toBe(true)

    const parsed = resolveStrengthSafetyConstraints({
      restrictions: positive,
      userMessages: [],
    })
    expect(parsed.some((constraint) => constraint.kind === 'load_pattern' && constraint.pattern === value)).toBe(true)
  })
})
