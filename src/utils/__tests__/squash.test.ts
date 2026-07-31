import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import {
  getRecentSquashCompetitiveExposure,
  hasSquashCompetitiveExposure,
  isCompetitionSquashMatch,
  isPracticeSquashMatch,
  resolveSquashSessionKind,
  resolveSquashSessionMode,
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
    expect(exposure.finisherCount).toBe(0)
    expect(exposure.totalMatchCount).toBe(3)
    expect(exposure.exposureScore).toBe(3)
  })

  it('counts canonical finishers as competitive exposure without reclassifying them as matches', () => {
    const standalone = makeSquashSession({
      subtype: 'match',
      squashDetails: {
        trainingFocus: 'tactical',
        sessionMode: 'practice_match',
        sessionKind: 'match',
        drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos' }],
      },
    })
    const finisher = makeSquashSession({
      id: 'finisher',
      date: '2026-04-10',
      subtype: 'training',
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'mixed',
        drills: [
          { name: 'Tiros paralelos profundos' },
          { name: 'Partido de entrenamiento al mejor de 3 juegos' },
        ],
        blocks: [
          { kind: 'technical', drills: [{ name: 'Tiros paralelos profundos' }] },
          { kind: 'match', drills: [{ name: 'Partido de entrenamiento al mejor de 3 juegos' }] },
        ],
      },
    })

    expect(hasSquashCompetitiveExposure(standalone)).toBe(true)
    expect(hasSquashCompetitiveExposure(finisher)).toBe(true)
    expect(isCompetitionSquashMatch(finisher)).toBe(false)

    const exposure = getRecentSquashCompetitiveExposure([standalone, finisher], 6)
    expect(exposure).toMatchObject({
      practiceMatchCount: 1,
      competitionMatchCount: 0,
      finisherCount: 1,
      totalMatchCount: 2,
      exposureScore: 2,
    })
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
    expect(exposure.finisherCount).toBe(0)
    expect(exposure.totalMatchCount).toBe(2)
  })

  it('derives control, shadows and mixed kinds from legacy-compatible squash details', () => {
    const control = makeSquashSession({
      subtype: 'control',
      squashDetails: {
        trainingFocus: 'technical',
        drills: [{ name: '100 drops en solitario (50 por lado)', durationMin: 18 }],
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
          { kind: 'control', durationMin: 24, drills: [{ name: '100 drops en solitario (50 por lado)', durationMin: 24 }] },
        ],
        drills: [
          { name: 'Desplazamientos sin pelota a cuatro esquinas', durationMin: 18 },
          { name: '100 drops en solitario (50 por lado)', durationMin: 24 },
        ],
      },
    })

    expect(resolveSquashSessionKind(control)).toBe('control')
    expect(resolveSquashSessionKind(shadows)).toBe('shadows')
    expect(resolveSquashSessionKind(mixed)).toBe('mixed')
  })

  it('does not treat shadow/control blocks as match-play even if legacy metadata says practice_match', () => {
    const session = makeSquashSession({
      subtype: 'match',
      title: 'Squash - Sombras y Salidas',
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'practice_match',
        sessionKind: 'match',
        blocks: [
          { kind: 'shadows', drills: [{ name: 'Split-step y vuelta a la T' }] },
          { kind: 'control', drills: [{ name: 'Voleas en solitario' }] },
        ],
        drills: [
          { name: 'Split-step y vuelta a la T' },
          { name: 'Voleas en solitario' },
        ],
      },
    })

    expect(resolveSquashSessionMode(session.squashDetails)).toBe('drill_session')
    expect(resolveSquashSessionKind(session)).toBe('mixed')
    expect(isPracticeSquashMatch(session)).toBe(false)
  })

  it('treats mixed drill sessions with a final match block as drills, not full match-play', () => {
    const session = makeSquashSession({
      subtype: 'match',
      title: 'Squash - Aplicación Táctica',
      squashDetails: {
        trainingFocus: 'tactical',
        sessionMode: 'practice_match',
        sessionKind: 'mixed',
        blocks: [
          { kind: 'technical', drills: [{ name: 'Ataque desde tres cuartos de cancha' }] },
          { kind: 'match', drills: [{ name: 'Partido de entrenamiento al mejor de 3 juegos' }] },
        ],
        drills: [
          { name: 'Ataque desde tres cuartos de cancha' },
          { name: 'Partido de entrenamiento al mejor de 3 juegos' },
        ],
      },
    })

    expect(resolveSquashSessionMode(session.squashDetails)).toBe('drill_session')
    expect(resolveSquashSessionKind(session)).toBe('mixed')
    expect(isPracticeSquashMatch(session)).toBe(false)
  })
})
