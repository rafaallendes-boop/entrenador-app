import { describe, expect, it } from 'vitest'

import {
  buildDynamicStrengthSelectionSection,
  buildStrengthRulesSection,
  toCoachExerciseProposal,
} from '../ai/promptModules/strengthPrompt'

describe('strengthPrompt', () => {
  it('wraps intensity as metadata when exercise notes are missing', () => {
    expect(toCoachExerciseProposal({
      name: 'Push press',
      sets: 4,
      reps: 3,
      intensity: 'explosive',
    })).toMatchObject({
      name: 'Push press',
      notes: '[explosive]',
    })
  })

  it('states expected density and squash support structure', () => {
    const rules = buildStrengthRulesSection()
    const dynamic = buildDynamicStrengthSelectionSection({} as never, {
      selectionContext: {
        phase: 'build',
        fatigueLevel: 4,
        recentExercises: [],
        goal: 'preparacion fisica squash',
        sportProfile: 'sport_support',
        primarySport: 'squash',
        sessionDurationMin: 60,
        competitionSoon: false,
      },
      selection: {
        focus: 'squash lateral strength + trunk stability',
        exercises: [
          { name: 'Trap Bar Deadlift', sets: 4, reps: 5, intensity: 'moderate-heavy' },
          { name: 'Pallof Press', sets: 3, reps: 10, intensity: 'controlled' },
          { name: 'TRX Inverted Row', sets: 3, reps: 10, intensity: 'controlled' },
          { name: 'BB Side Lunges', sets: 3, reps: 8, intensity: 'moderate' },
          { name: 'Side Plank + Plate Press', sets: 3, reps: '30s', intensity: 'controlled' },
        ],
      },
    })

    expect(rules).toContain('Estructura recomendada sport_support/squash')
    expect(dynamic).toContain('Densidad esperada: 5-7 ejercicios para 60 min')
    expect(dynamic).toContain('No entregues menos de 5 ejercicios')
  })
})
