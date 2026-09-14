import { describe, expect, it } from 'vitest'
import { getExerciseById, resolveStrengthExercise } from '../exerciseLibrary'
import {
  deriveProgressionIntent,
  getTargetExerciseDensity,
  isExperienceEligible,
  selectStrengthSession,
  type StrengthContext,
} from '../strengthSelector'

const base: StrengthContext = {
  fatigueLevel: 4, phase: 'base', recentExercises: [], goal: 'fuerza general',
  sportProfile: 'sport_support', sessionDurationMin: 60, safetyConstraints: [],
}

function definitionsOf(context: StrengthContext) {
  return selectStrengthSession(context).exercises.map((exercise) => resolveStrengthExercise(exercise)?.definition)
}

describe('D2 — experiencia unknown', () => {
  it('es elegibilidad intermedia menos requiresTechnique', () => {
    const backSquat = getExerciseById('back_squat')!
    const goblet = getExerciseById('goblet_squat')!
    const clean = getExerciseById('clean')!
    expect(isExperienceEligible(backSquat, 'intermediate')).toBe(true)
    expect(isExperienceEligible(backSquat, 'unknown')).toBe(false)
    expect(isExperienceEligible(goblet, 'unknown')).toBe(true)
    expect(isExperienceEligible(clean, 'unknown')).toBe(false)
  })

  it.each([
    ['ruta puntuada', undefined],
    ['ruta de bloque', ['squat', 'deadlift'] as Array<'squat' | 'deadlift'>],
  ])('ninguna selección unknown incluye técnica exigente (%s)', (_label, available1RM) => {
    for (const phase of ['base', 'build', 'peak'] as const) {
      const definitions = definitionsOf({ ...base, available1RM, phase, sportProfile: 'strength_primary', fatigueLevel: 2, experienceLevel: 'unknown' })
      expect(definitions.filter((definition) => definition?.requiresTechnique), phase).toEqual([])
    }
  })
})

describe('D6 — loaded (6) mantiene y filtra alto costo de fatiga', () => {
  it.each([
    ['ruta puntuada', undefined],
    ['ruta de bloque', ['squat', 'deadlift'] as Array<'squat' | 'deadlift'>],
  ])('sin fatigueCost high (%s)', (_label, available1RM) => {
    const definitions = definitionsOf({ ...base, phase: 'build', sportProfile: 'hybrid', fatigueLevel: 6, available1RM })
    expect(definitions.filter((definition) => definition?.fatigueCost === 'high')).toEqual([])
  })

  it('strength_primary con patrón principal progresa en 4 y mantiene en 6', () => {
    const context = { ...base, sportProfile: 'strength_primary' as const, phase: 'build' as const }
    expect(deriveProgressionIntent({ ...context, fatigueLevel: 4 }, 'squat', 1)).toBe('progress')
    expect(deriveProgressionIntent({ ...context, fatigueLevel: 6 }, 'squat', 1)).toBe('hold')
    expect(deriveProgressionIntent({ ...context, fatigueLevel: 8 }, 'squat', 1)).toBe('deload')
  })

  it('el tope nunca convierte rotate en hold', () => {
    expect(deriveProgressionIntent({ ...base, sportProfile: 'strength_primary', fatigueLevel: 6 }, 'squat', 4)).toBe('rotate')
  })
})

describe('D3 — returningFromBreak', () => {
  it('limita progress a hold sin tocar la fatiga', () => {
    expect(deriveProgressionIntent({ ...base, fatigueLevel: 2 }, undefined, 0)).toBe('progress')
    expect(deriveProgressionIntent({ ...base, fatigueLevel: 2, returningFromBreak: true }, undefined, 0)).toBe('hold')
  })

  it('baja la densidad objetivo en uno', () => {
    expect(getTargetExerciseDensity({ ...base, returningFromBreak: true }).target)
      .toBe(getTargetExerciseDensity(base).target - 1)
  })
})
