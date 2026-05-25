import { describe, expect, it } from 'vitest'

import type { StrengthProfile } from '../../types'
import {
  buildWarmupRamp,
  computeWeightFromPercent,
  hasAnyStrengthReference,
  listAvailableStrengthReferences,
  mapExerciseTo1RMReference,
} from '../training/strengthLoadPrescription'

const fullProfile: StrengthProfile = {
  benchPress1RM: 100,
  squat1RM: 140,
  deadlift1RM: 180,
  overheadPress1RM: 65,
  pullUpMaxReps: 14,
}

describe('mapExerciseTo1RMReference', () => {
  it('matches the exact bench press lift to bench profile', () => {
    const ref = mapExerciseTo1RMReference('Press de banca', fullProfile)
    expect(ref).toEqual({ lift: 'bench', referenceKg: 100, factor: 1.0 })
  })

  it('matches incline press with 0.85 factor (not generic bench)', () => {
    const ref = mapExerciseTo1RMReference('Press inclinado con mancuernas', fullProfile)
    expect(ref?.lift).toBe('bench')
    expect(ref?.factor).toBe(0.85)
  })

  it('matches front squat before generic squat (specificity)', () => {
    const ref = mapExerciseTo1RMReference('Front squat', fullProfile)
    expect(ref?.lift).toBe('squat')
    expect(ref?.factor).toBe(0.85)
  })

  it('matches hip thrust as squat-referenced with 1.2 factor', () => {
    const ref = mapExerciseTo1RMReference('Hip thrust con barra', fullProfile)
    expect(ref).toMatchObject({ lift: 'squat', factor: 1.2 })
  })

  it('matches romanian deadlift with 0.8 factor (not generic deadlift)', () => {
    const ref = mapExerciseTo1RMReference('Peso muerto rumano', fullProfile)
    expect(ref?.lift).toBe('deadlift')
    expect(ref?.factor).toBe(0.8)
  })

  it('matches push press as overhead-referenced with 1.15 factor', () => {
    const ref = mapExerciseTo1RMReference('Push press', fullProfile)
    expect(ref).toMatchObject({ lift: 'overheadPress', factor: 1.15 })
  })

  it('matches Z press as overhead-referenced with 0.65 factor', () => {
    const ref = mapExerciseTo1RMReference('Press Z', fullProfile)
    expect(ref).toMatchObject({ lift: 'overheadPress', factor: 0.65 })
  })

  it('matches pull-ups as pullUp reference', () => {
    const ref = mapExerciseTo1RMReference('Dominadas pronadas', fullProfile)
    expect(ref?.lift).toBe('pullUp')
    expect(ref?.referenceKg).toBe(14)
  })

  it('returns undefined when the relevant lift is missing from the profile', () => {
    const partial: StrengthProfile = { squat1RM: 140 }
    const ref = mapExerciseTo1RMReference('Press de banca', partial)
    expect(ref).toBeUndefined()
  })

  it('returns undefined for unknown exercises', () => {
    const ref = mapExerciseTo1RMReference('Cable curl', fullProfile)
    expect(ref).toBeUndefined()
  })

  it('returns undefined when profile is missing entirely', () => {
    expect(mapExerciseTo1RMReference('Sentadilla', undefined)).toBeUndefined()
  })

  it('matches barbell row as bench-referenced with 0.75 factor', () => {
    const ref = mapExerciseTo1RMReference('Remo con barra', fullProfile)
    expect(ref).toMatchObject({ lift: 'bench', factor: 0.75 })
  })

  it('matches half-kneeling rows as bench-referenced with 0.35 factor', () => {
    const ref = mapExerciseTo1RMReference('Remo medio arrodillado', fullProfile)
    expect(ref).toMatchObject({ lift: 'bench', factor: 0.35 })
  })

  it('matches bulgarian split squat as unilateral with 0.35 factor', () => {
    const ref = mapExerciseTo1RMReference('Búlgaras con mancuernas', fullProfile)
    expect(ref).toMatchObject({ lift: 'squat', factor: 0.35 })
  })
})

describe('computeWeightFromPercent', () => {
  it('rounds to nearest 2.5kg by default', () => {
    // 100kg × 76% = 76 → nearest 2.5 is 75 (76 is closer to 75 than to 77.5)
    expect(computeWeightFromPercent(100, 76)).toBe(75)
    // 100kg × 77% = 77 → nearest 2.5 is 77.5
    expect(computeWeightFromPercent(100, 77)).toBe(77.5)
  })

  it('applies factor for derived lifts', () => {
    // Incline at 80% of bench(100) × 0.85 factor = 68 → rounds to 67.5
    expect(computeWeightFromPercent(100, 80, { factor: 0.85 })).toBe(67.5)
  })

  it('respects custom rounding (5kg)', () => {
    expect(computeWeightFromPercent(140, 70, { roundingKg: 5 })).toBe(100)
  })

  it('never returns below the rounding step', () => {
    expect(computeWeightFromPercent(40, 5, { factor: 0.35 })).toBeGreaterThanOrEqual(2.5)
  })
})

describe('buildWarmupRamp', () => {
  it('returns 3 warmup sets for heavy intensity (>=85%)', () => {
    const ramp = buildWarmupRamp(120, 90)
    expect(ramp).toHaveLength(3)
    expect(ramp[0].percent1RM).toBe(50)
    expect(ramp[2].percent1RM).toBe(85)
    expect(ramp[0].weight).toBe(67.5) // 120kg @ 90% implies 1RM ~= 133kg; 50% ~= 67.5kg
  })

  it('returns 2 warmup sets for moderate intensity (75-84%)', () => {
    const ramp = buildWarmupRamp(95, 80)
    expect(ramp).toHaveLength(2)
    expect(ramp[0].reps).toBe(8)
    expect(ramp[1].reps).toBe(5)
  })

  it('returns 1 warmup set for light intensity (60-74%)', () => {
    const ramp = buildWarmupRamp(70, 65)
    expect(ramp).toHaveLength(1)
  })

  it('returns no warmup for very light loads (<60%)', () => {
    expect(buildWarmupRamp(50, 50)).toEqual([])
  })

  it('returns empty when target weight is invalid', () => {
    expect(buildWarmupRamp(0, 80)).toEqual([])
    expect(buildWarmupRamp(NaN, 80)).toEqual([])
  })

  it('weights ramp up monotonically', () => {
    const ramp = buildWarmupRamp(120, 90)
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i].weight!).toBeGreaterThanOrEqual(ramp[i - 1].weight!)
    }
  })
})

describe('hasAnyStrengthReference', () => {
  it('returns true when at least one 1RM is present', () => {
    expect(hasAnyStrengthReference({ squat1RM: 100 })).toBe(true)
  })

  it('returns false for empty profile', () => {
    expect(hasAnyStrengthReference({})).toBe(false)
  })

  it('returns false when profile is missing', () => {
    expect(hasAnyStrengthReference(undefined)).toBe(false)
  })

  it('ignores zero or negative values', () => {
    expect(hasAnyStrengthReference({ benchPress1RM: 0 })).toBe(false)
  })
})

describe('listAvailableStrengthReferences', () => {
  it('lists every populated 1RM in the canonical order', () => {
    const refs = listAvailableStrengthReferences(fullProfile)
    expect(refs).toEqual([
      'sentadilla 140kg',
      'peso muerto 180kg',
      'press banca 100kg',
      'press hombro 65kg',
      'dominadas 14 reps',
    ])
  })

  it('returns empty list when profile is missing', () => {
    expect(listAvailableStrengthReferences(undefined)).toEqual([])
  })
})
