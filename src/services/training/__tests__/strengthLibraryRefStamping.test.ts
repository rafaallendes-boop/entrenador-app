import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal } from '../../../types'
import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'
import { selectStrengthSession } from '../strengthSelector'

describe('estampado de libraryRef en los productores deterministas', () => {
  it('el selector estampa el id de cada definición elegida', () => {
    const selection = selectStrengthSession({
      phase: 'build',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'fuerza general',
      sportProfile: 'hybrid',
      sessionDurationMin: 50,
      experienceLevel: 'intermediate',
      availableEquipment: ['barbell', 'dumbbell', 'bodyweight'],
      primarySport: 'squash',
      safetyConstraints: [],
    })

    expect(selection.exercises.length).toBeGreaterThan(0)
    for (const exercise of selection.exercises) {
      expect(exercise.libraryRef?.source).toBe('strength_exercise')
      expect(exercise.libraryRef?.id).toBeTruthy()
    }
  })

  it('el core de fundación inyectado trae el ref de dead_bug', () => {
    const result = normalizeStrengthSessionExercises([
      { name: 'Press banca', sets: 3, reps: 5 } as CoachExerciseProposal,
    ], { durationMin: 50, safetyConstraints: [] })!

    const core = result.find((exercise) => exercise.name === 'Dead bug — control de tronco')
    expect(core?.libraryRef).toEqual({ source: 'strength_exercise', id: 'dead_bug' })
  })

  it('la expansión de footwork reemplaza el ref muerto del bloque genérico', () => {
    const result = normalizeStrengthSessionExercises([
      {
        name: 'Escalera de agilidad',
        sets: 1,
        reps: '4 min',
        libraryRef: { source: 'strength_exercise', id: 'ejercicio_retirado_hace_años' },
      } as CoachExerciseProposal,
    ], { durationMin: 30, safetyConstraints: [] })!

    const ladders = result.filter((exercise) => exercise.name.startsWith('Escalera'))
    expect(ladders).toHaveLength(3)
    expect(ladders.map((exercise) => exercise.libraryRef?.id)).toEqual([
      'ladder_bipodal_lateral_1',
      'ladder_bipodal_front_2',
      'ladder_coordinativo_front_4',
    ])
  })

  it('un ref vivo evita la expansión de footwork', () => {
    const result = normalizeStrengthSessionExercises([
      {
        name: 'Escalera de agilidad',
        sets: 1,
        reps: '4 min',
        libraryRef: { source: 'strength_exercise', id: 'ladder_bipodal_front_1' },
      } as CoachExerciseProposal,
    ], { durationMin: 30, safetyConstraints: [] })!

    expect(result.filter((exercise) => exercise.name === 'Escalera de agilidad')).toHaveLength(1)
    expect(result.some((exercise) => exercise.name.startsWith('Escalera frontal'))).toBe(false)
  })
})
