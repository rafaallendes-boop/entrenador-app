import { describe, expect, it } from 'vitest'
import type { CoachExerciseProposal } from '../../../types'
import type { StrengthConstraint } from '../../../types/strengthSafety'
import { resolveStrengthExercise } from '../exerciseLibrary'
import { finalizeStrengthExercisesForRestrictions, prepareStrengthSession } from '../strengthSafetyFinalizer'
import type { StrengthContext } from '../strengthSelector'
import { buildStrengthSafetyContext } from '../strengthSafetySurface'

const lumbar: StrengthConstraint[] = [
  { kind: 'region', region: 'lumbar', sources: ['current_injuries'] },
]
const unresolved: StrengthConstraint[] = [{
  kind: 'unresolved_medical_restriction',
  reason: 'structured_priority_without_detail',
  sources: ['training_priority'],
}]

function exercise(name: string, extra: Partial<CoachExerciseProposal> = {}): CoachExerciseProposal {
  return { name, sets: 3, reps: 8, ...extra }
}

function context(constraints: readonly StrengthConstraint[], durationMin = 60): StrengthContext {
  return {
    fatigueLevel: 5,
    phase: 'build',
    recentExercises: [],
    goal: 'fuerza',
    sportProfile: 'sport_support',
    experienceLevel: 'intermediate',
    sessionDurationMin: durationMin,
    safetyConstraints: constraints,
  }
}

function finalize(
  exercises: CoachExerciseProposal[],
  constraints: readonly StrengthConstraint[],
  userMessage = '',
) {
  return finalizeStrengthExercisesForRestrictions({
    exercises,
    constraints,
    durationMin: 60,
    sessionType: 'strength',
    selectionContext: context(constraints),
    userMessage,
    supersetMode: 'off',
  })
}

describe('strength safety finalizer', () => {
  it('blocks an empty preserved-density session even without restrictions', () => {
    const result = finalizeStrengthExercisesForRestrictions({
      exercises: [],
      constraints: [],
      durationMin: 60,
      sessionType: 'strength',
      selectionContext: context([]),
      userMessage: '',
      supersetMode: 'off',
      densityCompletion: 'preserve',
    })

    expect(result).toEqual({
      status: 'blocked',
      reason: 'insufficient_safe_pool',
      removed: [],
    })
  })

  it('does not skip identity and viability validation when constraints are empty', () => {
    const result = finalize([exercise('Ejercicio inventado xyz')], [])
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.removed).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: 'unresolvable_identity' }),
      ]))
      expect(result.exercises.every((item) => resolveStrengthExercise(item)?.definition)).toBe(true)
    }
  })

  it('blocks unresolved medical restrictions before it changes any exercise', () => {
    const result = finalize([exercise('Press de banca')], unresolved)
    expect(result).toEqual({
      status: 'blocked',
      reason: 'unresolved_medical_restriction',
      removed: [],
    })
  })

  it('removes or replaces lumbar-loaded exercises and revalidates all survivors', () => {
    const result = finalize([
      exercise('Peso muerto'),
      exercise('Remo con pecho apoyado'),
    ], lumbar)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    expect(result.removed.length + result.replaced.length).toBeGreaterThan(0)
    for (const item of result.exercises) {
      const definition = resolveStrengthExercise(item)?.definition
      expect(definition, item.name).toBeDefined()
      expect(definition!.safety.loadsRegions).not.toContain('lumbar')
    }
  })

  it('does not use a stale permissive selection context for replacements or density', () => {
    const result = finalizeStrengthExercisesForRestrictions({
      exercises: [exercise('Peso muerto'), exercise('Remo con pecho apoyado')],
      constraints: lumbar,
      durationMin: 60,
      sessionType: 'strength',
      // Simulates an integration bug at a caller boundary. The finalizer's
      // explicit constraints must still govern the pool, not this stale [] set.
      selectionContext: context([]),
      userMessage: '',
      supersetMode: 'off',
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      for (const item of result.exercises) {
        expect(resolveStrengthExercise(item)?.definition?.safety.loadsRegions).not.toContain('lumbar')
      }
    }
  })

  it('blocks only an unresolvable identity explicitly fixed by the user', () => {
    const result = finalize(
      [exercise('Ejercicio inventado xyz')],
      lumbar,
      'Quiero hacer ejercicio inventado xyz',
    )
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.reason).toBe('unresolvable_exercise_identity')
  })

  it('removes an ambiguous identity rather than treating a partial name as safe', () => {
    const result = finalize([exercise('press'), exercise('Remo con pecho apoyado')], [])

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.removed).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: 'ambiguous_identity' }),
      ]))
      expect(result.exercises.every((item) => resolveStrengthExercise(item)?.definition != null)).toBe(true)
    }
  })

  it('is idempotent over its own finalized output', () => {
    const first = finalize([exercise('Peso muerto'), exercise('Remo con pecho apoyado')], lumbar)
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    const second = finalize(first.exercises, lumbar)
    expect(second.status).toBe('ok')
    if (second.status === 'ok') {
      expect(second.exercises).toEqual(first.exercises)
      expect(second.removed).toEqual([])
      expect(second.replaced).toEqual([])
    }
  })

  it('mantiene viable una sesión de 60 min sin carga axial cuando existe pool', () => {
    const noAxial: StrengthConstraint[] = [{
      kind: 'load_pattern', pattern: 'axial_load', sources: ['user_message'],
    }]
    const result = finalizeStrengthExercisesForRestrictions({
      exercises: [
        exercise('Sentadilla trasera'),
        exercise('Press de banca'),
        exercise('Jalón al pecho'),
      ],
      constraints: noAxial,
      durationMin: 60,
      sessionType: 'strength',
      selectionContext: buildStrengthSafetyContext(null, 60, undefined, noAxial),
      userMessage: '',
      supersetMode: 'off',
    })

    expect(result.status).toBe('ok')

    const inputExercises = [
      exercise('Sentadilla trasera'),
      exercise('Press de banca'),
      exercise('Jalón al pecho'),
    ]
    const prepared = prepareStrengthSession({
      durationMin: 60,
      exercises: inputExercises,
    }, {
      constraints: noAxial,
      userMessageConstraints: noAxial,
      userMessage: '',
      selectionContext: buildStrengthSafetyContext(null, 60, undefined, noAxial),
      structureOptions: { durationMin: 60 },
      supersetMode: 'off',
    })
    expect(prepared.status).toBe('ok')
  })
})
