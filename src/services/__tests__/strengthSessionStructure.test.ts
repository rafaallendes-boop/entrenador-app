import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal } from '../../types'
import { enhanceStrengthSessionExercises, normalizeStrengthSessionExercises } from '../training/strengthSessionStructure'

describe('normalizeStrengthSessionExercises', () => {
  it('separates core first, strength work next and ladder cardio last', () => {
    const input: CoachExerciseProposal[] = [
      { name: 'Peso muerto con trap bar', sets: 4, reps: 6 },
      { name: 'Remo medio arrodillado', sets: 3, reps: 10 },
      { name: 'Escalera lateral – dos pies por cuadro', sets: 3, reps: 10 },
      { name: 'Corte diagonal con disco medio arrodillado', sets: 3, reps: 10 },
      { name: 'Press sobre cabeza', sets: 4, reps: 6 },
      { name: 'Press Pallof', sets: 3, reps: 10 },
    ]

    const result = normalizeStrengthSessionExercises(input, { durationMin: 60 })!

    expect(result.map((exercise) => exercise.group)).toEqual([
      'core',
      'core',
      'legs',
      'push',
      'pull',
      'cardio',
    ])
    expect(result[0].name).toBe('Control de tronco dead bug')
    expect(result.at(-1)?.name).toBe('Escalera lateral – dos pies por cuadro')
  })

  it('adds a core block when the model omits zona media in a normal session', () => {
    const result = normalizeStrengthSessionExercises([
      { name: 'Peso muerto con trap bar', sets: 4, reps: 6 },
      { name: 'Press sobre cabeza', sets: 4, reps: 6 },
    ], { durationMin: 50 })!

    expect(result[0]).toMatchObject({
      name: 'Control de tronco dead bug',
      group: 'core',
    })
  })

  it('classifies assault bike and air treadmill as final cardio', () => {
    const input: CoachExerciseProposal[] = [
      { name: 'Press Pallof', sets: 3, reps: 10 },
      { name: 'Bici de asalto 30/30', sets: 1, reps: '4 min: 30s/30s' },
      { name: 'Trotadora de aire 20/20', sets: 1, reps: '4 min: 20s/20s' },
      { name: 'Peso muerto con trap bar', sets: 4, reps: 6 },
    ]
    const result = normalizeStrengthSessionExercises(input, { durationMin: 65 })!

    expect(result.map((exercise) => exercise.group)).toEqual(['core', 'core', 'legs', 'cardio', 'cardio'])
    expect(result.at(-2)?.name).toBe('Bici de asalto 30/30')
    expect(result.at(-1)?.name).toBe('Trotadora de aire 20/20')
  })

  it('adds load prescriptions from strength profile after normalizing blocks', () => {
    const input: CoachExerciseProposal[] = [
      { name: 'Peso muerto con trap bar', sets: 4, reps: 6 },
      { name: 'Press sobre cabeza', sets: 4, reps: 6 },
      { name: 'Press Pallof', sets: 3, reps: 10 },
      { name: 'Bici de asalto 30/30', sets: 1, reps: '4 min: 30s/30s' },
    ]
    const result = enhanceStrengthSessionExercises(input, {
      durationMin: 60,
      strengthProfile: {
        deadlift1RM: 150,
        overheadPress1RM: 60,
      },
    })!

    const deadlift = result.find((exercise) => exercise.name === 'Peso muerto con trap bar')!
    const overheadPress = result.find((exercise) => exercise.name === 'Press sobre cabeza')!
    const core = result.find((exercise) => exercise.name === 'Press Pallof')!
    const cardio = result.find((exercise) => exercise.name === 'Bici de asalto 30/30')!

    expect(result[0].group).toBe('core')
    expect(deadlift).toMatchObject({ group: 'legs', targetPercent1RM: 77.5, weight: 110 })
    expect(deadlift.warmupSets?.length).toBeGreaterThan(0)
    expect(overheadPress).toMatchObject({ group: 'push', targetPercent1RM: 72.5, weight: 42.5 })
    expect(core.weight).toBeUndefined()
    expect(cardio.weight).toBeUndefined()
    expect(result.at(-1)?.group).toBe('cardio')
  })
})
