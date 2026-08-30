import { describe, expect, it } from 'vitest'

import {
  findStrengthExerciseByName,
  normalizeStrengthExerciseKey,
  STRENGTH_EXERCISE_LIBRARY,
} from '../exerciseLibrary'
import {
  selectStrengthReplacement,
  type StrengthContext,
} from '../strengthSelector'

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

const candidatesForMovement = (name: string) => {
  const original = findStrengthExerciseByName(name)!
  return STRENGTH_EXERCISE_LIBRARY.filter((exercise) => exercise.movement === original.movement)
}

const originalWithAlternative = () =>
  STRENGTH_EXERCISE_LIBRARY.find((exercise) =>
    STRENGTH_EXERCISE_LIBRARY.some(
      (other) => other.movement === exercise.movement && other.id !== exercise.id,
    ),
  )!

describe('selectStrengthReplacement', () => {
  it('preserva el movement del ejercicio original', () => {
    const original = originalWithAlternative()
    const replacement = selectStrengthReplacement({
      originalName: original.name,
      context: context(),
      excludedKeys: new Set(),
      rotationIndex: 0,
      exerciseIndex: 1,
    })

    expect(findStrengthExerciseByName(replacement?.name ?? '')?.movement).toBe(original.movement)
  })

  it('no devuelve un ejercicio del conjunto excluido', () => {
    const original = originalWithAlternative()
    const candidates = candidatesForMovement(original.name)
    const expected = candidates.find((candidate) => candidate.id !== original.id)!
    const excludedKeys = new Set(
      candidates
        .filter((candidate) => candidate.id !== expected.id)
        .map((candidate) => normalizeStrengthExerciseKey(candidate.name)),
    )

    const replacement = selectStrengthReplacement({
      originalName: original.name,
      context: context(),
      excludedKeys,
      rotationIndex: 0,
      exerciseIndex: 1,
    })

    expect(replacement?.name).toBe(expected.name)
  })

  it('devuelve undefined cuando no queda candidato', () => {
    const original = originalWithAlternative()
    const excludedKeys = new Set(
      candidatesForMovement(original.name).map((candidate) => normalizeStrengthExerciseKey(candidate.name)),
    )

    const replacement = selectStrengthReplacement({
      originalName: original.name,
      context: context(),
      excludedKeys,
      rotationIndex: 0,
      exerciseIndex: 1,
    })

    expect(replacement).toBeUndefined()
  })

  it('no hereda targetPercent1RM de un original con referencia de 1RM', () => {
    const original = STRENGTH_EXERCISE_LIBRARY.find((exercise) =>
      exercise.loadReference?.selectorEligible && STRENGTH_EXERCISE_LIBRARY.some(
        (candidate) => candidate.movement === exercise.movement && !candidate.loadReference?.selectorEligible,
      ),
    )!
    const replacementDefinition = STRENGTH_EXERCISE_LIBRARY.find(
      (candidate) => candidate.movement === original.movement && !candidate.loadReference?.selectorEligible,
    )!
    const excludedKeys = new Set(
      candidatesForMovement(original.name)
        .filter((candidate) => candidate.id !== replacementDefinition.id)
        .map((candidate) => normalizeStrengthExerciseKey(candidate.name)),
    )

    const replacement = selectStrengthReplacement({
      originalName: original.name,
      context: context(),
      excludedKeys,
      rotationIndex: 0,
      exerciseIndex: 1,
    })

    expect(replacement?.name).toBe(replacementDefinition.name)
    expect(replacement?.targetPercent1RM).toBeUndefined()
  })

  it('es determinista: mismo rotationIndex da el mismo resultado', () => {
    const original = originalWithAlternative()
    const request = {
      originalName: original.name,
      context: context(),
      excludedKeys: new Set<string>(),
      rotationIndex: 1,
      exerciseIndex: 1,
    }

    expect(selectStrengthReplacement(request)?.name).toBe(selectStrengthReplacement(request)?.name)
  })
})
