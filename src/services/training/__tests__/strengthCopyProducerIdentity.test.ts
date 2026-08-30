import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext, CoachExerciseProposal } from '../../../types'
import { getExerciseById, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'
import { WeekCreatorEngine } from '../../weekCreator/WeekCreatorEngine'
import { db } from '../../../db/db'
import { useAIDebugStore } from '../../../store/useAIDebugStore'

const mockProviderCall = vi.hoisted(() => vi.fn())

vi.mock('../../ai/providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
}))

/**
 * Guard de identidad de los productores deterministas de fuerza tras retirar
 * su copy duplicado (plan 2026-08-01 §2). Prueba que el core inyectado, la
 * expansión de escaleras y el fallback local del Week Creator ya no cargan
 * `name`/`libraryRef` a mano: los toman todos de
 * `getStrengthExerciseIdentityById`, así un futuro renombre del catálogo no
 * puede volver a desincronizarlos.
 *
 * NO correr `vitest -u` sobre este archivo: la firma de prescripción del
 * fallback es un guard de regresión, no un valor a regenerar.
 */

function idFor(exerciseId: string): { name: string; id: string } {
  const definition = getExerciseById(exerciseId)
  if (!definition) throw new Error(`id inexistente en el catálogo: ${exerciseId}`)
  return { name: definition.name, id: definition.id }
}

describe('core inyectado', () => {
  it('el dead bug inyectado usa el id y el nombre canónico actuales', () => {
    const result = normalizeStrengthSessionExercises<CoachExerciseProposal>([
      { name: 'Peso muerto con trap bar', sets: 4, reps: 6 },
      { name: 'Press sobre cabeza', sets: 4, reps: 6 },
    ], { durationMin: 50, safetyConstraints: [] })!

    const expected = idFor('dead_bug')
    expect(result[0]).toMatchObject({
      name: expected.name,
      group: 'core',
      libraryRef: { source: 'strength_exercise', id: expected.id },
    })
  })
})

describe('expansión de escaleras genéricas', () => {
  it('las tres filas de footwork usan sus ids y nombres canónicos', () => {
    const result = normalizeStrengthSessionExercises<CoachExerciseProposal>([
      { name: 'Footwork escalera (cardio específico)', sets: 1, reps: '4 min', notes: 'Agilidad y coordinación' },
    ], { durationMin: 50, safetyConstraints: [] })!

    const footwork = result.filter((exercise) => exercise.group === 'cardio')
    expect(footwork).toHaveLength(3)

    const expectedIds = ['ladder_bipodal_lateral_1', 'ladder_bipodal_front_2', 'ladder_coordinativo_front_4']
    expectedIds.forEach((id, index) => {
      const expected = idFor(id)
      expect(footwork[index]).toMatchObject({
        name: expected.name,
        libraryRef: { source: 'strength_exercise', id: expected.id },
      })
    })
  })
})

describe('fallback local del Week Creator', () => {
  function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
    return {
      id: 'athlete-1',
      updatedAt: Date.now(),
      sportContext: {
        enabledSports: ['squash', 'running', 'strength'],
        primarySport: 'squash',
      },
      ...overrides,
    }
  }

  beforeEach(async () => {
    mockProviderCall.mockReset()
    useAIDebugStore.getState().clear()
    await db.aiRequestLogs.clear()
  })

  it('estampa refs vivos en todos los ejercicios y conserva la firma de prescripción', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'Puedo armar una semana con squash, fuerza y running, pero no incluyo acciones.',
      provider: 'gemini',
      model: 'gemini-flash',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          // Seis días y fuerza como único deporte complementario: el fallback
          // programa DOS sesiones de fuerza, que es lo que hace falta para que
          // `variants[0]` y `variants[1]` se ejerciten. Con una sola sesión los
          // 7 ejercicios de la segunda variante —`split_squat` y
          // `air_treadmill_20_20` entre ellos— quedaban sin congelar.
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
          sessionsPerWeek: 6,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana de entrenamiento para la próxima semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const strengthSessions = (response.actions?.[0].sessions ?? [])
      .filter((session) => session.sessionType === 'strength')

    // Las dos variantes se alternan por `sportIndex`, así que hacen falta dos
    // sesiones para cubrir las 14 filas literales que se migraron a ids.
    expect(strengthSessions.length).toBeGreaterThanOrEqual(2)
    for (const session of strengthSessions) expect(session.exercises!.length).toBeGreaterThan(0)

    // Refs vivos: cada ejercicio resuelve por su libraryRef a una definición
    // real del catálogo cuyo nombre coincide con el nombre estampado.
    const allExercises = strengthSessions.flatMap((session) => session.exercises!)
    for (const exercise of allExercises) {
      expect(exercise.libraryRef?.source).toBe('strength_exercise')
      const definition = exercise.libraryRef ? getExerciseById(exercise.libraryRef.id) : undefined
      expect(definition).toBeDefined()
      expect(exercise.name).toBe(definition!.name)
    }

    // Todos los ids estampados pertenecen al catálogo vigente (permanencia).
    const knownIds = new Set(STRENGTH_EXERCISE_LIBRARY.map((definition) => definition.id))
    expect(allExercises.every((exercise) => knownIds.has(exercise.libraryRef!.id))).toBe(true)

    // Ambas variantes representadas: `split_squat` y `air_treadmill_20_20` solo
    // aparecen en `variants[1]`, así que su presencia prueba que la segunda
    // variante entró al snapshot.
    const coveredIds = new Set(allExercises.map((exercise) => exercise.libraryRef!.id))
    expect(coveredIds.has('goblet_squat')).toBe(true)
    expect(coveredIds.has('split_squat')).toBe(true)
    expect(coveredIds.has('air_treadmill_20_20')).toBe(true)

    // Firma de prescripción sin `name`/`libraryRef`: guard de regresión de la
    // identidad y de la densidad final. El finalizador de seguridad puede
    // completar el target sólo con ids canónicos; cualquier cambio se revisa
    // manualmente y nunca se acepta con una actualización masiva de snapshots.
    const signature = strengthSessions.map((session, variantIndex) => ({
      variantIndex,
      exercises: session.exercises!.map((exercise) => ({
        id: exercise.libraryRef!.id,
        sets: exercise.sets,
        reps: exercise.reps,
        group: exercise.group,
        weight: exercise.weight ?? null,
        targetPercent1RM: exercise.targetPercent1RM ?? null,
        targetRpe: exercise.targetRpe ?? null,
        warmupSetsCount: exercise.warmupSets?.length ?? 0,
      })),
    }))

    await expect(`${JSON.stringify(signature, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/strengthCopyProducerIdentityFallbackSignature.json')
  })
})
