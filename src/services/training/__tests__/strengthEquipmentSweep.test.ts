import { describe, expect, it } from 'vitest'

import { resolveStrengthExercise } from '../exerciseLibrary'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

/**
 * Barrido de invariante sobre la matriz completa de contextos.
 *
 * Los tests dirigidos cubren casos elegidos a mano; esto recorre las
 * combinaciones de equipamiento, fase, perfil deportivo, ruta (bloques y sin
 * bloques) y fatiga, y exige la misma propiedad en todas: si el atleta declaró
 * su equipamiento, ningún ejercicio propuesto puede requerir otro.
 */

const EQUIPMENT_SETS: string[][] = [
  ['barbell', 'dumbbell', 'bodyweight', 'cable'],
  ['machine', 'cable'],
  ['dumbbell', 'bands', 'bodyweight'],
  ['bodyweight'],
]

const PHASES = ['base', 'build', 'peak', 'taper'] as const
const SPORT_PROFILES = ['strength_primary', 'hybrid', 'sport_support'] as const

function contextFor(
  availableEquipment: string[],
  phase: StrengthContext['phase'],
  sportProfile: StrengthContext['sportProfile'],
  blockMode: boolean,
  fatigueLevel: number,
): StrengthContext {
  return {
    fatigueLevel,
    phase,
    recentExercises: [],
    goal: 'fuerza',
    sportProfile,
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    sessionDurationMin: 60,
    safetyConstraints: [],
    availableEquipment,
    ...(blockMode ? { weekIndexInBlock: 0, available1RM: ['squat', 'benchPress'] as const } : {}),
  }
}

describe('barrido de equipamiento sobre la matriz de contextos', () => {
  it('ningún escenario propone equipo que el atleta no declaró', () => {
    const offenders: string[] = []
    let scenarios = 0

    for (const availableEquipment of EQUIPMENT_SETS) {
      for (const phase of PHASES) {
        for (const sportProfile of SPORT_PROFILES) {
          for (const blockMode of [false, true]) {
            for (const fatigueLevel of [3, 7]) {
              scenarios += 1
              const session = selectStrengthSession(
                contextFor(availableEquipment, phase, sportProfile, blockMode, fatigueLevel),
              )

              for (const exercise of session.exercises) {
                const definition = resolveStrengthExercise(exercise)?.definition
                if (!definition) continue
                if (definition.equipment.some((item) => availableEquipment.includes(item))) continue
                offenders.push(
                  `${availableEquipment.join('+')}|${phase}|${sportProfile}|${blockMode ? 'block' : 'flat'}|f${fatigueLevel}: ` +
                  `${definition.id} requiere ${definition.equipment.join(',')}`,
                )
              }
            }
          }
        }
      }
    }

    expect(scenarios).toBe(192)
    expect(offenders).toEqual([])
  })

  it('un atleta con sólo peso corporal recibe una sesión ejecutable, no una vacía', () => {
    // El filtro estricto no puede degradar en no entregar nada: el catálogo
    // tiene trabajo de peso corporal real y debe encontrarlo.
    const session = selectStrengthSession(contextFor(['bodyweight'], 'build', 'sport_support', true, 4))

    expect(session.exercises.length).toBeGreaterThanOrEqual(3)
  })
})
