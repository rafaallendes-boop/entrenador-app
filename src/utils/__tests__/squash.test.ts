import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { getRecentSquashCompetitiveExposure, isCompetitionSquashMatch, isPracticeSquashMatch } from '../squash'

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
  it('treats subtype match without sessionMode as non-competitive by default', () => {
    const session = makeSquashSession()

    expect(isCompetitionSquashMatch(session)).toBe(false)
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

  it('summarizes recent competitive exposure separating practice and competition', () => {
    const exposure = getRecentSquashCompetitiveExposure([
      makeSquashSession({
        squashDetails: {
          trainingFocus: 'tactical',
          sessionMode: 'practice_match',
          drills: [{ name: 'Partido de entrenamiento libre a 5 games' }],
        },
      }),
      makeSquashSession({
        id: 'session-2',
        subtype: 'competitive',
      }),
      makeSquashSession({
        id: 'session-3',
        squashDetails: {
          trainingFocus: 'tactical',
          sessionMode: 'competition_match',
          drills: [{ name: 'Partido objetivo' }],
        },
      }),
    ])

    expect(exposure.practiceMatchCount).toBe(1)
    expect(exposure.competitionMatchCount).toBe(2)
    expect(exposure.totalMatchCount).toBe(3)
  })
})
