import { describe, expect, it } from 'vitest'
import type { ChatContext, CoachAction, Session } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { postProcessCoachActions } from '../ai/actionPostProcessor'

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 'friday-session-123',
    date: partial.date ?? '2026-05-08',
    weekStartDate: partial.weekStartDate ?? '2026-05-04',
    timeBlock: partial.timeBlock ?? 'PM',
    type: partial.type ?? 'running',
    status: partial.status ?? 'planned',
    title: partial.title ?? 'Rodaje Z2',
    durationMin: partial.durationMin ?? 45,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

function makeContext(sessions: Session[] = []): ChatContext {
  return {
    recentSessions: sessions,
    plannedSessions: sessions,
    historicalSessions: [],
    currentWeekSummary: {
      id: 'week-1',
      weekStartDate: '2026-05-04',
      totalSessions: sessions.length,
      totalMinutes: 45,
      plannedSessions: sessions.length,
      completedSessions: 0,
      plannedMinutes: 45,
      completedMinutes: 0,
      squashSessions: 0,
      runningSessions: sessions.length,
      strengthSessions: 0,
      updatedAt: 1,
    },
  }
}

function makeResponse(actions: CoachAction[]): CoachNormalizedResponse {
  return {
    message: 'Te propongo este cambio:',
    actions,
    provider: 'mock',
    traceId: 'trace-1',
    requestClass: 'chat_action',
    timestamp: 1,
  }
}

describe('actionPostProcessor', () => {
  it('pins weekday target dates to the current week before proposals are stored', () => {
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Sumar base',
      targetDate: '2026-05-09',
      timeBlock: 'PM',
      sessionType: 'running',
      title: 'Rodaje',
      durationMin: 45,
    }]), makeContext(), 'Agrega running el viernes PM')

    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-08',
    })
  })

  it('converts add_session drift into update_session when the user is adjusting an existing slot', () => {
    const session = makeSession()
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Ajustar carga',
      targetDate: '2026-05-09',
      timeBlock: 'PM',
      sessionType: 'running',
      title: 'Rodaje suave',
      durationMin: 35,
      objective: 'Bajar fatiga',
    }]), makeContext([session]), 'Ajusta el viernes PM y bajala un poco')

    expect(response.actions?.[0]).toMatchObject({
      type: 'update_session',
      sessionId: session.id,
      newTitle: 'Rodaje suave',
      newObjective: 'Bajar fatiga',
      newDurationMin: 35,
    })
  })

  it('replaces placeholder update_session ids when there is one affected session', () => {
    const session = makeSession()
    const response = postProcessCoachActions(makeResponse([{
      type: 'update_session',
      sessionId: 'ID_DE_8_CHARS',
      reason: 'Bajar carga',
      newDurationMin: 30,
    }]), makeContext([session]), 'Modifica el viernes PM')

    expect(response.actions?.[0]).toMatchObject({
      type: 'update_session',
      sessionId: session.id,
    })
  })
})
