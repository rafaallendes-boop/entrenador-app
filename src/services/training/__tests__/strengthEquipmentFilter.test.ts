import { describe, expect, it } from 'vitest'

import type { StrengthContext } from '../strengthSelector'
import { selectStrengthSession } from '../strengthSelector'
import { resolveStrengthExercise } from '../exerciseLibrary'

/**
 * El filtro por equipamiento no readmite lo que el atleta declaró no tener.
 *
 * Antes, el camino de bloques —el que usa Plan Builder— sólo penalizaba con
 * −30 la falta de equipamiento, contra +35 por referencia de 1RM disponible y
 * +30 por grupo de rotación preferido. Una penalización que otras señales
 * superan no es una exclusión: producía sesiones con barra para quien declaró
 * entrenar en casa. Advertir sobre una sesión imposible de ejecutar no la
 * vuelve ejecutable.
 */

function blockContext(availableEquipment: string[] | undefined): StrengthContext {
  return {
    fatigueLevel: 4,
    phase: 'build',
    recentExercises: [],
    goal: 'fuerza de apoyo',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    sessionDurationMin: 60,
    safetyConstraints: [],
    // Estas tres señales activan el camino de bloques.
    weekIndexInBlock: 0,
    available1RM: ['squat', 'benchPress'],
    rpeAdjustment: 0,
    availableEquipment,
  }
}

function equipmentOf(name: string, libraryRef?: { source: 'strength_exercise'; id: string }) {
  return resolveStrengthExercise({ name, libraryRef })?.definition?.equipment ?? []
}

describe('filtro estricto por equipamiento disponible', () => {
  it.each([
    [['bodyweight', 'bands']],
    [['bands']],
    [['machine', 'cable']],
  ])('el camino de bloques no propone equipo ausente (%s)', (available) => {
    const session = selectStrengthSession(blockContext(available))

    expect(session.exercises.length).toBeGreaterThan(0)
    for (const exercise of session.exercises) {
      const equipment = equipmentOf(exercise.name, exercise.libraryRef)
      expect(
        equipment.some((item) => available.includes(item)),
        `${exercise.name} declara ${equipment.join(',')}`,
      ).toBe(true)
    }
  })

  it('una selección vacía no produce una sesión con equipo inventado', () => {
    const session = selectStrengthSession(blockContext([]))

    expect(session.exercises).toEqual([])
  })

  it('sin declarar equipamiento el comportamiento no cambia', () => {
    const session = selectStrengthSession(blockContext(undefined))

    expect(session.exercises.length).toBeGreaterThan(0)
  })
})
