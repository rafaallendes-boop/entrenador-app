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

  it('expands generic 4 min ladder footwork into a short coordination series', () => {
    const input: CoachExerciseProposal[] = [
      { name: 'Sentadilla con barra', sets: 4, reps: '8-10' },
      { name: 'Footwork escalera (cardio específico)', sets: 1, reps: '4 min', notes: 'Agilidad y coordinación' },
    ]

    const result = normalizeStrengthSessionExercises(input, { durationMin: 60 })!
    const footwork = result.filter((exercise) => /Escalera/.test(exercise.name))

    expect(footwork).toHaveLength(3)
    expect(footwork.map((exercise) => exercise.name)).toEqual([
      'Escalera lateral – dos pies por cuadro',
      'Escalera frontal – in-in-out-out',
      'Escalera frontal – Icky shuffle',
    ])
    expect(footwork.every((exercise) => exercise.group === 'cardio')).toBe(true)
    expect(footwork.every((exercise) => exercise.sets === 2)).toBe(true)
    expect(footwork.every((exercise) => String(exercise.reps).includes('pasadas'))).toBe(true)
    expect(result.at(-3)?.name).toBe('Escalera lateral – dos pies por cuadro')
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

  it('does not prescribe barbell-scale loads for goblet squats or dumbbell accessories', () => {
    const input: CoachExerciseProposal[] = [
      { name: 'Sentadilla Goblet', sets: 3, reps: 10 },
      { name: 'Press de Hombros con Mancuernas', sets: 3, reps: 12, weight: 80, targetPercent1RM: 60 },
    ]
    const result = enhanceStrengthSessionExercises(input, {
      durationMin: 60,
      strengthProfile: {
        squat1RM: 120,
        overheadPress1RM: 65,
      },
    })!

    const goblet = result.find((exercise) => exercise.name === 'Sentadilla Goblet')!
    const dumbbellPress = result.find((exercise) => exercise.name === 'Press de Hombros con Mancuernas')!

    expect(goblet.weight).toBeLessThanOrEqual(30)
    expect(goblet.targetPercent1RM).toBeUndefined()
    expect(goblet.warmupSets).toBeUndefined()
    expect(dumbbellPress.weight).toBe(50)
    expect(dumbbellPress.targetPercent1RM).toBeUndefined()
  })
})
