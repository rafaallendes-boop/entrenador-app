import { addDays } from 'date-fns'
import { create } from 'zustand'
import { db } from '../db/db'
import {
  getSessionsForWeek,
  getDayLog,
  getDayLogsForWeek,
  upsertDayLog,
  getWeekSummary,
  recalculateWeekSummary,
  getAllWeekSummaries,
  getAthleteProfile,
  upsertWeekSummary,
} from '../db/queries'
import type { Session, DayLog, WeekSummary, SessionStatus } from '../types'
import { CoachEngine } from '../services/ai/CoachEngine'
import { optimizeChatContext } from '../services/ai/contextOptimizer'
import * as syncService from '../services/syncService'
import { toISO, fromISO, getWeekStart } from '../utils/date'
import { v4 as uuid } from '../utils/uuid'

const STATUS_CYCLE: SessionStatus[] = ['planned', 'completed', 'adjusted', 'skipped']

interface TrainingState {
  sessions: Session[]
  dayLogs: Record<string, DayLog>
  currentWeekSummary: WeekSummary | null
  allWeekSummaries: WeekSummary[]
  isLoading: boolean
  loadedWeekStart: string | null

  loadWeek: (weekStart: string) => Promise<void>
  loadAllSummaries: () => Promise<void>
  addSession: (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Session>
  updateSession: (id: string, patch: Partial<Session>) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  cycleSessionStatus: (id: string) => Promise<void>
  toggleExercise: (sessionId: string, exerciseId: string) => Promise<void>
  saveDayLog: (date: string, patch: Partial<Omit<DayLog, 'id' | 'date' | 'updatedAt'>>) => Promise<void>
  generateCoachNote: (weekStart: string) => Promise<string>
}

let latestWeekLoadRequestId = 0
let latestAllSummariesLoadRequestId = 0

function getWeekStartDate(dateISO: string): string {
  return toISO(getWeekStart(fromISO(dateISO)))
}

function getActiveWeekStart(state: Pick<TrainingState, 'loadedWeekStart' | 'currentWeekSummary'>): string | null {
  return state.loadedWeekStart ?? state.currentWeekSummary?.weekStartDate ?? null
}

export function resolveVisibleSessionsAfterUpdate(
  visibleSessions: Session[],
  updatedSession: Session,
  loadedWeekStart: string | null,
): Session[] {
  const nextVisible = visibleSessions.filter((session) => session.id !== updatedSession.id)
  if (!loadedWeekStart || updatedSession.weekStartDate !== loadedWeekStart) {
    return nextVisible
  }

  return [...nextVisible, updatedSession]
}

export function shouldKeepDayLogInVisibleWeek(dateISO: string, loadedWeekStart: string | null): boolean {
  if (!loadedWeekStart) return false
  return getWeekStartDate(dateISO) === loadedWeekStart
}

export const useTrainingStore = create<TrainingState>((set, get) => ({
  sessions: [],
  dayLogs: {},
  currentWeekSummary: null,
  allWeekSummaries: [],
  isLoading: false,
  loadedWeekStart: null,

  loadWeek: async (weekStart) => {
    const requestId = ++latestWeekLoadRequestId
    set({ isLoading: true })
    try {
      const sessions = await getSessionsForWeek(weekStart)

      const dates: string[] = []
      for (let i = 0; i < 7; i++) {
        dates.push(toISO(addDays(fromISO(weekStart), i)))
      }
      const dayLogEntries = await Promise.all(dates.map(d => getDayLog(d)))
      const dayLogs: Record<string, DayLog> = {}
      dayLogEntries.forEach((log, i) => {
        if (log) dayLogs[dates[i]] = log
      })

      if (requestId !== latestWeekLoadRequestId) return
      await recalculateWeekSummary(weekStart)
      const summary = await getWeekSummary(weekStart)
      if (requestId !== latestWeekLoadRequestId) return
      set({
        sessions,
        dayLogs,
        currentWeekSummary: summary ?? null,
        isLoading: false,
        loadedWeekStart: weekStart,
      })
    } catch (e) {
      console.error(e)
      if (requestId !== latestWeekLoadRequestId) return
      set({
        sessions: [],
        dayLogs: {},
        currentWeekSummary: null,
        isLoading: false,
        loadedWeekStart: null,
      })
    }
  },

  loadAllSummaries: async () => {
    const requestId = ++latestAllSummariesLoadRequestId
    const all = await getAllWeekSummaries()
    if (requestId !== latestAllSummariesLoadRequestId) return
    set({ allWeekSummaries: all })
  },

  addSession: async (partial) => {
    const now = Date.now()
    const weekStartDate = getWeekStartDate(partial.date)
    const session: Session = { ...partial, weekStartDate, id: uuid(), createdAt: now, updatedAt: now }
    await db.sessions.add(session)
    void syncService.pushSession(session)
    await recalculateWeekSummary(session.date)
    const activeWeekStart = getActiveWeekStart(get())
    const sessionWeekStart = getWeekStartDate(session.date)
    const nextSummary = activeWeekStart === sessionWeekStart
      ? await getWeekSummary(activeWeekStart)
      : get().currentWeekSummary

    set(state => ({
      sessions: state.loadedWeekStart === sessionWeekStart
        ? [...state.sessions, session]
        : state.sessions,
      currentWeekSummary: nextSummary ?? state.currentWeekSummary,
    }))
    return session
  },

  updateSession: async (id, patch) => {
    const previous = get().sessions.find(s => s.id === id)
    if (!previous) return
    const now = Date.now()
    const nextStatus = patch.status ?? previous.status
    const completedAt =
      nextStatus === 'completed'
        ? previous.completedAt ?? now
        : patch.status != null && patch.status !== 'completed'
          ? undefined
          : previous.completedAt

    const weekStartDate = patch.date && patch.date !== previous.date
      ? getWeekStartDate(patch.date)
      : previous.weekStartDate
    await db.sessions.update(id, { ...patch, weekStartDate, completedAt, updatedAt: now })
    const updatedSession = { ...previous, ...patch, weekStartDate, completedAt, updatedAt: now }
    void syncService.pushSession(updatedSession)
    set(state => ({
      sessions: resolveVisibleSessionsAfterUpdate(state.sessions, updatedSession, state.loadedWeekStart),
    }))
    await recalculateWeekSummary(previous.date)
    if (patch.date && patch.date !== previous.date) {
      await recalculateWeekSummary(patch.date)
    }

    const activeWeekStart = getActiveWeekStart(get())
    if (activeWeekStart) {
      const affectedWeeks = new Set([
        getWeekStartDate(previous.date),
        patch.date ? getWeekStartDate(patch.date) : null,
      ].filter((value): value is string => Boolean(value)))

      if ([...affectedWeeks].includes(activeWeekStart)) {
        const summary = await getWeekSummary(activeWeekStart)
        set({ currentWeekSummary: summary ?? null })
      }
    }
  },

  deleteSession: async (id) => {
    const session = get().sessions.find(s => s.id === id)
    if (!session) return
    await db.sessions.delete(id)
    void syncService.deleteSession(id)
    await recalculateWeekSummary(session.date)
    set(state => ({ sessions: state.sessions.filter(s => s.id !== id) }))
    const activeWeekStart = getActiveWeekStart(get())
    if (activeWeekStart === getWeekStartDate(session.date)) {
      const summary = await getWeekSummary(activeWeekStart)
      set({ currentWeekSummary: summary ?? null })
    }
  },

  cycleSessionStatus: async (id) => {
    const session = get().sessions.find(s => s.id === id)
    if (!session) return
    const currentIdx = STATUS_CYCLE.indexOf(session.status)
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length]
    await get().updateSession(id, { status: nextStatus })
  },

  toggleExercise: async (sessionId, exerciseId) => {
    const session = get().sessions.find(s => s.id === sessionId)
    if (!session?.exercises) return
    const exercises = session.exercises.map(ex =>
      ex.id === exerciseId ? { ...ex, completed: !ex.completed } : ex,
    )
    await get().updateSession(sessionId, { exercises })
  },

  saveDayLog: async (date, patch) => {
    const log = await upsertDayLog(date, patch)
    void syncService.pushDayLog(log)
    await recalculateWeekSummary(date)
    const activeWeekStart = getActiveWeekStart(get())
    if (activeWeekStart === getWeekStartDate(date)) {
      const summary = await getWeekSummary(activeWeekStart)
      set({ currentWeekSummary: summary ?? null })
    }
    set(state => ({
      dayLogs: shouldKeepDayLogInVisibleWeek(date, state.loadedWeekStart)
        ? { ...state.dayLogs, [date]: log }
        : state.dayLogs,
    }))
  },

  generateCoachNote: async (weekStart) => {
    set({ isLoading: true })
    try {
      const [sessions, weekDayLogs, currentWeekSummary, athleteProfile] = await Promise.all([
        getSessionsForWeek(weekStart),
        getDayLogsForWeek(weekStart),
        getWeekSummary(weekStart),
        getAthleteProfile(),
      ])

      const response = await CoachEngine.send(
        'Genera un resumen semanal corto y concreto. Evalua adherencia, carga, sensaciones, riesgos y foco para la siguiente semana. No propongas acciones ni uses <actions>.',
        optimizeChatContext({
          recentSessions: sessions
            .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock)),
          plannedSessions: sessions.filter(session => session.status === 'planned'),
          historicalSessions: sessions.filter(session => session.status !== 'planned'),
          currentWeekSummary: currentWeekSummary ?? undefined,
          weekDayLogs,
          athleteMemory: athleteProfile?.coachMemory,
          athleteProfile: athleteProfile ?? undefined,
          intent: 'weekly_summary',
        }),
        { maxTokens: 700, temperature: 0.4 },
      )

      const summary = await upsertWeekSummary(weekStart, { coachNote: response.message })
      const activeWeekStart = getActiveWeekStart(get())
      if (activeWeekStart === weekStart) {
        set({ currentWeekSummary: summary })
      }
      await get().loadAllSummaries()
      return response.message
    } finally {
      set({ isLoading: false })
    }
  },
}))
