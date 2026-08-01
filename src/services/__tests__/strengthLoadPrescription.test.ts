import { describe, expect, it } from 'vitest'

import type { StrengthProfile } from '../../types'
import {
  buildWarmupRamp,
  computeWeightFromPercent,
  getStrengthReferenceKg,
  hasAnyStrengthReference,
  listAvailableStrengthReferences,
} from '../training/strengthLoadPrescription'

const fullProfile: StrengthProfile = {
  benchPress1RM: 100,
  squat1RM: 140,
  deadlift1RM: 180,
  overheadPress1RM: 65,
  pullUpMaxReps: 14,
}

describe('getStrengthReferenceKg', () => {
  it('reads each numeric reference from the profile vocabulary', () => {
    expect(getStrengthReferenceKg('benchPress', fullProfile)).toBe(100)
    expect(getStrengthReferenceKg('squat', fullProfile)).toBe(140)
    expect(getStrengthReferenceKg('deadlift', fullProfile)).toBe(180)
    expect(getStrengthReferenceKg('overheadPress', fullProfile)).toBe(65)
  })

  it('returns undefined for missing, zero or absent profile values', () => {
    expect(getStrengthReferenceKg('benchPress', { squat1RM: 140 })).toBeUndefined()
    expect(getStrengthReferenceKg('benchPress', { benchPress1RM: 0 })).toBeUndefined()
    expect(getStrengthReferenceKg('benchPress', undefined)).toBeUndefined()
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
