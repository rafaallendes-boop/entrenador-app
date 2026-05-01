import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import {
  getRecentSquashCompetitiveExposure,
  isCompetitionSquashMatch,
  isPracticeSquashMatch,
  resolveSquashSessionKind,
} from '../squash'

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
        drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos' }],
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
          drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos' }],
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

  it('uses the most recent matches when applying the exposure limit', () => {
    const exposure = getRecentSquashCompetitiveExposure([
      makeSquashSession({
        id: 'older-practice',
        date: '2026-04-01',
        squashDetails: {
          trainingFocus: 'tactical',
          sessionMode: 'practice_match',
          drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos' }],
        },
      }),
      makeSquashSession({
        id: 'older-competition',
        date: '2026-04-02',
        subtype: 'competitive',
      }),
      makeSquashSession({
        id: 'latest-practice',
        date: '2026-04-10',
        squashDetails: {
          trainingFocus: 'tactical',
          sessionMode: 'practice_match',
          drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos' }],
        },
      }),
      makeSquashSession({
        id: 'latest-competition',
        date: '2026-04-11',
        subtype: 'competitive',
      }),
    ], 2)

    expect(exposure.practiceMatchCount).toBe(1)
    expect(exposure.competitionMatchCount).toBe(1)
    expect(exposure.totalMatchCount).toBe(2)
  })

  it('derives control, shadows and mixed kinds from legacy-compatible squash details', () => {
    const control = makeSquashSession({
      subtype: 'control',
      squashDetails: {
        trainingFocus: 'technical',
        drills: [{ name: '100 dejadas solo', durationMin: 18 }],
      },
    })
    const shadows = makeSquashSession({
      subtype: 'training',
      squashDetails: {
        trainingFocus: 'physical',
        drills: [{ name: 'Desplazamientos sin pelota a cuatro esquinas', durationMin: 16 }],
      },
    })
    const mixed = makeSquashSession({
      subtype: 'training',
      squashDetails: {
        trainingFocus: 'technical',
        sessionKind: 'mixed',
        blocks: [
          { kind: 'shadows', durationMin: 18, drills: [{ name: 'Desplazamientos sin pelota a cuatro esquinas', durationMin: 18 }] },
          { kind: 'control', durationMin: 24, drills: [{ name: '100 dejadas solo', durationMin: 24 }] },
        ],
        drills: [
          { name: 'Desplazamientos sin pelota a cuatro esquinas', durationMin: 18 },
          { name: '100 dejadas solo', durationMin: 24 },
        ],
      },
    })

    expect(resolveSquashSessionKind(control)).toBe('control')
    expect(resolveSquashSessionKind(shadows)).toBe('shadows')
    expect(resolveSquashSessionKind(mixed)).toBe('mixed')
  })
})
