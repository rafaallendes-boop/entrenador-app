import { db } from './db'
import type { Session, DayLog, WeekSummary, AthleteProfile } from '../types'
import * as syncService from '../services/syncService'
import { toISO, getWeekStart, fromISO } from '../utils/date'
import { isCompetitionSquashMatch, isPracticeSquashMatch } from '../utils/squash'
import { addDays } from 'date-fns'
import { v4 as uuid } from '../utils/uuid'
import {
  ATHLETE_PROFILE_LOCAL_ID,
  getActiveAthleteId,
  getSelfAthleteId,
  isSelfScopeActive,
} from '../services/athlete/activeAthlete'
import { isScopedAthleteId } from '../services/athlete/effectiveAthleteKey'
import { isWhoopPrefilled } from '../services/readiness/dayLogPrefillSave'
import {
  resolveAthleteWeekScope,
  type AthleteWeekScope,
} from '../services/athlete/athleteWeekScope'

/**
 * Collects "RPE real de sesión" values for the weekly average: session-level
 * `actualRpe`, plus a per-day fallback to `dayLog.rpeActual` ONLY when a day has
 * exactly one completed session without its own RPE. Whoop-prefilled effort is
 * excluded — it is objective strain-derived load, not a declared session RPE.
 */
export function collectActualRpeValues(
  realized: Array<{ date: string; actualRpe?: number | null }>,
  dayLogs: Array<{ date: string; rpeActual?: number; prefillSource?: DayLog['prefillSource'] }>,
): number[] {
  const sessionActualRpeValues = realized
    .map(s => s.actualRpe)
    .filter((value): value is number => value != null)

  const fallbackDayActualRpeValues = dayLogs
    .filter(log => log.rpeActual != null && !isWhoopPrefilled(log, 'rpeActual'))
    .filter(log => {
      const completedSessionsForDay = realized.filter(session => session.date === log.date)
      if (completedSessionsForDay.length !== 1) return false
      return completedSessionsForDay[0].actualRpe == null
    })
    .map(log => log.rpeActual as number)

  return [...sessionActualRpeValues, ...fallbackDayActualRpeValues]
}
import { filterRowsToActiveScope } from '../services/athlete/activeScopeFilter'

function stripAthleteId<T extends object>(patch: T): Omit<T, 'athleteId'> {
  const rest = { ...patch } as T & { athleteId?: unknown }
  delete rest.athleteId
  return rest
}

function pickLegacyOrOnlyRow<T extends { athleteId?: string }>(rows: T[]): T | undefined {
  const legacy = rows.find((row) => !isScopedAthleteId(row.athleteId))
  if (legacy) return legacy
  return rows.length === 1 ? rows[0] : undefined
}

function captureActiveWeekScope(): AthleteWeekScope | null {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return null
  const selfId = getSelfAthleteId()
  return { athleteId, includeLegacy: athleteId === selfId }
}

async function getSessionsForWeekLegacy(weekStartISO: string): Promise<Session[]> {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  return db.sessions.where('date').between(weekStartISO, end, true, true).toArray()
}

export const getSessionsForWeekCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
): Promise<Session[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  const rows = await db.sessions.where('date').between(weekStartISO, end, true, true).toArray()
  return rows.filter((row) =>
    row.athleteId === scope.athleteId
      || (scope.includeLegacy && !isScopedAthleteId(row.athleteId)))
}

export const getSessionsForWeek = async (weekStartISO: string): Promise<Session[]> => {
  const scope = captureActiveWeekScope()
  return scope ? getSessionsForWeekCore(scope, weekStartISO) : getSessionsForWeekLegacy(weekStartISO)
}

async function getDayLogsForWeekLegacy(weekStartISO: string): Promise<DayLog[]> {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  return db.dayLogs.where('date').between(weekStartISO, end, true, true).toArray()
}

export const getDayLogsForWeekCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
): Promise<DayLog[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  const scoped = await db.dayLogs
    .where('[athleteId+date]')
    .between([scope.athleteId, weekStartISO], [scope.athleteId, end], true, true)
    .toArray()
  if (!scope.includeLegacy) {
    return scoped.sort((a, b) => a.date.localeCompare(b.date))
  }
  const byDate = new Map<string, DayLog>(scoped.map((row) => [row.date, row]))
  const inRange = await db.dayLogs.where('date').between(weekStartISO, end, true, true).toArray()
  for (const row of inRange) {
    if (byDate.has(row.date)) continue
    if (isScopedAthleteId(row.athleteId)) continue
    byDate.set(row.date, row)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export const getDayLogsForWeek = async (weekStartISO: string): Promise<DayLog[]> => {
  const scope = captureActiveWeekScope()
  return scope ? getDayLogsForWeekCore(scope, weekStartISO) : getDayLogsForWeekLegacy(weekStartISO)
}

export const getSessionsForDay = async (dateISO: string): Promise<Session[]> =>
  filterRowsToActiveScope(await db.sessions.where('date').equals(dateISO).toArray())

export const getDayLog = async (dateISO: string): Promise<DayLog | undefined> => {
  const activeAthleteId = getActiveAthleteId()
  if (!activeAthleteId) {
    const candidates = await db.dayLogs.where('date').equals(dateISO).toArray()
    return pickLegacyOrOnlyRow(candidates)
  }

  const scoped = await db.dayLogs.where('[athleteId+date]').equals([activeAthleteId, dateISO]).first()
  if (scoped) return scoped

  // Legacy adoption is self-only (spec §3.6): a managed athlete never reads
  // the owner's unscoped rows.
  if (!isSelfScopeActive()) return undefined
  const candidates = await db.dayLogs.where('date').equals(dateISO).toArray()
  return candidates.find((row) => !isScopedAthleteId(row.athleteId))
}

export const upsertDayLog = async (
  dateISO: string,
  patch: Partial<Omit<DayLog, 'id' | 'date' | 'updatedAt' | 'athleteId'>>
): Promise<DayLog> => {
  const existing = await getDayLog(dateISO)
  const now = Date.now()
  const activeAthleteId = getActiveAthleteId()
  const safePatch = stripAthleteId(patch)
  if (existing) {
    const resolvedAthleteId = isScopedAthleteId(existing.athleteId)
      ? existing.athleteId
      : activeAthleteId ?? undefined
    const updated: DayLog = {
      ...existing,
      ...safePatch,
      updatedAt: now,
      ...(resolvedAthleteId ? { athleteId: resolvedAthleteId } : {}),
    }
    await db.dayLogs.put(updated)
    return updated
  }
  const created: DayLog = {
    id: uuid(),
    date: dateISO,
    updatedAt: now,
    ...safePatch,
    ...(activeAthleteId ? { athleteId: activeAthleteId } : {}),
  }
  await db.dayLogs.put(created)
  return created
}

async function getWeekSummaryLegacy(weekStartISO: string): Promise<WeekSummary | undefined> {
  const candidates = await db.weekSummaries.where('weekStartDate').equals(weekStartISO).toArray()
  return pickLegacyOrOnlyRow(candidates)
}

export const getWeekSummaryCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
): Promise<WeekSummary | undefined> => {
  const scoped = await db.weekSummaries
    .where('[athleteId+weekStartDate]')
    .equals([scope.athleteId, weekStartISO])
    .first()
  if (scoped) return scoped
  if (!scope.includeLegacy) return undefined
  const candidates = await db.weekSummaries.where('weekStartDate').equals(weekStartISO).toArray()
  return candidates.find((row) => !isScopedAthleteId(row.athleteId))
}

export const getWeekSummary = async (weekStartISO: string): Promise<WeekSummary | undefined> => {
  const scope = captureActiveWeekScope()
  return scope ? getWeekSummaryCore(scope, weekStartISO) : getWeekSummaryLegacy(weekStartISO)
}

export function hasWeekSummaryMeaningfulChanges(
  existing: WeekSummary,
  patch: Partial<Omit<WeekSummary, 'id' | 'weekStartDate' | 'updatedAt'>>,
): boolean {
  return Object.entries(patch).some(([key, nextValue]) => {
    const currentValue = existing[key as keyof WeekSummary]
    if (Array.isArray(currentValue) || Array.isArray(nextValue)) {
      return JSON.stringify(currentValue ?? null) !== JSON.stringify(nextValue ?? null)
    }
    return currentValue !== nextValue
  })
}

type WeekSummaryPatch = Partial<Omit<WeekSummary, 'id' | 'weekStartDate' | 'updatedAt' | 'athleteId'>>

function createWeekSummary(
  weekStartISO: string,
  patch: WeekSummaryPatch,
  updatedAt: number,
  athleteId?: string,
): WeekSummary {
  return {
    id: uuid(),
    weekStartDate: weekStartISO,
    updatedAt,
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
    ...(athleteId ? { athleteId } : {}),
  }
}

export const upsertWeekSummaryCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
  patch: WeekSummaryPatch,
): Promise<{ summary: WeekSummary; changed: boolean }> => {
  const existing = await getWeekSummaryCore(scope, weekStartISO)
  const safePatch = stripAthleteId(patch)
  if (existing) {
    const needsAthleteStamp = !isScopedAthleteId(existing.athleteId)
    if (!needsAthleteStamp && !hasWeekSummaryMeaningfulChanges(existing, safePatch)) {
      return { summary: existing, changed: false }
    }
    const updatedAt = Math.max(Date.now(), (existing.updatedAt ?? 0) + 1)
    const updated: WeekSummary = {
      ...existing,
      ...safePatch,
      updatedAt,
      athleteId: scope.athleteId,
    }
    await db.weekSummaries.put(updated)
    return { summary: updated, changed: true }
  }
  const created = createWeekSummary(weekStartISO, safePatch, Date.now(), scope.athleteId)
  await db.weekSummaries.put(created)
  return { summary: created, changed: true }
}

async function upsertWeekSummaryLegacy(
  weekStartISO: string,
  patch: WeekSummaryPatch,
): Promise<{ summary: WeekSummary; changed: boolean }> {
  const existing = await getWeekSummaryLegacy(weekStartISO)
  const safePatch = stripAthleteId(patch)
  if (existing) {
    if (!hasWeekSummaryMeaningfulChanges(existing, safePatch)) {
      return { summary: existing, changed: false }
    }
    const updated = {
      ...existing,
      ...safePatch,
      updatedAt: Math.max(Date.now(), (existing.updatedAt ?? 0) + 1),
    }
    await db.weekSummaries.put(updated)
    return { summary: updated, changed: true }
  }
  const created = createWeekSummary(weekStartISO, safePatch, Date.now())
  await db.weekSummaries.put(created)
  return { summary: created, changed: true }
}

export const upsertWeekSummary = async (
  weekStartISO: string,
  patch: WeekSummaryPatch,
): Promise<WeekSummary> => {
  const scope = captureActiveWeekScope()
  const result = scope
    ? await upsertWeekSummaryCore(scope, weekStartISO, patch)
    : await upsertWeekSummaryLegacy(weekStartISO, patch)
  if (result.changed) void syncService.pushWeekSummary(result.summary)
  return result.summary
}

function calculateWeekSummaryPatch(sessions: Session[], dayLogs: DayLog[]): WeekSummaryPatch {
  const realized = sessions.filter(s => s.status === 'completed' || s.status === 'adjusted')
  const plannedMinutes = sessions
    .filter(s => s.status !== 'skipped')
    .reduce((a, s) => a + s.durationMin, 0)
  const completedMinutes = realized.reduce((a, s) => a + (s.actualDurationMin ?? s.durationMin), 0)
  const plannedSessions = sessions.filter(s => s.status !== 'skipped').length
  const completedSessions = realized.length

  const completedRpeValues = realized.filter(s => s.rpe != null).map(s => s.rpe!)
  const avgRpe = completedRpeValues.length
    ? completedRpeValues.reduce((a, b) => a + b, 0) / completedRpeValues.length
    : undefined

  const actualRpeValues = collectActualRpeValues(realized, dayLogs)

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

  return {
    totalSessions: plannedSessions,
    totalMinutes: plannedMinutes,
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
  }
}

export const recalculateWeekSummaryCore = async (
  scope: AthleteWeekScope,
  dateISO: string,
): Promise<{ summary: WeekSummary; changed: boolean }> => {
  const weekStart = toISO(getWeekStart(fromISO(dateISO)))
  const sessions = await getSessionsForWeekCore(scope, weekStart)
  const dayLogs = await getDayLogsForWeekCore(scope, weekStart)
  return upsertWeekSummaryCore(scope, weekStart, calculateWeekSummaryPatch(sessions, dayLogs))
}

async function recalculateWeekSummaryLegacy(dateISO: string): Promise<{ summary: WeekSummary; changed: boolean }> {
  const weekStart = toISO(getWeekStart(fromISO(dateISO)))
  const sessions = await getSessionsForWeekLegacy(weekStart)
  const dayLogs = await getDayLogsForWeekLegacy(weekStart)
  return upsertWeekSummaryLegacy(weekStart, calculateWeekSummaryPatch(sessions, dayLogs))
}

export const recalculateWeekSummary = async (dateISO: string): Promise<void> => {
  const scope = captureActiveWeekScope()
  const result = scope
    ? await recalculateWeekSummaryCore(scope, dateISO)
    : await recalculateWeekSummaryLegacy(dateISO)
  if (result.changed) void syncService.pushWeekSummary(result.summary)
}

export const recalculateWeekSummaryForAthlete = async (
  ownerAccountId: string,
  athleteId: string,
  dateISO: string,
): Promise<void> => {
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
  const result = await recalculateWeekSummaryCore(scope, dateISO)
  if (result.changed) void syncService.pushWeekSummaryForAthlete(result.summary)
}

export const getAllWeekSummaries = async (): Promise<WeekSummary[]> =>
  filterRowsToActiveScope(await db.weekSummaries.orderBy('weekStartDate').reverse().toArray())

export const getHistoricalSessionsWindow = async (
  referenceDateISO: string,
  weeks = 8,
): Promise<Session[]> => {
  const start = toISO(addDays(fromISO(referenceDateISO), -(weeks * 7)))
  const rows = await db.sessions
    .where('date')
    .between(start, referenceDateISO, true, false)
    .toArray()
  return filterRowsToActiveScope(rows)
}

export const getMatchSessions = async (): Promise<Session[]> => {
  const sessions = await db.sessions
    .filter((s) => isPracticeSquashMatch(s) || isCompetitionSquashMatch(s))
    .toArray()
  return filterRowsToActiveScope(sessions).sort((a, b) => b.date.localeCompare(a.date))
}

// The profile row key follows the athlete scope: the owner's own profile keeps
// the historic singleton row; a managed athlete gets its own row keyed by its
// athleteId and never adopts the owner's profile.
function resolveProfileLocalId(): string {
  const active = getActiveAthleteId()
  if (!active || isSelfScopeActive()) return ATHLETE_PROFILE_LOCAL_ID
  return active
}

export const getAthleteProfile = async (): Promise<AthleteProfile | undefined> =>
  db.athleteProfiles.get(resolveProfileLocalId())

export const upsertAthleteProfile = async (
  patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt' | 'athleteId'>>
): Promise<AthleteProfile> => {
  const localId = resolveProfileLocalId()
  const { athleteId: _callerScope, ...safePatch } = patch as Partial<AthleteProfile>
  void _callerScope
  const existing = await db.athleteProfiles.get(localId)
  const updatedAt = Date.now()
  const activeAthleteId = getActiveAthleteId()

  if (existing) {
    const updated: AthleteProfile = {
      ...existing,
      ...safePatch,
      updatedAt,
      ...(activeAthleteId && !isScopedAthleteId(existing.athleteId) ? { athleteId: activeAthleteId } : {}),
    }
    await db.athleteProfiles.put(updated)
    return updated
  }

  const created: AthleteProfile = {
    id: localId,
    updatedAt,
    ...safePatch,
    ...(activeAthleteId ? { athleteId: activeAthleteId } : {}),
  }
  await db.athleteProfiles.put(created)
  return created
}
