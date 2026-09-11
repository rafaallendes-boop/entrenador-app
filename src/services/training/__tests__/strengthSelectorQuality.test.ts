import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import { getExerciseById, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { isLungeStrengthExercise } from '../strengthMovementCompatibility'
import {
  buildStrengthReplacementById,
  deriveStrengthProgressionState,
  filterByFatigue,
  getProgressedPrescription,
  selectStarLift,
  selectStrengthSession,
  summarizeStrengthProgression,
  type StrengthContext,
} from '../strengthSelector'

function context(overrides: Partial<StrengthContext> = {}): StrengthContext {
  return {
    phase: 'build', fatigueLevel: 3, recentExercises: [], safetyConstraints: [],
    goal: 'fuerza para squash', primarySport: 'squash', sportProfile: 'sport_support',
    experienceLevel: 'intermediate', sessionDurationMin: 60,
    ...overrides,
  }
}

function completedSession(date: string, ids: string[]): Session {
  return {
    id: date, date, timeBlock: 'AM', type: 'strength', status: 'completed',
    title: 'Fuerza', durationMin: 60, createdAt: 0, updatedAt: 0,
    exercises: ids.map((id) => ({
      id, name: getExerciseById(id)!.name, sets: 3, reps: 8, completed: true,
      libraryRef: { source: 'strength_exercise', id },
    })),
  }
}

describe('función de la zancada', () => {
  it.each(['bulgarian_split_squat', 'split_squat', 'walking_lunge', 'bb_side_lunge', 'step_up'])(
    '%s cubre fuerza unilateral de piernas', (id) => {
      expect(isLungeStrengthExercise(getExerciseById(id)!)).toBe(true)
    },
  )
  it.each(['barbell_single_leg_inverted_row', 'copenhagen_side_plank', 'single_leg_hip_thrust', 'machine_glute_kickback', 'lateral_skater_jumps'])(
    '%s no sustituye una zancada', (id) => {
      expect(isLungeStrengthExercise(getExerciseById(id)!)).toBe(false)
    },
  )
})

describe('progresión desde sesiones ejecutadas', () => {
  it('reconoce el principal después del core y cuenta una exposición por sesión', () => {
    const c = context({
      sportProfile: 'hybrid',
      historicalSessions: [completedSession('2026-09-08', ['plank', 'back_squat', 'front_squat', 'bulgarian_split_squat'])],
    })
    const state = deriveStrengthProgressionState(c)
    expect(state.mainPattern).toBe('squat')
    expect(state.patterns.squat).toMatchObject({ frequency: 1, lastExerciseId: 'back_squat', lastRole: 'main_lift' })
    expect(state.intent).toBe('progress')
  })
  it('no convierte un aislamiento previo en el principal', () => {
    const state = deriveStrengthProgressionState(context({ historicalSessions: [
      completedSession('2026-09-08', ['plank', 'machine_leg_extension', 'machine_chest_press']),
    ] }))
    expect(state.mainPattern).toBe('push')
  })
  it('ordena el historial y no diagnostica sobreentrenamiento por repetición', () => {
    const c = context({ historicalSessions: [
      completedSession('2026-09-05', ['plank', 'front_squat']),
      completedSession('2026-09-08', ['plank', 'back_squat']),
    ] })
    expect(deriveStrengthProgressionState(c).patterns.squat).toMatchObject({ frequency: 2, lastExerciseId: 'back_squat' })
    expect(summarizeStrengthProgression(c)).not.toContain('sobreentrenado')
  })
})

describe('dosis coherente con tiempo y descarga', () => {
  it('todos los isométricos declarados se prescriben por tiempo en el selector y en reemplazos', () => {
    const timed = STRENGTH_EXERCISE_LIBRARY.filter((exercise) => exercise.prescriptionUnit === 'seconds')
    expect(timed.length).toBeGreaterThan(2)
    for (const exercise of timed) {
      expect(getProgressedPrescription(exercise, context({ experienceLevel: 'advanced' }), 0).reps).toBe('30s')
      expect(buildStrengthReplacementById(exercise.id, context({ experienceLevel: 'advanced' }), 1)?.reps).toBe('30s')
    }
  })
  it.each(['assault_bike_30_30', 'air_treadmill_20_20'])(
    'descargar %s nunca aumenta el número de bloques', (id) => {
      const exercise = getExerciseById(id)!
      const fresh = getProgressedPrescription(exercise, context(), 0, { intent: 'hold', patterns: {} })
      const deload = getProgressedPrescription(exercise, context(), 0, { intent: 'deload', patterns: {} })
      expect(fresh.sets).toBe(1)
      expect(deload.sets).toBeLessThanOrEqual(fresh.sets)
    },
  )
  it('el principal publicado coincide con su dosis real, también en descarga', () => {
    for (const fatigueLevel of [3, 8]) {
      const selection = selectStrengthSession(context({ fatigueLevel, weekIndexInBlock: 1, available1RM: ['squat', 'deadlift', 'benchPress'] }))
      expect(selection.starLift).toBeDefined()
      const exercise = selection.exercises.find((item) => item.name === selection.starLift!.name)!
      expect(selection.starLift!.targetRpe).toBe(exercise.targetRpe)
      expect(selection.starLift!.targetPercent1RM).toBe(exercise.targetPercent1RM)
    }
  })
  it('la descarga prevalece sobre el porcentaje ascendente de build', () => {
    const fresh = selectStarLift(getExerciseById('back_squat')!, context({ weekIndexInBlock: 2, available1RM: ['squat'] }))
    const tired = selectStarLift(getExerciseById('back_squat')!, context({ fatigueLevel: 8, weekIndexInBlock: 2, available1RM: ['squat'] }))
    expect(fresh.targetPercent1RM).toBe(85)
    expect(tired.targetPercent1RM).toBe(60)
    expect(tired.targetRpe).toBeLessThan(fresh.targetRpe!)
  })
})

describe('límites del contexto en ambas rutas', () => {
  it.each([undefined, 0, 1, 2])('respeta el nivel principiante (bloque %s)', (weekIndexInBlock) => {
    const selection = selectStrengthSession(context({ experienceLevel: 'beginner', weekIndexInBlock }))
    expect(selection.exercises.length).toBeGreaterThan(0)
    for (const exercise of selection.exercises) {
      expect(getExerciseById(exercise.libraryRef!.id)!.difficulty).toBe('beginner')
    }
  })
  it('no relaja fatiga para completar una sesión con equipo limitado', () => {
    const c = context({ fatigueLevel: 8, availableEquipment: ['barbell'], sessionDurationMin: 75 })
    const selection = selectStrengthSession(c)
    const allowed = new Set(filterByFatigue(STRENGTH_EXERCISE_LIBRARY, c).map((exercise) => exercise.id))
    for (const exercise of selection.exercises) {
      const definition = getExerciseById(exercise.libraryRef!.id)!
      expect(allowed.has(definition.id)).toBe(true)
      expect(definition.fatigueCost).not.toBe('high')
    }
  })
})
