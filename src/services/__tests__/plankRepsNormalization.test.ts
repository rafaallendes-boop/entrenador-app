import { describe, it, expect } from 'vitest'
import { normalizeStrengthSessionExercises } from '../training/strengthSessionStructure'

// durationMin: 40 keeps the test isolated to reps normalization only,
// avoiding the ensureCoreBlock logic (which triggers at durationMin >= 45)
// that would prepend or replace core exercises and shift indexes.
describe('plancha/plank reps normalization', () => {
  it('converts numeric reps to duration string for plancha', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Plancha', sets: 3, reps: 30, group: 'core' }],
      { durationMin: 40 },
    )
    expect(result![0].reps).toBe('30s')
  })

  it('converts numeric reps to duration string for plank', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Plank lateral', sets: 3, reps: 45, group: 'core' }],
      { durationMin: 40 },
    )
    expect(result![0].reps).toBe('45s')
  })

  it('leaves string reps alone even for plancha', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Plancha', sets: 3, reps: '30s', group: 'core' }],
      { durationMin: 40 },
    )
    expect(result![0].reps).toBe('30s')
  })

  it('does not affect non-plank exercises with numeric reps', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Sentadilla', sets: 4, reps: 6, group: 'legs' }],
      { durationMin: 40 },
    )
    expect(result![0].reps).toBe(6)
  })
})
