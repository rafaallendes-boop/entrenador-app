import { describe, expect, it } from 'vitest'

import { STRENGTH_EXERCISE_LIBRARY } from '../../training/exerciseLibrary'
import { resolveSessionStrengthRoles } from '../strengthRoleContract'

const byCategory = (category: string) =>
  STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.category === category)!.name
const byIntensity = (intensityType: string) =>
  STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.intensityType === intensityType)!.name
const plainLift = () =>
  STRENGTH_EXERCISE_LIBRARY.find(
    (exercise) => exercise.category !== 'core' && exercise.intensityType !== 'power',
  )!.name

describe('resolveSessionStrengthRoles', () => {
  it('exime al primer ejercicio reconocido que no sea core ni power', () => {
    const roles = resolveSessionStrengthRoles([{ name: plainLift() }, { name: plainLift() }])

    expect(roles[0]).toBe('main_lift')
    expect(roles[1]).toBe('accessory')
  })

  it('core al principio no consume el cupo de main_lift', () => {
    const roles = resolveSessionStrengthRoles([{ name: byCategory('core') }, { name: plainLift() }])

    expect(roles[0]).toBe('trunk')
    expect(roles[1]).toBe('main_lift')
  })

  it('power al principio no consume el cupo de main_lift', () => {
    const roles = resolveSessionStrengthRoles([{ name: byIntensity('power') }, { name: plainLift() }])

    expect(roles[0]).toBe('power')
    expect(roles[1]).toBe('main_lift')
  })

  it('una sesión solo de core/power no tiene ninguna exención', () => {
    const roles = resolveSessionStrengthRoles([
      { name: byCategory('core') },
      { name: byIntensity('power') },
    ])

    expect(roles).not.toContain('main_lift')
  })

  it('un ejercicio desconocido nunca obtiene la exención', () => {
    const roles = resolveSessionStrengthRoles([
      { name: 'Ejercicio Inventado Que No Existe' },
      { name: plainLift() },
    ])

    expect(roles[0]).toBe('unknown')
    expect(roles[1]).toBe('main_lift')
  })
})
