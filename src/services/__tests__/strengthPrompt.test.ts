import { describe, expect, it } from 'vitest'

import { toCoachExerciseProposal } from '../ai/promptModules/strengthPrompt'

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
})
