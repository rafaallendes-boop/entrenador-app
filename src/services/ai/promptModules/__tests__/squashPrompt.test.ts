import { describe, expect, it } from 'vitest'

import type { ChatContext, Session } from '../../../../types'
import { buildSquashMatchHistorySection } from '../squashPrompt'

function finisherSession(): Session {
  return {
    id: 'finisher',
    date: '2026-07-20',
    timeBlock: 'AM',
    type: 'squash',
    subtype: 'training',
    title: 'Squash con cierre competitivo',
    durationMin: 75,
    status: 'completed',
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
  }
}

describe('buildSquashMatchHistorySection', () => {
  it('exposes a recent finisher even when there are no completed standalone matches', () => {
    const context: ChatContext = {
      athleteProfile: {
        id: 'athlete',
        updatedAt: 0,
        sportContext: { enabledSports: ['squash'], primarySport: 'squash' },
      },
      recentSessions: [],
      historicalSessions: [finisherSession()],
    }

    expect(buildSquashMatchHistorySection(context)).toContain(
      'Exposicion reciente: 0 practice match / 0 competencia real / 1 cierre competitivo en sesion de drills.',
    )
  })
})
