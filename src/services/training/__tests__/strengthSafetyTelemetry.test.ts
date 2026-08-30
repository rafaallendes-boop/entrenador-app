import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StrengthConstraint } from '../../../types/strengthSafety'
import { prepareStrengthSession } from '../strengthSafetyFinalizer'
import type { StrengthContext } from '../strengthSelector'

const noAxial: StrengthConstraint[] = [{
  kind: 'load_pattern', pattern: 'axial_load', sources: ['restrictions', 'user_message'],
}]

function context(constraints: readonly StrengthConstraint[]): StrengthContext {
  return {
    fatigueLevel: 5,
    phase: 'build',
    recentExercises: [],
    goal: 'fuerza',
    sportProfile: 'sport_support',
    experienceLevel: 'intermediate',
    sessionDurationMin: 60,
    safetyConstraints: constraints,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('strength safety telemetry', () => {
  it('emite ids, ConstraintKey y sources, nunca texto médico', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const result = prepareStrengthSession({
      durationMin: 60,
      exercises: [
        { name: 'Sentadilla trasera con barra', sets: 3, reps: 5 },
        { name: 'Remo con pecho apoyado', sets: 3, reps: 10 },
      ],
    }, {
      constraints: noAxial,
      userMessageConstraints: [],
      userMessage: '',
      selectionContext: context(noAxial),
      structureOptions: { durationMin: 60 },
      supersetMode: 'off',
    })

    expect(result.status).toBe('ok')
    const serialized = info.mock.calls.map(([payload]) => String(payload)).join('\n')
    expect(serialized).toContain('strength.safety.exercise_replaced')
    expect(serialized).toContain('pattern:axial_load')
    expect(serialized).toContain('restrictions')
    expect(serialized).toContain('user_message')
    expect(serialized).not.toContain('dolor')
    expect(serialized).not.toContain('lesión')
  })

  it('instrumenta el bloqueo como salida propia', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const unresolved: StrengthConstraint[] = [{
      kind: 'unresolved_medical_restriction',
      reason: 'medical_marker_without_supported_constraint',
      sources: ['user_message'],
    }]

    const result = prepareStrengthSession({ durationMin: 60, exercises: [] }, {
      constraints: unresolved,
      userMessageConstraints: unresolved,
      userMessage: '',
      selectionContext: context(unresolved),
      structureOptions: { durationMin: 60 },
      supersetMode: 'off',
    })

    expect(result).toMatchObject({ status: 'blocked', reason: 'unresolved_medical_restriction' })
    expect(info.mock.calls.map(([payload]) => String(payload)).join('\n'))
      .toContain('strength.safety.blocked')
  })
})
