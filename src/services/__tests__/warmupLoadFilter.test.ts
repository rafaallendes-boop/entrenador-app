import { describe, it, expect } from 'vitest'
import type { CoachExerciseProposal } from '../../types'
import { enhanceStrengthSessionExercises } from '../training/strengthSessionStructure'

describe('warm-up/cooldown exercises do not receive targetPercent1RM', () => {
  const baseProfile = { squat1RM: 120, deadlift1RM: 140, bench1RM: 90, ohp1RM: 65 }

  it('does not assign targetPercent1RM to warm-up exercise', () => {
    const result = enhanceStrengthSessionExercises(
      [{ name: 'Warm-up/Activación', sets: 1, reps: 1, group: 'other' } as CoachExerciseProposal],
      { durationMin: 60, strengthProfile: baseProfile as never, safetyConstraints: [] }
    )
    const warmup = result!.find((e) => e.name === 'Warm-up/Activación')!
    expect(warmup.targetPercent1RM).toBeUndefined()
  })

  it('does not assign targetPercent1RM to cooldown exercise', () => {
    const result = enhanceStrengthSessionExercises(
      [{ name: 'Cooldown/Movilidad', sets: 1, reps: 5, group: 'other' } as CoachExerciseProposal],
      { durationMin: 60, strengthProfile: baseProfile as never, safetyConstraints: [] }
    )
    const cooldown = result!.find((e) => e.name === 'Cooldown/Movilidad')!
    expect(cooldown.targetPercent1RM).toBeUndefined()
  })

  it('removes cooldown exercises from a real strength session because cooldown has its own section', () => {
    const result = enhanceStrengthSessionExercises(
      [
        { name: 'Sentadilla', sets: 4, reps: 5, group: 'legs' } as CoachExerciseProposal,
        { name: 'Cooldown y Estiramientos Estáticos', sets: 1, reps: 5, group: 'other' } as CoachExerciseProposal,
      ],
      { durationMin: 60, strengthProfile: baseProfile as never, safetyConstraints: [] }
    )

    expect(result!.some((e) => /cooldown|estiramientos/i.test(e.name))).toBe(false)
    expect(result!.some((e) => e.name === 'Sentadilla')).toBe(true)
  })

  it('removes warm-up exercises from a real strength session because warmup has its own section', () => {
    const result = enhanceStrengthSessionExercises(
      [
        { name: 'Warm-up y Activación', sets: 1, reps: 5, group: 'other' } as CoachExerciseProposal,
        { name: 'Press banca', sets: 4, reps: 5, group: 'push' } as CoachExerciseProposal,
      ],
      { durationMin: 60, strengthProfile: baseProfile as never, safetyConstraints: [] }
    )

    expect(result!.some((e) => /warm-up|activación|activacion/i.test(e.name))).toBe(false)
    expect(result!.some((e) => e.name === 'Press banca')).toBe(true)
  })

  it('does not assign targetPercent1RM to activacion exercise', () => {
    const result = enhanceStrengthSessionExercises(
      [{ name: 'Activación muscular dinámica', sets: 2, reps: 10, group: 'other' } as CoachExerciseProposal],
      { durationMin: 60, strengthProfile: baseProfile as never, safetyConstraints: [] }
    )
    const activacion = result!.find((e) => e.name === 'Activación muscular dinámica')!
    expect(activacion.targetPercent1RM).toBeUndefined()
  })

  it('still assigns targetPercent1RM to normal strength exercises', () => {
    const result = enhanceStrengthSessionExercises(
      [{ name: 'Sentadilla', sets: 4, reps: 5, group: 'legs' } as CoachExerciseProposal],
      { durationMin: 60, strengthProfile: baseProfile as never, safetyConstraints: [] }
    )
    const sentadilla = result!.find((e) => e.name === 'Sentadilla')!
    expect(sentadilla.targetPercent1RM).toBeDefined()
  })
})
