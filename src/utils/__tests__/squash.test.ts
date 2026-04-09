import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { isCompetitionSquashMatch, isPracticeSquashMatch } from '../squash'

function makeSquashSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-09',
    timeBlock: overrides.timeBlock ?? 'AM',
    type: 'squash',
    status: overrides.status ?? 'planned',
    subtype: overrides.subtype ?? 'match',
    title: overrides.title ?? 'Partido',
    durationMin: overrides.durationMin ?? 60,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  } as Session
}

describe('squash session mode compatibility', () => {
  it('treats legacy subtype match without sessionMode as competition match', () => {
    const session = makeSquashSession()

    expect(isCompetitionSquashMatch(session)).toBe(true)
    expect(isPracticeSquashMatch(session)).toBe(false)
  })

  it('treats subtype match plus practice_match as training match-play', () => {
    const session = makeSquashSession({
      squashDetails: {
        trainingFocus: 'tactical',
        sessionMode: 'practice_match',
        drills: [{ name: 'Partido de entrenamiento libre a 5 games' }],
      },
    })

    expect(isCompetitionSquashMatch(session)).toBe(false)
    expect(isPracticeSquashMatch(session)).toBe(true)
  })
})
