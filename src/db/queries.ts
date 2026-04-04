import { db } from './db'
import type { Session, DayLog, WeekSummary, AthleteProfile } from '../types'
import * as syncService from '../services/syncService'
import { toISO, getWeekStart, fromISO } from '../utils/date'
import { addDays } from 'date-fns'
import { v4 as uuid } from '../utils/uuid'

export const getSessionsForWeek = async (
  weekStartISO: string
): Promise<Session[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  return db.sessions.where('date').between(weekStartISO, end, true, true).toArray()
}

export const getDayLogsForWeek = async (weekStartISO: string): Promise<DayLog[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  return db.dayLogs.where('date').between(weekStartISO, end, true, true).toArray()
}

export const getSessionsForDay = async (dateISO: string): Promise<Session[]> =>
  db.sessions.where('date').equals(dateISO).toArray()

export const getDayLog = async (dateISO: string): Promise<DayLog | undefined> =>
  db.dayLogs.where('date').equals(dateISO).first()

export const upsertDayLog = async (
  dateISO: string,
  patch: Partial<Omit<DayLog, 'id' | 'date' | 'updatedAt'>>
): Promise<DayLog> => {
  const existing = await getDayLog(dateISO)
  const now = Date.now()
  if (existing) {
    const updated = { ...existing, ...patch, updatedAt: now }
    await db.dayLogs.put(updated)
    return updated
  }
  const created: DayLog = { id: uuid(), date: dateISO, updatedAt: now, ...patch }
  await db.dayLogs.put(created)
  return created
}

export const getWeekSummary = async (weekStartISO: string): Promise<WeekSummary | undefined> =>
  db.weekSummaries.where('weekStartDate').equals(weekStartISO).first()

export const upsertWeekSummary = async (
  weekStartISO: string,
  patch: Partial<Omit<WeekSummary, 'id' | 'weekStartDate'>>
): Promise<WeekSummary> => {
  const existing = await getWeekSummary(weekStartISO)
  if (existing) {
    const updated = { ...existing, ...patch }
    await db.weekSummaries.put(updated)
    void syncService.pushWeekSummary(updated)
    return updated
  }
  const created: WeekSummary = {
    id: uuid(),
    weekStartDate: weekStartISO,
    totalSessions: 0,
    totalMinutes: 0,
    plannedSessions: 0,
    completedSessions: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    squashSessions: 0,
    runningSessions: 0,
    strengthSessions: 0,
    ...patch,
  }
  await db.weekSummaries.put(created)
  void syncService.pushWeekSummary(created)
  return created
}

export const recalculateWeekSummary = async (dateISO: string): Promise<void> => {
  const weekStart = toISO(getWeekStart(fromISO(dateISO)))
  const sessions = await getSessionsForWeek(weekStart)
  const dayLogs = await getDayLogsForWeek(weekStart)
  const realized = sessions.filter(s => s.status === 'completed' || s.status === 'adjusted')
  const plannedMinutes = sessions
    .filter(s => s.status !== 'skipped')
    .reduce((a, s) => a + s.durationMin, 0)
  const completedMinutes = realized.reduce((a, s) => a + (s.actualDurationMin ?? s.durationMin), 0)
  const plannedSessions = sessions.filter(s => s.status !== 'skipped').length
  const completedSessions = realized.length

  const plannedRpeValues = realized.filter(s => s.rpe != null).map(s => s.rpe!)
  const avgRpe = plannedRpeValues.length
    ? plannedRpeValues.reduce((a, b) => a + b, 0) / plannedRpeValues.length
    : undefined

  const sessionActualRpeValues = realized
    .map(s => s.actualRpe)
    .filter((value): value is number => value != null)

  const fallbackDayActualRpeValues = dayLogs
    .filter(log => log.rpeActual != null)
    .filter(log => {
      const completedSessionsForDay = realized.filter(session => session.date === log.date)
      if (completedSessionsForDay.length !== 1) return false
      return completedSessionsForDay[0].actualRpe == null
    })
    .map(log => log.rpeActual as number)

  const actualRpeValues = [
    ...sessionActualRpeValues,
    ...fallbackDayActualRpeValues,
  ]

  const avgActualRpe = actualRpeValues.length
    ? actualRpeValues.reduce((a, b) => a + b, 0) / actualRpeValues.length
    : undefined

  const sleepValues = dayLogs
    .map(log => log.sleepHours)
    .filter((value): value is number => value != null)
  const avgSleep = sleepValues.length
    ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length
    : undefined

  const energyValues = dayLogs
    .map(log => log.energyLevel)
    .filter((value): value is number => value != null)
  const avgEnergy = energyValues.length
    ? energyValues.reduce((a, b) => a + b, 0) / energyValues.length
    : undefined

  const bodyWeightValues = dayLogs
    .map(log => log.bodyWeight)
    .filter((value): value is number => value != null)
  const avgBodyWeight = bodyWeightValues.length
    ? bodyWeightValues.reduce((a, b) => a + b, 0) / bodyWeightValues.length
    : undefined

  const adherencePct = plannedSessions > 0
    ? Math.round((completedSessions / plannedSessions) * 100)
    : undefined

  const active = sessions.filter(s => s.status !== 'skipped')

  await upsertWeekSummary(weekStart, {
    totalSessions: completedSessions,
    totalMinutes: completedMinutes,
    plannedSessions,
    completedSessions,
    plannedMinutes,
    completedMinutes,
    adherencePct,
    squashSessions: realized.filter(s => s.type === 'squash').length,
    runningSessions: realized.filter(s => s.type === 'running').length,
    strengthSessions: realized.filter(s => s.type === 'strength').length,
    plannedSquashSessions: active.filter(s => s.type === 'squash').length,
    plannedRunningSessions: active.filter(s => s.type === 'running').length,
    plannedStrengthSessions: active.filter(s => s.type === 'strength').length,
    mobilityMinutes: realized
      .filter(s => s.type === 'mobility')
      .reduce((a, s) => a + (s.actualDurationMin ?? s.durationMin), 0),
    avgRpe,
    avgActualRpe,
    avgSleep,
    avgEnergy,
    avgBodyWeight,
    weightEntries: bodyWeightValues.length,
  })
}

export const getAllWeekSummaries = async (): Promise<WeekSummary[]> =>
  db.weekSummaries.orderBy('weekStartDate').reverse().toArray()

export const getMatchSessions = async (): Promise<Session[]> => {
  const sessions = await db.sessions
    .filter(s => s.type === 'squash' && (s.subtype === 'match' || s.subtype === 'competitive'))
    .toArray()
  return sessions.sort((a, b) => b.date.localeCompare(a.date))
}

const ATHLETE_PROFILE_ID = 'default'

export const getAthleteProfile = async (): Promise<AthleteProfile | undefined> =>
  db.athleteProfiles.get(ATHLETE_PROFILE_ID)

export const upsertAthleteProfile = async (
  patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>
): Promise<AthleteProfile> => {
  const existing = await getAthleteProfile()
  const updatedAt = Date.now()

  if (existing) {
    const updated: AthleteProfile = {
      ...existing,
      ...patch,
      updatedAt,
    }
    await db.athleteProfiles.put(updated)
    return updated
  }

  const created: AthleteProfile = {
    id: ATHLETE_PROFILE_ID,
    updatedAt,
    ...patch,
  }
  await db.athleteProfiles.put(created)
  return created
}
