import { afterEach, describe, expect, it, vi } from 'vitest'
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

function makeContext(sessions: Session[] = [], partial: Partial<ChatContext> = {}): ChatContext {
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
    ...partial,
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
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('does not treat a weekday marked as rest as the target date', () => {
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Sumar running',
      targetDate: '2026-05-09',
      timeBlock: 'PM',
      sessionType: 'running',
      title: 'Rodaje',
      durationMin: 45,
    }]), makeContext(), 'Agrega running y deja el sábado como descanso')

    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-09',
    })
  })

  it('does not collapse create_week session dates into one mentioned weekday', () => {
    const response = postProcessCoachActions(makeResponse([{
      type: 'create_week',
      reason: 'Semana completa',
      targetDate: '2026-05-04',
      sessions: [
        { date: '2026-05-05', timeBlock: 'AM', sessionType: 'running', title: 'Rodaje', durationMin: 45 },
        { date: '2026-05-07', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza', durationMin: 50 },
      ],
    }]), makeContext(), 'Planifica la semana, con foco fuerte el viernes')

    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-05-04',
      sessions: [
        { date: '2026-05-05' },
        { date: '2026-05-07' },
      ],
    })
  })

  it('keeps added sessions inside next week and away from rest days', () => {
    const response = postProcessCoachActions(makeResponse([
      {
        type: 'add_session',
        reason: 'Running extra',
        targetDate: '2026-05-16',
        timeBlock: 'PM',
        sessionType: 'running',
        title: 'Running umbral',
        durationMin: 50,
      },
      {
        type: 'add_session',
        reason: 'Running extra',
        targetDate: '2026-05-16',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Running Z2',
        durationMin: 45,
      },
      {
        type: 'add_session',
        reason: 'Fuerza extra',
        targetDate: '2026-05-16',
        timeBlock: 'PM',
        sessionType: 'strength',
        title: 'Fuerza',
        durationMin: 50,
      },
    ]), makeContext(), 'Para mi próxima semana agrega 2 running y 1 fuerza, dejando el sábado como descanso')

    const actions = response.actions ?? []
    const addSessionActions = actions.filter((action): action is CoachAction & { type: 'add_session'; targetDate: string } =>
      action.type === 'add_session' && typeof action.targetDate === 'string',
    )
    expect(actions).toHaveLength(3)
    expect(addSessionActions).toHaveLength(3)
    expect(addSessionActions.every((action) =>
      action.targetDate >= '2026-05-11' &&
      action.targetDate <= '2026-05-17',
    )).toBe(true)
    expect(addSessionActions.some((action) => action.targetDate === '2026-05-16')).toBe(false)
    expect(new Set(addSessionActions.map((action) => `${action.targetDate}|${action.timeBlock}`)).size).toBe(3)
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

  it('fills missing strength weight from targetPercent1RM when profile has a matching 1RM', () => {
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Sumar fuerza',
      targetDate: '2026-05-08',
      timeBlock: 'PM',
      sessionType: 'strength',
      title: 'Fuerza lower',
      durationMin: 60,
      exercises: [
        { name: 'Sentadilla', sets: 4, reps: 6, targetPercent1RM: 80 },
        { name: 'Hip thrust con barra', sets: 3, reps: 8, targetPercent1RM: 75 },
      ],
    }]), makeContext([], {
      athleteProfile: {
        id: 'athlete-1',
        updatedAt: 1,
        strengthProfile: { squat1RM: 140 },
      },
    }), 'Agrega fuerza el viernes PM')

    expect(response.actions?.[0].type).toBe('add_session')
    expect(response.actions?.[0].exercises?.find((exercise) => exercise.name === 'Sentadilla')).toMatchObject({
      weight: 112.5,
    })
    expect(response.actions?.[0].exercises?.find((exercise) => exercise.name === 'Hip thrust con barra')).toMatchObject({
      weight: 125,
    })
    expect(response.actions?.[0].exercises?.[0]).toMatchObject({ group: 'core' })
  })

  it('does not derive pull-up weight from max reps reference', () => {
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Sumar fuerza',
      targetDate: '2026-05-08',
      timeBlock: 'PM',
      sessionType: 'strength',
      title: 'Fuerza upper',
      durationMin: 60,
      exercises: [
        { name: 'Dominadas pronadas', sets: 4, reps: 6, targetPercent1RM: 80 },
      ],
    }]), makeContext([], {
      athleteProfile: {
        id: 'athlete-1',
        updatedAt: 1,
        strengthProfile: { pullUpMaxReps: 14 },
      },
    }), 'Agrega fuerza el viernes PM')

    expect(response.actions?.[0].type).toBe('add_session')
    const pullUp = response.actions?.[0].exercises?.find((exercise) => exercise.name === 'Dominadas pronadas')
    expect(pullUp).toMatchObject({ name: 'Dominadas pronadas', targetPercent1RM: 80 })
    expect(pullUp?.weight).toBeUndefined()
  })

  it('builds a real strength add_session when the model replies with text only', () => {
    vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z'))

    const response = postProcessCoachActions({
      message: 'Para mañana te propongo una sesión de fuerza en texto, pero sin acciones.',
      provider: 'mock',
      traceId: 'trace-1',
      requestClass: 'chat_action',
      timestamp: 1,
    }, makeContext([], {
      athleteProfile: {
        id: 'athlete-1',
        updatedAt: 1,
        sportContext: { primarySport: 'squash' },
        strengthProfile: {
          deadlift1RM: 150,
          squat1RM: 140,
          benchPress1RM: 100,
          overheadPress1RM: 60,
        },
      },
    }), 'crea una sesión de fuerza para mañana')

    const action = response.actions?.[0]
    expect(action).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-25',
      timeBlock: 'PM',
      sessionType: 'strength',
      durationMin: 60,
    })
    expect(action?.exercises?.length).toBeGreaterThanOrEqual(8)
    expect(action?.exercises?.slice(0, 2).every((exercise) => exercise.group === 'core')).toBe(true)
    expect(action?.exercises?.some((exercise) => exercise.weight != null)).toBe(true)
    expect(response.fallbackUsed).toBe(true)
    expect(response.meta?.warnings).toContain('chat_action_without_actions_repaired')
  })
})
