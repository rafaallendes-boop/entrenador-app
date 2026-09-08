import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, StrengthProfile } from '../../../types'
import { getExerciseById, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { enhanceStrengthSessionExercises } from '../strengthSessionStructure'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

/**
 * Quitar `loadReference` evita heredar kilos de una barra, pero no prescribe
 * nada por sí solo. Si el ejercicio llega sin series, repeticiones ni esfuerzo
 * objetivo, la decisión degradó la prescripción en vez de corregirla.
 *
 * Las máquinas nuevas no derivan carga del 1RM a propósito: el stack de una
 * prensa no es una fracción confiable de una sentadilla, y varía entre
 * gimnasios. Lo que sí deben traer siempre es esfuerzo objetivo.
 */

const PROFILE: StrengthProfile = {
  squat1RM: 140,
  deadlift1RM: 180,
  benchPress1RM: 110,
  overheadPress1RM: 80,
}

const MACHINE_IDS = STRENGTH_EXERCISE_LIBRARY
  .filter((exercise) => exercise.tags.includes('machine_based'))
  .map((exercise) => exercise.id)

function machineContext(overrides: Partial<StrengthContext> = {}): StrengthContext {
  return {
    fatigueLevel: 4,
    phase: 'build',
    recentExercises: [],
    goal: 'fuerza en maquinas',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    sessionDurationMin: 60,
    safetyConstraints: [],
    availableEquipment: ['machine', 'cable'],
    ...overrides,
  }
}

describe('prescripción de las máquinas nuevas', () => {
  it('ninguna deriva carga del 1RM de barra', () => {
    expect(MACHINE_IDS.length).toBeGreaterThan(0)
    for (const id of MACHINE_IDS) {
      expect(getExerciseById(id)?.loadReference, id).toBeUndefined()
    }
  })

  it.each(MACHINE_IDS)('%s llega con series, repeticiones y esfuerzo por enriquecimiento', (id) => {
    const definition = getExerciseById(id)!
    const proposal: CoachExerciseProposal = { name: definition.name, sets: 3, reps: 10 }
    const enhanced = enhanceStrengthSessionExercises([proposal], {
      durationMin: 30,
      strengthProfile: PROFILE,
      safetyConstraints: [],
    })?.[0]

    expect(enhanced?.sets).toBeGreaterThan(0)
    expect(enhanced?.reps).toBeDefined()
    expect(enhanced?.weight, 'una máquina no hereda kilos de la barra').toBeUndefined()
    expect(typeof enhanced?.targetRpe, 'esfuerzo objetivo ausente').toBe('number')

    expect(enhanced?.targetPercent1RM, 'sin referencia no hay porcentaje válido').toBeUndefined()
  })

  it('el camino de bloques prescribe esfuerzo objetivo', () => {
    const session = selectStrengthSession(machineContext({ weekIndexInBlock: 0, available1RM: [] }))

    expect(session.exercises.length).toBeGreaterThan(0)
    for (const exercise of session.exercises) {
      expect(typeof exercise.targetRpe, `${exercise.name} sin esfuerzo objetivo`).toBe('number')
    }
  })

  it('el camino sin bloques también prescribe esfuerzo objetivo', () => {
    const session = selectStrengthSession(machineContext())

    expect(session.exercises.length).toBeGreaterThan(0)
    for (const exercise of session.exercises) {
      expect(typeof exercise.targetRpe, `${exercise.name} sin esfuerzo objetivo`).toBe('number')
    }
  })
})
