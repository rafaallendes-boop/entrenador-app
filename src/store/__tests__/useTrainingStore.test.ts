import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../types'

vi.mock('../../services/syncService', () => ({
  pushSession: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

vi.mock('../../services/ai/CoachEngine', () => ({
  CoachEngine: { send: vi.fn(async () => ({ message: 'nota generada' })) },
}))

import { db } from '../../db/db'
import { resolveVisibleSessionsAfterUpdate, shouldKeepDayLogInVisibleWeek, useTrainingStore } from '../useTrainingStore'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { currentWeekStartISO } from '../../utils/date'
import { CoachEngine } from '../../services/ai/CoachEngine'
import { buildWeeklyCoachNoteSnapshot } from '../../services/weeklyCoachNote'

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 'session-1',
    date: partial.date ?? '2026-04-07',
    weekStartDate: partial.weekStartDate ?? '2026-04-06',
    timeBlock: partial.timeBlock ?? 'AM',
    type: partial.type ?? 'running',
    status: partial.status ?? 'planned',
    title: partial.title ?? 'Rodaje Z2',
    durationMin: partial.durationMin ?? 45,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

describe('useTrainingStore visibility helpers', () => {
  it('removes a session from the visible week when it moves to another week', () => {
    const visible = [
      makeSession({ id: 's1', weekStartDate: '2026-04-06' }),
      makeSession({ id: 's2', date: '2026-04-08', weekStartDate: '2026-04-06' }),
    ]

    const updated = makeSession({
      id: 's1',
      date: '2026-04-14',
      weekStartDate: '2026-04-13',
    })

    expect(resolveVisibleSessionsAfterUpdate(visible, updated, '2026-04-06')).toEqual([visible[1]])
  })

  it('adds a session to the visible week when an update moves it in', () => {
    const visible = [makeSession({ id: 's2', date: '2026-04-08', weekStartDate: '2026-04-06' })]
    const updated = makeSession({
      id: 's1',
      date: '2026-04-09',
      weekStartDate: '2026-04-06',
    })

    const next = resolveVisibleSessionsAfterUpdate(visible, updated, '2026-04-06')
    expect(next.map((session) => session.id).sort()).toEqual(['s1', 's2'])
  })

  it('only keeps day logs that belong to the loaded week', () => {
    expect(shouldKeepDayLogInVisibleWeek('2026-04-07', '2026-04-06')).toBe(true)
    expect(shouldKeepDayLogInVisibleWeek('2026-04-14', '2026-04-06')).toBe(false)
    expect(shouldKeepDayLogInVisibleWeek('2026-04-07', null)).toBe(false)
  })
})

describe('addSession athlete stamping (Dexie real)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('addSession estampa el atleta activo en la fila creada', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')

    const created = await useTrainingStore.getState().addSession({
      date: '2026-07-06',
      type: 'squash',
      status: 'planned',
      durationMin: 45,
      title: 'Drills',
      timeBlock: 'AM',
    } as never)

    expect(created.athleteId).toBe('ath_m_1')
    expect((await db.sessions.get(created.id))?.athleteId).toBe('ath_m_1')
  })
})

describe('generateCoachNote — solo semana actual (Dexie real)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    useTrainingStore.setState({
      sessions: [],
      dayLogs: {},
      currentWeekSummary: null,
      allWeekSummaries: [],
      isLoading: false,
      loadedWeekStart: null,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('rechaza generar la nota para una semana que no es la actual', async () => {
    const pastWeek = '2020-01-06' // lunes histórico, nunca la semana en curso
    await expect(useTrainingStore.getState().generateCoachNote(pastWeek)).rejects.toThrow(/semana actual/i)
    const stored = await db.weekSummaries.where('weekStartDate').equals(pastWeek).first()
    expect(stored?.coachNote).toBeUndefined()
  })

  it('rechaza generar la nota semanal antes del viernes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-06T12:00:00'))

    await expect(useTrainingStore.getState().generateCoachNote(currentWeekStartISO())).rejects.toThrow(/viernes/i)
  })

  it('genera la nota para la semana actual desde viernes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-10T12:00:00'))

    const note = await useTrainingStore.getState().generateCoachNote(currentWeekStartISO())
    expect(note).toBe('nota generada')
  })

  it('recalcula el resumen antes de generar la nota y guarda su snapshot', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-10T12:00:00'))
    vi.mocked(CoachEngine.send).mockResolvedValueOnce({ message: 'nota actualizada' })

    const weekStart = currentWeekStartISO()
    await db.weekSummaries.put({
      id: 'week-stale',
      athleteId: 'ath_self',
      weekStartDate: weekStart,
      totalSessions: 8,
      totalMinutes: 360,
      plannedSessions: 8,
      completedSessions: 0,
      plannedMinutes: 360,
      completedMinutes: 0,
      adherencePct: 0,
      squashSessions: 0,
      runningSessions: 0,
      strengthSessions: 0,
      coachNote: 'Esta semana no tienes sesiones completadas.',
      updatedAt: 1,
    })
    await db.sessions.bulkPut([
      makeSession({ id: 'sq-1', athleteId: 'ath_self', date: '2026-07-06', weekStartDate: weekStart, type: 'squash', status: 'completed', durationMin: 60 }),
      makeSession({ id: 'sq-2', athleteId: 'ath_self', date: '2026-07-07', weekStartDate: weekStart, type: 'squash', status: 'completed', durationMin: 60 }),
      makeSession({ id: 'sq-3', athleteId: 'ath_self', date: '2026-07-08', weekStartDate: weekStart, type: 'squash', status: 'completed', durationMin: 60 }),
      makeSession({ id: 'run-1', athleteId: 'ath_self', date: '2026-07-08', weekStartDate: weekStart, type: 'running', status: 'completed', durationMin: 35 }),
      makeSession({ id: 'str-1', athleteId: 'ath_self', date: '2026-07-09', weekStartDate: weekStart, type: 'strength', status: 'completed', durationMin: 40 }),
      makeSession({ id: 'mob-1', athleteId: 'ath_self', date: '2026-07-09', weekStartDate: weekStart, type: 'mobility', status: 'adjusted', durationMin: 20 }),
      makeSession({ id: 'run-2', athleteId: 'ath_self', date: '2026-07-11', weekStartDate: weekStart, type: 'running', status: 'planned', durationMin: 45 }),
      makeSession({ id: 'str-2', athleteId: 'ath_self', date: '2026-07-12', weekStartDate: weekStart, type: 'strength', status: 'planned', durationMin: 40 }),
    ])

    await expect(useTrainingStore.getState().generateCoachNote(weekStart)).resolves.toBe('nota actualizada')

    const context = vi.mocked(CoachEngine.send).mock.calls.at(-1)?.[1] as ChatContext
    expect(context.currentWeekSummary?.plannedSessions).toBe(8)
    expect(context.currentWeekSummary?.completedSessions).toBe(6)
    expect(context.currentWeekSummary?.completedMinutes).toBe(275)
    expect(context.currentWeekSummary?.adherencePct).toBe(75)

    const stored = await db.weekSummaries.where('[athleteId+weekStartDate]').equals(['ath_self', weekStart]).first()
    expect(stored?.coachNote).toBe('nota actualizada')
    expect(stored?.coachNoteGeneratedAt).toEqual(expect.any(Number))
    expect(stored?.coachNoteSnapshot).toBe(stored ? buildWeeklyCoachNoteSnapshot(stored) : undefined)
  })
})

describe('toggleExercise completion (Dexie real)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    useTrainingStore.setState({
      sessions: [],
      dayLogs: {},
      currentWeekSummary: null,
      allWeekSummaries: [],
      isLoading: false,
      loadedWeekStart: null,
    })
  })

  afterEach(() => {
    db.close()
  })

  it('marca la sesión como completed cuando todos los ejercicios quedan realizados', async () => {
    const session = makeSession({
      id: 'strength-1',
      type: 'strength',
      status: 'planned',
      exercises: [
        { id: 'ex-1', name: 'Sentadilla', sets: 3, reps: 5, completed: true },
        { id: 'ex-2', name: 'Peso muerto', sets: 3, reps: 5, completed: false },
      ],
    })
    await db.sessions.put(session)
    useTrainingStore.setState({
      sessions: [session],
      loadedWeekStart: '2026-04-06',
    })

    await useTrainingStore.getState().toggleExercise('strength-1', 'ex-2')

    const stored = await db.sessions.get('strength-1')
    expect(stored?.status).toBe('completed')
    expect(stored?.completedAt).toEqual(expect.any(Number))
    expect(stored?.exercises?.every((exercise) => exercise.completed)).toBe(true)
    expect(useTrainingStore.getState().sessions.find((item) => item.id === 'strength-1')?.status).toBe('completed')
  })
})
