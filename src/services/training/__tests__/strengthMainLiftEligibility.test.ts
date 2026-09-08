import { describe, expect, it } from 'vitest'

import { resolveSessionStrengthRoles } from '../../planBuilder/strengthRoleContract'
import {
  getExerciseById,
  getStrengthExerciseRole,
  isMainLiftEligible,
  STRENGTH_EXERCISE_LIBRARY,
} from '../exerciseLibrary'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

/**
 * Un aislamiento nunca es el levantamiento principal de una sesión.
 *
 * La taxonomía por sí sola no lo garantiza: hay cuatro caminos que pueden
 * coronar un ejercicio como principal, y ninguno mira el patrón de movimiento.
 *   1. `selectMainLiftWithProgression` elige por `intensityType`.
 *   2. Un slot `lunge` acepta cualquier ejercicio unilateral.
 *   3. `getStrengthExerciseRole` corona al índice 0.
 *   4. `resolveSessionStrengthRoles` corona al primer líder reconocido — y ese
 *      rol es el ÚNICO exento del conteo de repetición, así que un aislamiento
 *      primero se autoeximiría del detector de diversidad.
 *
 * Por eso la elegibilidad es un predicado explícito y compartido, no una
 * consecuencia de que hoy ninguna plantilla pida `knee_extension`.
 */

const ISOLATION_ID = 'machine_leg_extension'

function machineOnlyContext(): StrengthContext {
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
    availableEquipment: ['machine'],
  }
}

describe('elegibilidad para levantamiento principal', () => {
  it('los 77 ejercicios previos siguen siendo elegibles', () => {
    // El campo es opt-in: introducirlo no puede cambiar el catálogo existente.
    const legacy = STRENGTH_EXERCISE_LIBRARY.filter((exercise) => exercise.isolation !== true)
    expect(legacy.length).toBeGreaterThanOrEqual(77)
    for (const exercise of legacy) expect(isMainLiftEligible(exercise)).toBe(true)
  })

  it('un aislamiento declarado no es elegible', () => {
    const isolation = getExerciseById(ISOLATION_ID)
    expect(isolation).toBeDefined()
    expect(isMainLiftEligible(isolation!)).toBe(false)
  })

  it('el rol posicional no corona a un aislamiento que quedó primero', () => {
    const isolation = getExerciseById(ISOLATION_ID)!
    expect(getStrengthExerciseRole(isolation, 0)).toBe('accessory')
  })

  it('el contrato de roles no exime a un aislamiento del conteo de repetición', () => {
    const roles = resolveSessionStrengthRoles([
      { name: getExerciseById(ISOLATION_ID)!.name },
      { name: getExerciseById('back_squat')!.name },
    ])

    // El aislamiento cuenta; el compuesto siguiente toma el rol exento.
    expect(roles[0]).toBe('accessory')
    expect(roles[1]).toBe('main_lift')
  })

  it('el selector no elige un aislamiento como principal aunque sea lo mejor puntuado', () => {
    const session = selectStrengthSession(machineOnlyContext())
    const lead = session.exercises.find((exercise) => exercise.group !== 'core')

    expect(lead).toBeDefined()
    const definition = STRENGTH_EXERCISE_LIBRARY.find((item) => item.name === lead!.name)
    expect(definition?.isolation).not.toBe(true)
  })
})

describe('los aislamientos no dominan el relleno de densidad', () => {
  it('una sesión de apoyo al squash no se llena de trabajo analítico', () => {
    // Ampliar el catálogo con accesorios no puede convertir una sesión de
    // apoyo deportivo en una rutina de aislamientos: son los más baratos de
    // puntuar alto y son los que más entran por densidad.
    const session = selectStrengthSession({
      ...machineOnlyContext(),
      weekIndexInBlock: 0,
      available1RM: [],
    })

    const isolations = session.exercises.filter((exercise) => {
      const definition = STRENGTH_EXERCISE_LIBRARY.find((item) => item.name === exercise.name)
      return definition?.isolation === true
    })

    expect(session.exercises.length).toBeGreaterThan(0)
    expect(isolations.length).toBeLessThanOrEqual(2)
  })
})
