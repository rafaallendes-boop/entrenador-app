import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, CoachAction, Session } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { postProcessCoachActions } from '../ai/actionPostProcessor'
import { findSquashDrillByName, resolveSquashDrillKind } from '../training/drillLibrary'

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

  it('uses the next weekday occurrence when the named day already passed', () => {
    vi.setSystemTime(new Date('2026-07-26T12:00:00'))
    const context = makeContext([], {
      currentWeekSummary: {
        id: 'week-2026-07-20',
        weekStartDate: '2026-07-20',
        totalSessions: 0,
        totalMinutes: 0,
        plannedSessions: 0,
        completedSessions: 0,
        plannedMinutes: 0,
        completedMinutes: 0,
        squashSessions: 0,
        runningSessions: 0,
        strengthSessions: 0,
        updatedAt: 1,
      },
    })

    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Running pedido para el martes',
      targetDate: '2026-07-21',
      timeBlock: 'PM',
      sessionType: 'running',
      title: 'Running Z2',
      durationMin: 45,
    }]), context, 'Agregame una sesión de running para el martes')

    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      targetDate: '2026-07-28',
    })
  })

  it('reconciles multiple moves with real future-session ids and requested dates', () => {
    vi.setSystemTime(new Date('2026-07-26T12:00:00'))
    const strength = makeSession({
      id: 'real-strength-id',
      date: '2026-07-28',
      weekStartDate: '2026-07-27',
      type: 'strength',
      title: 'Fuerza',
    })
    const running = makeSession({
      id: 'real-running-id',
      date: '2026-07-29',
      weekStartDate: '2026-07-27',
      type: 'running',
      title: 'Running',
    })
    const context = makeContext([strength, running], {
      currentWeekSummary: {
        id: 'week-2026-07-20',
        weekStartDate: '2026-07-20',
        totalSessions: 0,
        totalMinutes: 0,
        plannedSessions: 0,
        completedSessions: 0,
        plannedMinutes: 0,
        completedMinutes: 0,
        squashSessions: 0,
        runningSessions: 0,
        strengthSessions: 0,
        updatedAt: 1,
      },
    })

    const response = postProcessCoachActions(makeResponse([
      {
        type: 'move_session',
        sessionId: 'invented-1',
        targetDate: '2026-07-20',
        reason: 'Mover fuerza',
      },
      {
        type: 'move_session',
        sessionId: 'invented-2',
        targetDate: '2026-07-21',
        reason: 'Mover running',
      },
    ]), context, 'Mover la fuerza del martes para el lunes y el running del miércoles al martes')

    expect(response.actions).toEqual([
      expect.objectContaining({
        type: 'move_session',
        sessionId: strength.id,
        targetDate: '2026-07-27',
      }),
      expect.objectContaining({
        type: 'move_session',
        sessionId: running.id,
        targetDate: '2026-07-28',
      }),
    ])
    expect(response.meta?.warnings).toContain('chat_action_move_sessions_reconciled')
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

  it('repairs a text-only multi-day next-week request into one action per requested session', () => {
    const response = postProcessCoachActions({
      message: 'Entendido. Agregare fuerza el lunes y running Zona 2 el martes.',
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
    }), 'Para la próxima semana, agrega una sesión de pesas para el lunes, y el martes deja un running en zona 2')

    const actions = response.actions ?? []
    const strength = actions.find(action => action.type === 'add_session' && action.sessionType === 'strength')
    const running = actions.find(action => action.type === 'add_session' && action.sessionType === 'running')

    expect(actions).toHaveLength(2)
    expect(strength).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-11',
      sessionType: 'strength',
      timeBlock: 'PM',
    })
    expect(strength?.exercises?.length).toBeGreaterThan(0)
    expect(running).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-12',
      sessionType: 'running',
      runningType: 'z2',
      title: 'Running Z2 suave',
      rpe: 4,
      targetHrMin: 62,
      targetHrMax: 72,
    })
    expect(response.meta?.warnings).toContain('chat_action_without_actions_repaired')
  })

  it('adds the missing requested session when the model returns only one action from a multi-day request', () => {
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Fuerza pedida para la proxima semana.',
      targetDate: '2026-05-04',
      timeBlock: 'PM',
      sessionType: 'strength',
      title: 'Fuerza estructurada',
      durationMin: 60,
      rpe: 7,
    }]), makeContext(), 'Para la próxima semana, agrega una sesión de pesas para el lunes, y el martes deja un running en zona 2')

    const actions = response.actions ?? []
    const strength = actions.find(action => action.type === 'add_session' && action.sessionType === 'strength')
    const running = actions.find(action => action.type === 'add_session' && action.sessionType === 'running')

    expect(actions).toHaveLength(2)
    expect(strength).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-11',
      sessionType: 'strength',
    })
    expect(running).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-12',
      sessionType: 'running',
      runningType: 'z2',
    })
    expect(response.meta?.warnings).toContain('chat_action_missing_requested_sessions_repaired')
  })

  it('keeps a Thursday weights request from leaking into Friday recommendations', () => {
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'))
    const fridayStrength = makeSession({
      id: 'friday-strength',
      date: '2026-08-07',
      weekStartDate: '2026-08-03',
      timeBlock: 'PM',
      type: 'strength',
      title: 'Fuerza estructurada',
    })
    const context = makeContext([fridayStrength], {
      currentWeekSummary: {
        id: 'week-2026-08-03',
        weekStartDate: '2026-08-03',
        totalSessions: 1,
        totalMinutes: 45,
        plannedSessions: 1,
        completedSessions: 0,
        plannedMinutes: 45,
        completedMinutes: 0,
        squashSessions: 0,
        runningSessions: 0,
        strengthSessions: 1,
        updatedAt: 1,
      },
    })

    const response = postProcessCoachActions({
      message: 'Entendido, ajustaré las sesiones indicadas.',
      provider: 'mock',
      traceId: 'trace-1',
      requestClass: 'chat_action',
      timestamp: 1,
    }, context, 'Ajusta mi semana, para mañana deja solo 1 partido de squash en horario PM. Jueves créame una sesión de pesas y para viernes y sábado recomiéndame algún entrenamiento')

    expect(response.actions).toEqual([
      expect.objectContaining({
        type: 'add_session',
        targetDate: '2026-08-06',
        timeBlock: 'PM',
        sessionType: 'strength',
      }),
    ])
    expect(response.actions?.some((action) => (
      action.type === 'add_session' && action.targetDate === '2026-08-07' && action.sessionType === 'strength'
    ))).toBe(false)
  })

  it('removes an add_session that collides with an occupied slot', () => {
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'))
    const occupiedFridayAm = makeSession({
      id: 'friday-squash',
      date: '2026-08-07',
      weekStartDate: '2026-08-03',
      timeBlock: 'AM',
      type: 'squash',
      title: 'Squash',
    })
    const occupiedFridayPm = makeSession({
      id: 'friday-strength',
      date: '2026-08-07',
      weekStartDate: '2026-08-03',
      timeBlock: 'PM',
      type: 'strength',
      title: 'Fuerza estructurada',
    })
    const context = makeContext([occupiedFridayAm, occupiedFridayPm], {
      currentWeekSummary: {
        id: 'week-2026-08-03',
        weekStartDate: '2026-08-03',
        totalSessions: 2,
        totalMinutes: 105,
        plannedSessions: 2,
        completedSessions: 0,
        plannedMinutes: 105,
        completedMinutes: 0,
        squashSessions: 1,
        runningSessions: 0,
        strengthSessions: 1,
        updatedAt: 1,
      },
    })

    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Añadir fuerza',
      targetDate: '2026-08-07',
      timeBlock: 'PM',
      sessionType: 'strength',
      title: 'Fuerza extra',
      durationMin: 60,
    }]), context, 'Agrega fuerza el viernes PM')

    expect(response.actions).toEqual([])
    expect(response.meta?.warnings).toContain('chat_action_occupied_slot_actions_removed')
    expect(response.message).toContain('bloque ya estaba ocupado')
  })

  it('inherits the recent next-week weekday when a short follow-up asks to add the running session', () => {
    const response = postProcessCoachActions({
      message: 'Te propongo este cambio:',
      provider: 'mock',
      traceId: 'trace-1',
      requestClass: 'chat_action',
      timestamp: 1,
    }, makeContext([], {
      recentMessages: [
        { role: 'user', content: 'Para la próxima semana, agrega una sesión de pesas para el lunes, y el martes deja un running en zona 2' },
        { role: 'coach', content: 'Entendido, preparo esos cambios.' },
        { role: 'user', content: 'El running es para el martes de la próxima semana' },
      ],
    }), 'agrega la sesión de running')

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-12',
      sessionType: 'running',
      runningType: 'z2',
      title: 'Running Z2 suave',
    })
    expect(response.meta?.warnings).toContain('chat_action_without_actions_repaired')
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

  it('replaces placeholder delete_session and skip_session ids when there is one affected session', () => {
    const session = makeSession()

    const responseDelete = postProcessCoachActions(makeResponse([{
      type: 'delete_session',
      sessionId: 'placeholder-id',
      reason: 'Eliminación directa',
    }]), makeContext([session]), 'Borra el entreno del viernes PM')

    expect(responseDelete.actions?.[0]).toMatchObject({
      type: 'delete_session',
      sessionId: session.id,
    })

    const responseSkip = postProcessCoachActions(makeResponse([{
      type: 'skip_session',
      sessionId: 'placeholder-id',
      reason: 'Saltear entreno',
    }]), makeContext([session]), 'Saltea el entreno del viernes PM')

    expect(responseSkip.actions?.[0]).toMatchObject({
      type: 'skip_session',
      sessionId: session.id,
    })
  })

  it('repairs a confirmed delete-only replacement into a running Z2 update', () => {
    const session = makeSession({
      id: 'squash-match-1',
      type: 'squash',
      timeBlock: 'AM',
      title: 'Squash - Simulacion de partido',
      durationMin: 60,
      rpe: 9,
    })

    const response = postProcessCoachActions(makeResponse([{
      type: 'delete_session',
      sessionId: session.id,
      reason: 'Eliminar la sesion de squash confirmada por el usuario',
    }]), makeContext([session], {
      recentMessages: [
        { role: 'user', content: 'Realiza un cambio en mi sesion del viernes, quiero realizar una corrida en zona 2' },
        { role: 'coach', content: 'Confirmas que quieres reemplazar la sesion de squash del viernes AM por una corrida en Zona 2?' },
      ],
    }), 'si, realiza el cambio')

    expect(response.actions?.[0]).toMatchObject({
      type: 'update_session',
      sessionId: session.id,
      newType: 'running',
      runningType: 'z2',
      newTitle: 'Running Z2 suave',
      newRpe: 4,
      targetHrMin: 62,
      targetHrMax: 72,
    })
    expect(response.message).toContain('Running Z2')
    expect(response.meta?.warnings).toContain('chat_action_delete_only_repaired_to_running_replacement')
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
    expect(pullUp).toMatchObject({ name: 'Dominadas pronadas' })
    expect(pullUp?.targetPercent1RM).toBeUndefined()
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

  it('rebuilds the requested session when the user confirms it with "créala"', () => {
    const response = postProcessCoachActions({
      message: 'He creado la sesión.',
      provider: 'mock',
      traceId: 'trace-creation-confirmation',
      requestClass: 'chat_action',
      timestamp: 1,
    }, makeContext([], {
      recentMessages: [
        { role: 'user', content: 'Créame una sesión de fuerza con superseries para el lunes de la próxima semana.' },
        { role: 'coach', content: 'Aquí tienes la sesión de fuerza con superseries para el lunes, como una acción para revisar y aplicar.' },
      ],
    }), 'créala')

    const action = response.actions?.[0]
    expect(action).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-11',
      sessionType: 'strength',
      durationMin: 60,
    })
    expect(action?.exercises?.length).toBeGreaterThan(0)
    expect(action?.exercises?.some((exercise) => exercise.supersetGroup != null)).toBe(true)
    expect(response.meta?.warnings).toContain('chat_action_without_actions_repaired')
  })

  it('builds requested weights tomorrow and avoids an occupied squash PM slot', () => {
    vi.setSystemTime(new Date('2026-06-07T12:00:00.000Z'))
    const squashPm = makeSession({
      id: 'monday-squash-pm',
      date: '2026-06-08',
      weekStartDate: '2026-06-08',
      timeBlock: 'PM',
      type: 'squash',
      title: 'Squash técnico',
      durationMin: 60,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: 'Tiros paralelos profundos' }],
      },
    })

    const response = postProcessCoachActions({
      message: 'Aquí tienes la sesión de fuerza para mañana lunes.',
      provider: 'mock',
      traceId: 'trace-1',
      requestClass: 'chat_action',
      timestamp: 1,
    }, makeContext([squashPm], {
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
    }), 'Dame la sesión de pesas para mañana lunes')

    const action = response.actions?.[0]
    expect(action).toMatchObject({
      type: 'add_session',
      targetDate: '2026-06-08',
      timeBlock: 'AM',
      sessionType: 'strength',
      title: 'Fuerza estructurada',
      durationMin: 60,
    })
    expect(action?.exercises?.length).toBeGreaterThanOrEqual(8)
  })

  it('does not create an explicit tomorrow request when both slots are occupied', () => {
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'))
    const occupiedTomorrow = [
      makeSession({
        id: 'tuesday-am',
        date: '2026-06-30',
        weekStartDate: '2026-06-29',
        timeBlock: 'AM',
        type: 'squash',
        title: 'Squash AM',
      }),
      makeSession({
        id: 'tuesday-pm',
        date: '2026-06-30',
        weekStartDate: '2026-06-29',
        timeBlock: 'PM',
        type: 'strength',
        title: 'Fuerza PM',
      }),
    ]

    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'El modelo eligió hoy, pero el usuario pidió mañana.',
      targetDate: '2026-06-29',
      timeBlock: 'PM',
      sessionType: 'running',
      title: 'Running suave',
      durationMin: 45,
    }]), makeContext(occupiedTomorrow, {
      currentWeekSummary: {
        id: 'week-2026-06-29',
        weekStartDate: '2026-06-29',
        totalSessions: occupiedTomorrow.length,
        totalMinutes: 105,
        plannedSessions: occupiedTomorrow.length,
        completedSessions: 0,
        plannedMinutes: 105,
        completedMinutes: 0,
        squashSessions: 1,
        runningSessions: 0,
        strengthSessions: 1,
        updatedAt: 1,
      },
    }), 'Hazme un entrenamiento de running para mañana')

    expect(response.actions).toEqual([])
    expect(response.meta?.warnings).toContain('chat_action_occupied_slot_actions_removed')
  })

  it('overrides model sport drift when a single-session request explicitly asks for weights', () => {
    vi.setSystemTime(new Date('2026-06-07T12:00:00.000Z'))

    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'El modelo confundió el contexto de squash con la solicitud puntual.',
      targetDate: '2026-06-08',
      timeBlock: 'PM',
      sessionType: 'squash',
      title: 'Squash técnico',
      durationMin: 60,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: 'Tiros paralelos profundos' }],
      },
    }]), makeContext(), 'Dame la sesión de pesas para mañana lunes')

    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      targetDate: '2026-06-08',
      sessionType: 'strength',
      title: 'Fuerza estructurada',
    })
    expect(response.actions?.[0].squashDetails).toBeUndefined()
    expect(response.actions?.[0].exercises?.length).toBeGreaterThan(0)
  })

  it('repairs a truncated single-session action response with a local proposal', () => {
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'))

    const response = postProcessCoachActions({
      message: 'Para hoy te preparo una sesión de fuerza, pero el bloque de acciones llegó incompleto.',
      provider: 'mock',
      traceId: 'trace-1',
      requestClass: 'chat_action',
      timestamp: 1,
      meta: {
        hadActionsMarkup: true,
        actionParseFailed: true,
        likelyTruncated: true,
        outcome: 'truncated_early',
      },
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
    }), 'genera una sesión de pesas par ahoy')

    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      targetDate: '2026-05-25',
      sessionType: 'strength',
    })
    expect(response.meta?.actionParseFailed).toBe(false)
    expect(response.meta?.likelyTruncated).toBe(false)
    expect(response.meta?.warnings).toEqual(expect.arrayContaining([
      'chat_action_without_actions_repaired',
      'chat_action_malformed_response_repaired',
    ]))
  })

  it('hydrates compact technical squash without reading “control de longitud” as modality', () => {
    vi.setSystemTime(new Date('2026-05-04T12:00:00.000Z'))
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Trabajo cooperativo',
      targetDate: '2026-05-05',
      timeBlock: 'PM',
      sessionType: 'squash',
      squashKind: 'technical',
      title: 'Squash técnico',
      durationMin: 60,
      objective: 'Construir control de longitud con ejecución limpia.',
    }]), makeContext(), 'Agrega squash mañana para trabajar control de longitud con partner')

    const action = response.actions?.[0]
    expect(action).toMatchObject({ type: 'add_session', squashKind: 'technical', subtype: 'training' })
    const kinds = action?.squashDetails?.drills.map((drill) =>
      resolveSquashDrillKind(findSquashDrillByName(drill.name)!),
    )
    expect(kinds?.length).toBeGreaterThan(0)
    expect(kinds?.every((kind) => kind === 'technical')).toBe(true)
  })

  it.each([
    ['control', 'solo'],
    ['technical', 'partner'],
    ['shadows', 'solo'],
    ['match', 'match'],
  ] as const)('hydrates compact squashKind=%s with compatible execution', (squashKind, executionMode) => {
    const context = squashKind === 'match'
      ? makeContext([], {
          athleteProfile: {
            id: 'athlete-squash',
            updatedAt: 1,
            macroPlan: { currentPhase: 'build' } as never,
          },
        })
      : makeContext()
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Modalidad explícita',
      targetDate: '2026-05-05',
      timeBlock: 'PM',
      sessionType: 'squash',
      squashKind,
      title: 'Squash',
      durationMin: 45,
      objective: 'Trabajo específico.',
    }]), context, 'Agrega una sesión de squash mañana')

    const action = response.actions?.[0]
    expect(action?.squashDetails?.sessionKind).toBe(squashKind)
    expect(action?.squashDetails?.drills.length).toBeGreaterThan(0)
    expect(action?.squashDetails?.drills.every((drill) => drill.executionMode === executionMode)).toBe(true)
  })

  it('preserves a known compatible drill requested for the declared modality', () => {
    const drillName = 'Paralelas de derecha — 100'
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Petición explícita compatible',
      targetDate: '2026-05-05',
      timeBlock: 'PM',
      sessionType: 'squash',
      squashKind: 'control',
      title: 'Squash control',
      durationMin: 45,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'control',
        drills: [{ name: drillName }],
      },
    }]), makeContext(), `Agrega squash mañana con ${drillName}`)

    expect(response.actions?.[0].squashDetails?.drills.map((drill) => drill.name)).toEqual([drillName])
    expect(response.actions?.[0].squashDetails?.sessionKind).toBe('control')
    expect(response.meta?.warnings).toBeUndefined()
  })

  it('preserves an explicitly requested incompatible drill and emits an actionable warning', () => {
    const drillName = 'Volea de control desde media cancha'
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Petición explícita',
      targetDate: '2026-05-05',
      timeBlock: 'PM',
      sessionType: 'squash',
      squashKind: 'control',
      title: 'Squash control',
      durationMin: 45,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'technical',
        drills: [{ name: drillName }],
      },
    }]), makeContext(), `Agrega squash mañana con ${drillName}`)

    expect(response.actions?.[0].squashDetails?.drills.map((drill) => drill.name)).toEqual([drillName])
    expect(response.meta?.warnings).toContain('squash_explicit_drill_incompatible_preserved')
    expect(response.message).toContain('Revísalo antes de aplicar')
  })

  it('preserves squashKind when add_session is converted to update_session', () => {
    const current = makeSession({
      id: 'squash-current-123',
      type: 'squash',
      title: 'Squash técnico',
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'technical',
        drills: [{ name: 'Tiros paralelos profundos' }],
      },
    })
    const response = postProcessCoachActions(makeResponse([{
      type: 'add_session',
      reason: 'Cambiar modalidad',
      targetDate: current.date,
      timeBlock: current.timeBlock,
      sessionType: 'squash',
      squashKind: 'shadows',
      title: 'Sombras',
      durationMin: 40,
    }]), makeContext([current]), 'Cambia la sesión de squash del viernes a sombras')

    expect(response.actions?.[0]).toMatchObject({
      type: 'update_session',
      sessionId: current.id,
      squashKind: 'shadows',
      squashDetails: expect.objectContaining({ sessionKind: 'shadows' }),
    })
  })

  describe('modalidad de squash en update_session sin intención nueva', () => {
    function shadowsSession(): Session {
      return makeSession({
        id: 'squash-shadows-1',
        type: 'squash',
        title: 'Sombras',
        durationMin: 40,
        subtype: 'training',
        squashDetails: {
          trainingFocus: 'physical',
          sessionMode: 'drill_session',
          sessionKind: 'shadows',
          drills: [{ name: 'Sombras por esquinas', durationMin: 40 }],
        },
      })
    }

    it('conserva la modalidad persistida cuando subtype solo repite su proyección', () => {
      const current = shadowsSession()
      const response = postProcessCoachActions(makeResponse([{
        type: 'update_session',
        sessionId: current.id,
        reason: 'acortar',
        newDurationMin: 30,
        subtype: 'training',
      }]), makeContext([current]), 'Deja la sesión de sombras del miércoles en 30 minutos')

      expect(response.actions?.[0]).not.toMatchObject({ squashKind: 'technical' })
      expect(response.actions?.[0]?.squashDetails).toBeUndefined()
    })

    it('aplica la modalidad nueva cuando subtype sí contradice la persistida', () => {
      const current = shadowsSession()
      const response = postProcessCoachActions(makeResponse([{
        type: 'update_session',
        sessionId: current.id,
        reason: 'cambiar a partido',
        subtype: 'match',
      }]), makeContext([current]), 'Cambia la sesión del miércoles a partido')

      expect(response.actions?.[0]).toMatchObject({
        squashKind: 'match',
        squashDetails: expect.objectContaining({ sessionKind: 'match' }),
      })
    })

    it('no filtra códigos internos de fallback al mensaje del usuario', () => {
      const current = shadowsSession()
      const response = postProcessCoachActions(makeResponse([{
        type: 'update_session',
        sessionId: current.id,
        reason: 'cambiar a partido',
        subtype: 'match',
      }]), makeContext([current]), 'Cambia la sesión del miércoles a partido')

      expect(response.message).not.toContain('fallback de compatibilidad')
      expect(response.message).not.toContain('no declaró squashKind')
    })
  })

  describe('modalidad de squash en create_week', () => {
    it('materializa squashDetails cuando la sesión sólo declara squashKind', () => {
      const response = postProcessCoachActions(makeResponse([{
        type: 'create_week',
        reason: 'semana nueva',
        sessions: [{
          date: '2026-05-05',
          timeBlock: 'AM',
          sessionType: 'squash',
          title: 'Control',
          durationMin: 45,
          squashKind: 'control',
        }],
      } as CoachAction]), makeContext([]), 'Arma la semana con una sesión de control')

      expect(response.actions?.[0]?.sessions?.[0]?.squashDetails).toMatchObject({
        sessionKind: 'control',
      })
      expect(response.actions?.[0]?.sessions?.[0]?.squashDetails?.drills?.length ?? 0)
        .toBeGreaterThan(0)
    })

    it('rehidrata detalles del proveedor que contradicen squashKind', () => {
      const response = postProcessCoachActions(makeResponse([{
        type: 'create_week',
        reason: 'semana nueva',
        sessions: [{
          date: '2026-05-05',
          timeBlock: 'AM',
          sessionType: 'squash',
          title: 'Control',
          durationMin: 45,
          squashKind: 'control',
          squashDetails: {
            trainingFocus: 'technical',
            sessionMode: 'drill_session',
            sessionKind: 'technical',
            drills: [{ name: 'Boast ofensivo desde el fondo', durationMin: 45 }],
          },
        }],
      }]), makeContext([]), 'Arma una semana con una sesión de control')

      const session = response.actions?.[0]?.sessions?.[0]
      expect(session?.squashDetails?.sessionKind).toBe('control')
      expect(session?.squashDetails?.drills.every((drill) =>
        resolveSquashDrillKind(findSquashDrillByName(drill.name)!) === 'control',
      )).toBe(true)
      expect(response.meta?.warnings).toContain('squash_provider_drill_conflict_rehydrated')
      expect(response.message).toContain('Alineé la sesión')
    })

    it('acumula los drills hidratados para evitar repetidos dentro de la semana', () => {
      const response = postProcessCoachActions(makeResponse([{
        type: 'create_week',
        reason: 'semana nueva',
        sessions: [
          {
            date: '2026-05-05', timeBlock: 'AM', sessionType: 'squash',
            title: 'Control 1', durationMin: 45, squashKind: 'control',
          },
          {
            date: '2026-05-07', timeBlock: 'AM', sessionType: 'squash',
            title: 'Control 2', durationMin: 45, squashKind: 'control',
          },
        ],
      }]), makeContext([]), 'Arma una semana con dos sesiones distintas de control')

      const sessions = response.actions?.[0]?.sessions ?? []
      const first = new Set(sessions[0]?.squashDetails?.drills.map((drill) => drill.name) ?? [])
      const second = sessions[1]?.squashDetails?.drills.map((drill) => drill.name) ?? []
      expect(second.every((name) => !first.has(name))).toBe(true)
    })
  })

  describe('drill explícito incompatible', () => {
    it('estampa la modalidad pedida en squashDetails, no sólo en la acción', () => {
      const response = postProcessCoachActions(makeResponse([{
        type: 'add_session',
        reason: 'pedido explícito',
        targetDate: '2026-05-05',
        timeBlock: 'AM',
        sessionType: 'squash',
        squashKind: 'control',
        title: 'Control',
        durationMin: 45,
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          drills: [{ name: 'Boast ofensivo desde el fondo', durationMin: 45 }],
        },
      }]), makeContext([]), 'Agrega control el lunes con boast ofensivo desde el fondo')

      const action = response.actions?.[0]
      expect(action?.squashKind).toBe('control')
      expect(action?.squashDetails?.sessionKind).toBe('control')
    })
  })
})
