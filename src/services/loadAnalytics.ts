/**
 * Load analytics: computes accumulated training load per discipline
 * across multiple weeks, plus trend and adherence metrics.
 *
 * Design goals:
 * - Pure computation over Dexie sessions — no store coupling
 * - Output feeds both the AI coach prompt and the UI
 * - "Load" = completed minutes × actual RPE (or planned RPE fallback = 6)
 *   This is a simplified Training Stress metric comparable across weeks
 */

import { db } from '../db/db'
import { toISO, fromISO, getWeekStart } from '../utils/date'
import { isCompetitionSquashMatch, isPracticeSquashMatch } from '../utils/squash'
import { addDays, subWeeks } from 'date-fns'
import type { Session, SessionType } from '../types'
import { filterRowsToActiveScope } from './athlete/activeScopeFilter'

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoadTrend = 'increasing' | 'stable' | 'decreasing'

export interface DisciplineWeekLoad {
  type: SessionType
  completedSessions: number
  plannedSessions: number
  completedMinutes: number
  plannedMinutes: number
  /** sum of (actualDuration × actualRpe) for completed sessions */
  weightedLoad: number
}

export interface WeekLoadSummary {
  weekStart: string           // ISO Monday
  disciplines: DisciplineWeekLoad[]
  totalCompletedMinutes: number
  totalPlannedMinutes: number
  totalWeightedLoad: number
  adherencePct: number        // completed / (planned non-skipped) × 100
  avgActualRpe: number | null
  /** Running time in minutes (subset of disciplines) */
  runningMinutes: number
  cyclingMinutes: number
}

export type ACWRZone = 'undertrained' | 'optimal' | 'risk' | 'limited'

export interface ACWR {
  /** Acute load: current week weighted load */
  acute: number
  /** Chronic load: average of previous loaded weeks, excluding current week */
  chronic: number
  /** Ratio: acute / chronic */
  ratio: number
  /** Traffic-light zone based on standard sport science thresholds */
  zone: ACWRZone
  /** Number of previous weeks used to build the chronic baseline */
  baselineWeeks: number
  /** When true, the ratio is informative but not strong enough for a hard warning */
  baselineLimited: boolean
}

/** Disciplines tracked for per-sport ACWR */
export type SportKey = 'squash' | 'running' | 'strength' | 'cycling'

export interface DisciplineAcwr {
  sport: SportKey
  acuteLoad: number
  chronicLoad: number
  /** Null when there is no baseline or the sport had no load this week */
  ratio: number | null
  status: ACWRZone
  baselineWeeks: number
}

export interface RunningWeeklyLoad {
  weekStart: string
  totalLoad: number
  totalDurationMin?: number
  totalDistanceKm?: number
  sessionsCount: number
}

export interface RunningAcwr {
  acuteLoad: number
  chronicLoad: number
  ratio: number | null
  status: ACWRZone
  baselineWeeks: number
}

export interface SquashWeeklyLoad {
  weekStart: string
  /** sum of (actualDurationMin × actualRpe) for completed squash sessions */
  totalLoad: number
  sessionsCount: number
  /** sessions with subtype 'match' or 'competitive' */
  matchCount: number
  practiceMatchCount: number
  competitionMatchCount: number
  competitiveExposureScore: number
  totalDurationMin: number
}

export interface StrengthWeeklyLoad {
  weekStart: string
  /** sum of (actualDurationMin × actualRpe) for completed strength sessions */
  totalLoad: number
  sessionsCount: number
  totalDurationMin: number
}

export interface CyclingWeeklyLoad {
  weekStart: string
  /** sum of (actualDurationMin × actualRpe) for completed cycling sessions */
  totalLoad: number
  sessionsCount: number
  totalDurationMin: number
}

export interface LoadAnalytics {
  /** Ordered newest-first: [0] = current week, [1] = last week … */
  weeks: WeekLoadSummary[]
  /** Overall load trend current vs previous week */
  overallTrend: LoadTrend
  /** Running-specific trend current vs previous */
  runningTrend: LoadTrend
  /** Adherence trend: is the athlete completing more or fewer sessions? */
  adherenceTrend: LoadTrend
  /**
   * Acute:Chronic Workload Ratio (global, all disciplines combined).
   * Null when there is no previous training load to use as chronic baseline.
   * Thresholds: <0.8 undertrained, 0.8–1.3 optimal, >1.3 risk.
   * When baselineLimited is true, show it as directional guidance only.
   */
  acwr: ACWR | null
  /** Per-discipline ACWR for squash, running and strength */
  acwrByDiscipline: Record<SportKey, DisciplineAcwr>
  /** Running-only weekly load history, newest-first */
  runningWeeklyLoads: RunningWeeklyLoad[]
  /** Explicit running ACWR wrapper for selector/prompt consumers */
  runningAcwr: RunningAcwr
  /** Squash-only weekly load history, newest-first */
  squashWeeklyLoads: SquashWeeklyLoad[]
  /** Explicit squash ACWR for selector/prompt consumers */
  squashAcwr: DisciplineAcwr
  /** Strength-only weekly load history, newest-first */
  strengthWeeklyLoads: StrengthWeeklyLoad[]
  /** Explicit strength ACWR for selector/prompt consumers */
  strengthAcwr: DisciplineAcwr
  /** Cycling-only weekly load history, newest-first */
  cyclingWeeklyLoads: CyclingWeeklyLoad[]
  /** Explicit cycling ACWR for selector/prompt consumers */
  cyclingAcwr: DisciplineAcwr
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RPE = 6
const TRAINING_TYPES: SessionType[] = ['squash', 'running', 'cycling', 'strength', 'mobility']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function weekDates(weekStart: string): string[] {
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    dates.push(toISO(addDays(fromISO(weekStart), i)))
  }
  return dates
}

function sessionWeightedLoad(session: Session): number {
  const minutes = session.actualDurationMin ?? session.durationMin
  const rpe = session.actualRpe ?? session.rpe ?? DEFAULT_RPE
  return minutes * rpe
}

function isCompletedSession(session: Session): boolean {
  return session.status === 'completed' || session.status === 'adjusted'
}

function parsePaceToMinutes(pace?: string): number | null {
  if (!pace) return null
  const parts = pace.trim().split(':').map(Number)
  if (parts.length !== 2 || parts.some((value) => Number.isNaN(value))) return null
  return parts[0] + (parts[1] / 60)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function estimateRunningDistanceKm(session: Session): number | undefined {
  if (session.type !== 'running') return undefined

  const text = [
    session.notes,
    session.completionNotes,
    session.objective,
    session.title,
  ]
    .filter(Boolean)
    .join(' ')

  const distanceMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(km|kms|kilometros?|kilómetros?|\bk\b)/i)
  if (distanceMatch) {
    const distance = Number(distanceMatch[1].replace(',', '.'))
    if (Number.isFinite(distance) && distance > 0) return round1(distance)
  }

  const paceMin = parsePaceToMinutes(session.runningDetails?.targetPaceMin)
  const paceMax = parsePaceToMinutes(session.runningDetails?.targetPaceMax)
  const resolvedPace =
    paceMin != null && paceMax != null
      ? (paceMin + paceMax) / 2
      : paceMin ?? paceMax

  if (resolvedPace != null && resolvedPace > 0) {
    const duration = session.actualDurationMin ?? session.durationMin
    if (duration > 0) return round1(duration / resolvedPace)
  }

  return undefined
}

function resolveWeekStartsForSport(
  sessions: Session[],
  sport: SessionType,
  minWeeks = 4,
  referenceDate: Date = new Date(),
): string[] {
  const currentWeekStart = toISO(getWeekStart(referenceDate))
  const sportSessions = sessions
    .filter((session) => session.type === sport && isCompletedSession(session))
    .sort((a, b) => a.date.localeCompare(b.date))

  const oldestDate = sportSessions[0]?.date
  const oldestWeekStart = oldestDate ? toISO(getWeekStart(fromISO(oldestDate))) : currentWeekStart

  const weeks: string[] = []
  let cursor = fromISO(currentWeekStart)

  while (weeks.length < minWeeks || toISO(cursor) >= oldestWeekStart) {
    weeks.push(toISO(cursor))
    cursor = subWeeks(cursor, 1)
  }

  return weeks
}

function resolveWeekStarts(sessions: Session[], minWeeks = 4, referenceDate: Date = new Date()): string[] {
  return resolveWeekStartsForSport(sessions, 'running', minWeeks, referenceDate)
}

function calculateDisciplineAcwrFromLoads(
  sport: SportKey,
  loads: Array<{ totalLoad: number }>,
): DisciplineAcwr {
  const acuteLoad = loads[0]?.totalLoad ?? 0
  const baselineLoads = loads.slice(1).filter((load) => load.totalLoad > 0)

  if (acuteLoad <= 0) {
    return { sport, acuteLoad: 0, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 }
  }

  if (baselineLoads.length === 0) {
    return { sport, acuteLoad, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 }
  }

  const chronicLoad = baselineLoads.reduce((sum, load) => sum + load.totalLoad, 0) / baselineLoads.length
  const ratio = acuteLoad / chronicLoad
  const baselineLimited = baselineLoads.length < 3

  let status: ACWRZone
  if (baselineLimited) {
    status = 'limited'
  } else if (ratio < 0.8) {
    status = 'undertrained'
  } else if (ratio > 1.3) {
    status = 'risk'
  } else {
    status = 'optimal'
  }

  return { sport, acuteLoad, chronicLoad, ratio, status, baselineWeeks: baselineLoads.length }
}

export function getRunningWeeklyLoads(
  sessions: Session[],
  referenceDate: Date = new Date(),
): RunningWeeklyLoad[] {
  const weekStarts = resolveWeekStarts(sessions, 4, referenceDate)
  const byWeek = new Map<string, RunningWeeklyLoad>()

  for (const weekStart of weekStarts) {
    byWeek.set(weekStart, {
      weekStart,
      totalLoad: 0,
      totalDurationMin: 0,
      sessionsCount: 0,
    })
  }

  for (const session of sessions) {
    if (session.type !== 'running' || !isCompletedSession(session)) continue

    const weekStart = toISO(getWeekStart(fromISO(session.date)))
    const existing = byWeek.get(weekStart)
    if (!existing) continue

    existing.totalLoad += sessionWeightedLoad(session)
    existing.totalDurationMin = (existing.totalDurationMin ?? 0) + (session.actualDurationMin ?? session.durationMin)
    existing.sessionsCount += 1

    const distanceKm = estimateRunningDistanceKm(session)
    if (distanceKm != null) {
      existing.totalDistanceKm = round1((existing.totalDistanceKm ?? 0) + distanceKm)
    }
  }

  return weekStarts.map((weekStart) => {
    const load = byWeek.get(weekStart)!
    return {
      weekStart,
      totalLoad: Math.round(load.totalLoad),
      totalDurationMin: load.totalDurationMin ?? 0,
      totalDistanceKm: load.totalDistanceKm,
      sessionsCount: load.sessionsCount,
    }
  })
}

export function calculateRunningAcwr(
  sessions: Session[],
  referenceDate: Date = new Date(),
): RunningAcwr {
  const running = calculateDisciplineAcwrFromLoads('running', getRunningWeeklyLoads(sessions, referenceDate))
  return {
    acuteLoad: running.acuteLoad,
    chronicLoad: running.chronicLoad,
    ratio: running.ratio,
    status: running.status,
    baselineWeeks: running.baselineWeeks,
  }
}

export function getSquashWeeklyLoads(sessions: Session[], referenceDate: Date = new Date()): SquashWeeklyLoad[] {
  const weekStarts = resolveWeekStartsForSport(sessions, 'squash', 4, referenceDate)
  const byWeek = new Map<string, SquashWeeklyLoad>()

  for (const weekStart of weekStarts) {
    byWeek.set(weekStart, {
      weekStart,
      totalLoad: 0,
      sessionsCount: 0,
      matchCount: 0,
      practiceMatchCount: 0,
      competitionMatchCount: 0,
      competitiveExposureScore: 0,
      totalDurationMin: 0,
    })
  }

  for (const session of sessions) {
    if (session.type !== 'squash' || !isCompletedSession(session)) continue

    const weekStart = toISO(getWeekStart(fromISO(session.date)))
    const existing = byWeek.get(weekStart)
    if (!existing) continue

    existing.totalLoad += sessionWeightedLoad(session)
    existing.totalDurationMin += session.actualDurationMin ?? session.durationMin
    existing.sessionsCount += 1
    if (isPracticeSquashMatch(session)) {
      existing.matchCount += 1
      existing.practiceMatchCount += 1
      existing.competitiveExposureScore += 1
    } else if (isCompetitionSquashMatch(session)) {
      existing.matchCount += 1
      existing.competitionMatchCount += 1
      existing.competitiveExposureScore += 1
    }
  }

  return weekStarts.map((weekStart) => {
    const load = byWeek.get(weekStart)!
    return {
      weekStart,
      totalLoad: Math.round(load.totalLoad),
      sessionsCount: load.sessionsCount,
      matchCount: load.matchCount,
      practiceMatchCount: load.practiceMatchCount,
      competitionMatchCount: load.competitionMatchCount,
      competitiveExposureScore: load.competitiveExposureScore,
      totalDurationMin: load.totalDurationMin,
    }
  })
}

export function calculateSquashAcwr(sessions: Session[], referenceDate: Date = new Date()): DisciplineAcwr {
  return calculateDisciplineAcwrFromLoads('squash', getSquashWeeklyLoads(sessions, referenceDate))
}

export function getStrengthWeeklyLoads(sessions: Session[], referenceDate: Date = new Date()): StrengthWeeklyLoad[] {
  const weekStarts = resolveWeekStartsForSport(sessions, 'strength', 4, referenceDate)
  const byWeek = new Map<string, StrengthWeeklyLoad>()

  for (const weekStart of weekStarts) {
    byWeek.set(weekStart, { weekStart, totalLoad: 0, sessionsCount: 0, totalDurationMin: 0 })
  }

  for (const session of sessions) {
    if (session.type !== 'strength' || !isCompletedSession(session)) continue

    const weekStart = toISO(getWeekStart(fromISO(session.date)))
    const existing = byWeek.get(weekStart)
    if (!existing) continue

    existing.totalLoad += sessionWeightedLoad(session)
    existing.totalDurationMin += session.actualDurationMin ?? session.durationMin
    existing.sessionsCount += 1
  }

  return weekStarts.map((weekStart) => {
    const load = byWeek.get(weekStart)!
    return {
      weekStart,
      totalLoad: Math.round(load.totalLoad),
      sessionsCount: load.sessionsCount,
      totalDurationMin: load.totalDurationMin,
    }
  })
}

export function calculateStrengthAcwr(sessions: Session[], referenceDate: Date = new Date()): DisciplineAcwr {
  return calculateDisciplineAcwrFromLoads('strength', getStrengthWeeklyLoads(sessions, referenceDate))
}

export function getCyclingWeeklyLoads(sessions: Session[], referenceDate: Date = new Date()): CyclingWeeklyLoad[] {
  const weekStarts = resolveWeekStartsForSport(sessions, 'cycling', 4, referenceDate)
  const byWeek = new Map<string, CyclingWeeklyLoad>()

  for (const weekStart of weekStarts) {
    byWeek.set(weekStart, { weekStart, totalLoad: 0, sessionsCount: 0, totalDurationMin: 0 })
  }

  for (const session of sessions) {
    if (session.type !== 'cycling' || !isCompletedSession(session)) continue

    const weekStart = toISO(getWeekStart(fromISO(session.date)))
    const existing = byWeek.get(weekStart)
    if (!existing) continue

    existing.totalLoad += sessionWeightedLoad(session)
    existing.totalDurationMin += session.actualDurationMin ?? session.durationMin
    existing.sessionsCount += 1
  }

  return weekStarts.map((weekStart) => {
    const load = byWeek.get(weekStart)!
    return {
      weekStart,
      totalLoad: Math.round(load.totalLoad),
      sessionsCount: load.sessionsCount,
      totalDurationMin: load.totalDurationMin,
    }
  })
}

export function calculateCyclingAcwr(sessions: Session[], referenceDate: Date = new Date()): DisciplineAcwr {
  return calculateDisciplineAcwrFromLoads('cycling', getCyclingWeeklyLoads(sessions, referenceDate))
}

function trend(current: number, previous: number): LoadTrend {
  if (previous === 0) return current > 0 ? 'increasing' : 'stable'
  const ratio = current / previous
  if (ratio > 1.12) return 'increasing'
  if (ratio < 0.88) return 'decreasing'
  return 'stable'
}

function computeAcwr(weeks: WeekLoadSummary[]): ACWR | null {
  const current = weeks[0]
  if (!current || current.totalWeightedLoad <= 0) {
    return null
  }

  const baselineWeeks = weeks
    .slice(1)
    .filter((week) => week.totalWeightedLoad > 0)

  if (baselineWeeks.length === 0) {
    return null
  }

  const acute = current.totalWeightedLoad
  const chronic = baselineWeeks.reduce((sum, week) => sum + week.totalWeightedLoad, 0) / baselineWeeks.length
  const ratio = acute / chronic
  const baselineLimited = baselineWeeks.length < 3

  let zone: ACWRZone
  if (baselineLimited) {
    zone = 'limited'
  } else if (ratio < 0.8) {
    zone = 'undertrained'
  } else if (ratio > 1.3) {
    zone = 'risk'
  } else {
    zone = 'optimal'
  }

  return {
    acute,
    chronic,
    ratio,
    zone,
    baselineWeeks: baselineWeeks.length,
    baselineLimited,
  }
}

function computeWeekSummary(weekStart: string, sessions: Session[]): WeekLoadSummary {
  const byType = new Map<SessionType, DisciplineWeekLoad>()

  for (const type of TRAINING_TYPES) {
    byType.set(type, {
      type,
      completedSessions: 0,
      plannedSessions: 0,
      completedMinutes: 0,
      plannedMinutes: 0,
      weightedLoad: 0,
    })
  }

  let rpeSum = 0
  let rpeCount = 0

  for (const session of sessions) {
    const type = session.type
    if (!TRAINING_TYPES.includes(type)) continue

    const entry = byType.get(type)!

    if (isCompletedSession(session)) {
      entry.completedSessions += 1
      const mins = session.actualDurationMin ?? session.durationMin
      entry.completedMinutes += mins
      entry.weightedLoad += sessionWeightedLoad(session)
      if (session.actualRpe != null) {
        rpeSum += session.actualRpe
        rpeCount += 1
      }
    }

    if (session.status !== 'skipped') {
      entry.plannedSessions += 1
      entry.plannedMinutes += session.durationMin
    }
  }

  const disciplines = [...byType.values()].filter(
    d => d.plannedSessions > 0 || d.completedSessions > 0,
  )

  const totalPlanned = disciplines.reduce((sum, d) => sum + d.plannedSessions, 0)
  const totalCompleted = disciplines.reduce((sum, d) => sum + d.completedSessions, 0)

  return {
    weekStart,
    disciplines,
    totalCompletedMinutes: disciplines.reduce((sum, d) => sum + d.completedMinutes, 0),
    totalPlannedMinutes: disciplines.reduce((sum, d) => sum + d.plannedMinutes, 0),
    totalWeightedLoad: disciplines.reduce((sum, d) => sum + d.weightedLoad, 0),
    adherencePct: totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0,
    avgActualRpe: rpeCount > 0 ? Math.round((rpeSum / rpeCount) * 10) / 10 : null,
    runningMinutes: byType.get('running')?.completedMinutes ?? 0,
    cyclingMinutes: byType.get('cycling')?.completedMinutes ?? 0,
  }
}

function getDisciplineLoad(week: WeekLoadSummary, sport: SportKey): number {
  return week.disciplines.find(d => d.type === sport)?.weightedLoad ?? 0
}

export function computeAcwrByDiscipline(weeks: WeekLoadSummary[]): Record<SportKey, DisciplineAcwr> {
  const sports: SportKey[] = ['squash', 'running', 'strength', 'cycling']
  const result = {} as Record<SportKey, DisciplineAcwr>

  for (const sport of sports) {
    result[sport] = calculateDisciplineAcwrFromLoads(
      sport,
      weeks.map((week) => ({ totalLoad: getDisciplineLoad(week, sport) })),
    )
  }

  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes load analytics for the last N weeks (default 4).
 * Returns weeks ordered newest-first.
 */
export async function computeLoadAnalytics(
  weeksBack = 4,
  referenceDate: string | Date = new Date(),
): Promise<LoadAnalytics> {
  const resolvedReferenceDate = typeof referenceDate === 'string'
    ? fromISO(referenceDate)
    : referenceDate
  const currentWeekStart = toISO(getWeekStart(resolvedReferenceDate))

  // Collect week starts (current + previous N-1)
  const weekStarts: string[] = []
  for (let i = 0; i < weeksBack; i++) {
    weekStarts.push(toISO(getWeekStart(subWeeks(resolvedReferenceDate, i))))
  }

  // Query all sessions in the date range in a single Dexie call
  const oldestWeekStart = weekStarts[weekStarts.length - 1]
  const endDate = toISO(addDays(fromISO(currentWeekStart), 6))
  const allSessions = filterRowsToActiveScope(
    await db.sessions
      .where('date')
      .between(oldestWeekStart, endDate, true, true)
      .toArray(),
  )

  // Group sessions by week
  const sessionsByWeek = new Map<string, Session[]>()
  for (const ws of weekStarts) {
    sessionsByWeek.set(ws, [])
  }
  const dates = new Set(weekDates(currentWeekStart))
  for (const ws of weekStarts) {
    for (const d of weekDates(ws)) dates.add(d)
  }

  for (const session of allSessions) {
    for (const ws of weekStarts) {
      const datesForWeek = weekDates(ws)
      if (datesForWeek.includes(session.date)) {
        sessionsByWeek.get(ws)!.push(session)
        break
      }
    }
  }

  const weeks = weekStarts.map(ws =>
    computeWeekSummary(ws, sessionsByWeek.get(ws) ?? []),
  )

  const current = weeks[0]
  const previous = weeks[1]

  const acwr = computeAcwr(weeks)
  const acwrByDiscipline = computeAcwrByDiscipline(weeks)
  const runningWeeklyLoads = getRunningWeeklyLoads(allSessions, resolvedReferenceDate)
  const runningAcwr = calculateRunningAcwr(allSessions, resolvedReferenceDate)
  const squashWeeklyLoads = getSquashWeeklyLoads(allSessions, resolvedReferenceDate)
  const squashAcwr = calculateSquashAcwr(allSessions, resolvedReferenceDate)
  const strengthWeeklyLoads = getStrengthWeeklyLoads(allSessions, resolvedReferenceDate)
  const strengthAcwr = calculateStrengthAcwr(allSessions, resolvedReferenceDate)
  const cyclingWeeklyLoads = getCyclingWeeklyLoads(allSessions, resolvedReferenceDate)
  const cyclingAcwr = calculateCyclingAcwr(allSessions, resolvedReferenceDate)

  return {
    weeks,
    overallTrend: previous
      ? trend(current.totalWeightedLoad, previous.totalWeightedLoad)
      : 'stable',
    runningTrend: previous
      ? trend(current.runningMinutes, previous.runningMinutes)
      : 'stable',
    adherenceTrend: previous
      ? trend(current.adherencePct, previous.adherencePct)
      : 'stable',
    acwr,
    acwrByDiscipline,
    runningWeeklyLoads,
    runningAcwr,
    squashWeeklyLoads,
    squashAcwr,
    strengthWeeklyLoads,
    strengthAcwr,
    cyclingWeeklyLoads,
    cyclingAcwr,
  }
}
