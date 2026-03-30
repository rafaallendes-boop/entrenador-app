import { create } from 'zustand'
import { db } from '../db/db'
import {
  getSessionsForWeek,
  getDayLog,
  upsertDayLog,
  getWeekSummary,
  recalculateWeekSummary,
  getAllWeekSummaries,
} from '../db/queries'
import type { Session, DayLog, WeekSummary, SessionStatus } from '../types'
import { v4 as uuid } from '../utils/uuid'
import { toISO, fromISO, getWeekStart } from '../utils/date'
import { addDays } from 'date-fns'

const STATUS_CYCLE: SessionStatus[] = ['planned', 'completed', 'adjusted', 'skipped']

interface TrainingState {
  sessions: Session[]
  dayLogs: Record<string, DayLog>
  currentWeekSummary: WeekSummary | null
  allWeekSummaries: WeekSummary[]
  isLoading: boolean

  loadWeek: (weekStart: string) => Promise<void>
  loadAllSummaries: () => Promise<void>
  addSession: (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateSession: (id: string, patch: Partial<Session>) => Promise<void>
  cycleSessionStatus: (id: string) => Promise<void>
  toggleExercise: (sessionId: string, exerciseId: string) => Promise<void>
  saveDayLog: (date: string, patch: Partial<Omit<DayLog, 'id' | 'date' | 'updatedAt'>>) => Promise<void>
}

export const useTrainingStore = create<TrainingState>((set, get) => ({
  sessions: [],
  dayLogs: {},
  currentWeekSummary: null,
  allWeekSummaries: [],
  isLoading: false,

  loadWeek: async (weekStart) => {
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

      const summary = await getWeekSummary(weekStart)
      set({ sessions, dayLogs, currentWeekSummary: summary ?? null, isLoading: false })
    } catch (e) {
      console.error(e)
      set({ isLoading: false })
    }
  },

  loadAllSummaries: async () => {
    const all = await getAllWeekSummaries()
    set({ allWeekSummaries: all })
  },

  addSession: async (partial) => {
    const now = Date.now()
    const session: Session = { ...partial, id: uuid(), createdAt: now, updatedAt: now }
    await db.sessions.add(session)
    await recalculateWeekSummary(session.date)
    const activeWeekStart = get().currentWeekSummary?.weekStartDate
    const sessionWeekStart = toISO(getWeekStart(fromISO(session.date)))
    const nextSummary = activeWeekStart === sessionWeekStart
      ? await getWeekSummary(activeWeekStart)
      : get().currentWeekSummary

    set(state => ({
      sessions: [...state.sessions, session],
      currentWeekSummary: nextSummary ?? state.currentWeekSummary,
    }))
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

    await db.sessions.update(id, { ...patch, completedAt, updatedAt: now })
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, ...patch, completedAt, updatedAt: now } : s
      ),
    }))
    await recalculateWeekSummary(previous.date)
    if (patch.date && patch.date !== previous.date) {
      await recalculateWeekSummary(patch.date)
    }

    const activeWeekStart = get().currentWeekSummary?.weekStartDate
    if (activeWeekStart) {
      const affectedWeeks = new Set([
        toISO(getWeekStart(fromISO(previous.date))),
        patch.date ? toISO(getWeekStart(fromISO(patch.date))) : null,
      ].filter((value): value is string => Boolean(value)))

      if ([...affectedWeeks].includes(activeWeekStart)) {
        const summary = await getWeekSummary(activeWeekStart)
        set({ currentWeekSummary: summary ?? null })
      }
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
      ex.id === exerciseId ? { ...ex, completed: !ex.completed } : ex
    )
    await get().updateSession(sessionId, { exercises })
  },

  saveDayLog: async (date, patch) => {
    const log = await upsertDayLog(date, patch)
    await recalculateWeekSummary(date)
    const activeWeekStart = get().currentWeekSummary?.weekStartDate
    if (activeWeekStart === toISO(getWeekStart(fromISO(date)))) {
      const summary = await getWeekSummary(activeWeekStart)
      set({ currentWeekSummary: summary ?? null })
    }
    set(state => ({
      dayLogs: { ...state.dayLogs, [date]: log },
    }))
  },
}))
