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
import { addDays, subWeeks } from 'date-fns'
import type { Session, SessionType } from '../types'

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
   * Acute:Chronic Workload Ratio.
   * Null when there is no previous training load to use as chronic baseline.
   * Thresholds: <0.8 undertrained, 0.8–1.3 optimal, >1.3 risk.
   * When baselineLimited is true, show it as directional guidance only.
   */
  acwr: ACWR | null
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

    if (session.status === 'completed' || session.status === 'adjusted') {
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes load analytics for the last N weeks (default 4).
 * Returns weeks ordered newest-first.
 */
export async function computeLoadAnalytics(weeksBack = 4): Promise<LoadAnalytics> {
  const today = new Date()
  const currentWeekStart = toISO(getWeekStart(today))

  // Collect week starts (current + previous N-1)
  const weekStarts: string[] = []
  for (let i = 0; i < weeksBack; i++) {
    weekStarts.push(toISO(getWeekStart(subWeeks(today, i))))
  }

  // Query all sessions in the date range in a single Dexie call
  const oldestWeekStart = weekStarts[weekStarts.length - 1]
  const endDate = toISO(addDays(fromISO(currentWeekStart), 6))
  const allSessions = await db.sessions
    .where('date')
    .between(oldestWeekStart, endDate, true, true)
    .toArray()

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
  }
}
