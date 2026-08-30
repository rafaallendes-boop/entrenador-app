import { describe, it, expect } from 'vitest'
import { getExerciseById } from '../training/exerciseLibrary'
import { normalizeStrengthSessionExercises } from '../training/strengthSessionStructure'

// durationMin: 40 keeps the test isolated to reps normalization only,
// avoiding the ensureCoreBlock logic (which triggers at durationMin >= 45)
// that would prepend or replace core exercises and shift indexes.
describe('plancha/plank reps normalization', () => {
  it('converts numeric reps to duration string for plancha', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Plancha', sets: 3, reps: 30, group: 'core' }],
      { durationMin: 40, safetyConstraints: [] },
    )
    expect(result![0].reps).toBe('30s')
  })

  it('converts numeric reps to duration string for plank', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Plank lateral', sets: 3, reps: 45, group: 'core' }],
      { durationMin: 40, safetyConstraints: [] },
    )
    expect(result![0].reps).toBe('45s')
  })

  it('leaves string reps alone even for plancha', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Plancha', sets: 3, reps: '30s', group: 'core' }],
      { durationMin: 40, safetyConstraints: [] },
    )
    expect(result![0].reps).toBe('30s')
  })

  it('does not affect non-plank exercises with numeric reps', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Sentadilla', sets: 4, reps: 6, group: 'legs' }],
      { durationMin: 40, safetyConstraints: [] },
    )
    expect(result![0].reps).toBe(6)
  })

  it('declares seconds only on the five catalog plank definitions', () => {
    const timedIds = [
      'plank',
      'side_plank',
      'copenhagen_side_plank',
      'side_plank_plate_press',
      'stability_ball_front_plank',
    ]

    for (const id of timedIds) {
      expect(getExerciseById(id)?.prescriptionUnit, id).toBe('seconds')
    }
    expect(getExerciseById('pallof_press')?.prescriptionUnit).toBeUndefined()
    expect(getExerciseById('dead_bug')?.prescriptionUnit).toBeUndefined()
  })

  it('does not infer seconds from shared core metadata on a resolved non-plank', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Press Pallof', sets: 3, reps: 30, group: 'core' }],
      { durationMin: 40, safetyConstraints: [] },
    )
    expect(result![0].reps).toBe(30)
  })

  it('keeps the name fallback when a non-plank resolves only by substring', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Plancha Press Pallof', sets: 3, reps: 30, group: 'core' }],
      { durationMin: 40, safetyConstraints: [] },
    )
    expect(result![0].reps).toBe('30s')
  })

  it('does not apply definition units to a partial substring without a plank word', () => {
    const result = normalizeStrengthSessionExercises(
      [{ name: 'Fitball', sets: 3, reps: 30, group: 'core' }],
      { durationMin: 40, safetyConstraints: [] },
    )
    expect(result![0].reps).toBe(30)
  })
})
