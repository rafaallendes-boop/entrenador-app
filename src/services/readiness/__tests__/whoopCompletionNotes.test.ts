import { describe, expect, it } from 'vitest'
import type { WhoopWorkout } from '../../../types'
import { buildWhoopCompletionNotes } from '../whoopCompletionNotes'

function workout(overrides: Partial<WhoopWorkout>): WhoopWorkout {
  return {
    id: `whoop:ath_1:${overrides.workoutId ?? 'w'}`,
    workoutId: 'w',
    athleteId: 'ath_1',
    date: '2026-07-10',
    sportName: 'squash',
    startAt: '2026-07-10T14:00:00.000Z',
    endAt: '2026-07-10T14:48:00.000Z',
    durationMin: 48,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

describe('buildWhoopCompletionNotes', () => {
  it('formats the 3 most recent workouts by startAt desc', () => {
    const notes = buildWhoopCompletionNotes([
      workout({ workoutId: 'w3', date: '2026-07-06', sportName: 'running', durationMin: 35, startAt: '2026-07-06T10:00:00.000Z' }),
      workout({ workoutId: 'w1', date: '2026-07-10', sportName: 'squash', durationMin: 48, startAt: '2026-07-10T14:00:00.000Z' }),
      workout({ workoutId: 'w2', date: '2026-07-08', sportName: 'weightlifting', durationMin: 62, startAt: '2026-07-08T09:00:00.000Z' }),
      workout({ workoutId: 'w0', date: '2026-07-04', sportName: 'running', durationMin: 40, startAt: '2026-07-04T10:00:00.000Z' }),
    ])
    expect(notes).toBe('Whoop: ultimos entrenamientos: 2026-07-10 squash 48 min; 2026-07-08 strength 62 min; 2026-07-06 running 35 min.')
  })

  it('handles fewer than 3 workouts', () => {
    expect(buildWhoopCompletionNotes([workout({ workoutId: 'w1' })]))
      .toBe('Whoop: ultimos entrenamientos: 2026-07-10 squash 48 min.')
  })

  it('returns undefined without workouts', () => {
    expect(buildWhoopCompletionNotes([])).toBeUndefined()
  })

  it('falls back to the raw sport name when unmapped', () => {
    expect(buildWhoopCompletionNotes([workout({ sportName: 'tennis' })])).toContain('tennis')
  })
})
