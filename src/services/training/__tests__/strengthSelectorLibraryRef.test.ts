import { describe, expect, it } from 'vitest'

import type { Session } from '../../../types'
import {
  deriveStrengthProgressionState,
  extractRecentStrengthExercises,
  selectStrengthReplacement,
} from '../strengthSelector'

const refTo = (id: string) => ({ source: 'strength_exercise' as const, id })

function sessionWith(name: string, libraryRef?: { source: 'strength_exercise'; id: string }): Session {
  return {
    id: 's1',
    date: '2026-07-30',
    timeBlock: 'AM',
    type: 'strength',
    status: 'completed',
    title: 'Fuerza',
    durationMin: 60,
    exercises: [{ id: 'e1', name, sets: 4, reps: 5, completed: true, libraryRef }],
  } as Session
}

const CONTEXT = {
  phase: 'build' as const,
  fatigueLevel: 4,
  recentExercises: [],
  goal: 'fuerza general',
  sportProfile: 'strength_primary' as const,
  availableEquipment: ['barbell'],
}

describe('consumidores del selector con libraryRef', () => {
  it('el historial reciente usa el ref cuando el nombre no resuelve', () => {
    const keys = extractRecentStrengthExercises([
      sessionWith('Nombre libre irreconocible', refTo('back_squat')),
    ])
    expect(keys).toContain('back_squat')
  })

  it('la progresión cuenta el patrón usando el ref', () => {
    const state = deriveStrengthProgressionState({
      ...CONTEXT,
      historicalSessions: [sessionWith('Nombre libre irreconocible', refTo('back_squat'))],
    })

    expect(state.patterns.squat?.lastExerciseId).toBe('back_squat')
    expect(state.mainPattern).toBe('squat')
  })

  it('el reemplazo identifica el original por ref', () => {
    const replacement = selectStrengthReplacement({
      originalName: 'Nombre libre irreconocible',
      originalRef: refTo('back_squat'),
      context: CONTEXT,
      excludedKeys: new Set<string>(),
      rotationIndex: 0,
      exerciseIndex: 1,
    })

    expect(replacement).toBeDefined()
  })
})
