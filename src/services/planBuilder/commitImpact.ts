import { addDays } from 'date-fns'
import { db } from '../../db/db'
import type { AthleteProfile, CoachSessionProposal, Session } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { fromISO, toISO } from '../../utils/date'
import { filterCoachSessionsToAllowedSports } from '../planningConstraints'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'

export interface PlanCommitWeekImpact {
  weekIndex: number
  weekStartDate: string
  weekEndDate: string
  generatedSessions: CoachSessionProposal[]
  creatableSessions: CoachSessionProposal[]
  filteredSessions: CoachSessionProposal[]
  replacedPlannedSessions: Session[]
  preservedHistorySessions: Session[]
  blockedByHistorySessions: Array<{ proposed: CoachSessionProposal; existing: Session }>
  untouchedPlannedSessions: Session[]
}

export interface PlanCommitImpact {
  weeks: PlanCommitWeekImpact[]
  totals: {
    generatedSessions: number
    creatableSessions: number
    filteredSessions: number
    replacedPlannedSessions: number
    preservedHistorySessions: number
    blockedByHistorySessions: number
    untouchedPlannedSessions: number
  }
  hasExistingPlannedSessions: boolean
  hasHistoryConflicts: boolean
  hasFilteredSessions: boolean
}

function getWeekEndDate(weekStartDate: string): string {
  return toISO(addDays(fromISO(weekStartDate), 6))
}

function emptyTotals(): PlanCommitImpact['totals'] {
  return {
    generatedSessions: 0,
    creatableSessions: 0,
    filteredSessions: 0,
    replacedPlannedSessions: 0,
    preservedHistorySessions: 0,
    blockedByHistorySessions: 0,
    untouchedPlannedSessions: 0,
  }
}

function addToTotals(totals: PlanCommitImpact['totals'], week: PlanCommitWeekImpact): void {
  totals.generatedSessions += week.generatedSessions.length
  totals.creatableSessions += week.creatableSessions.length
  totals.filteredSessions += week.filteredSessions.length
  totals.replacedPlannedSessions += week.replacedPlannedSessions.length
  totals.preservedHistorySessions += week.preservedHistorySessions.length
  totals.blockedByHistorySessions += week.blockedByHistorySessions.length
  totals.untouchedPlannedSessions += week.untouchedPlannedSessions.length
}

export async function analyzePlanCommitImpact(
  _plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  athleteProfile: AthleteProfile | null,
): Promise<PlanCommitImpact> {
  const orderedWeeks = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
  const impactWeeks: PlanCommitWeekImpact[] = []
  const totals = emptyTotals()

  for (const week of orderedWeeks) {
    const weekStartDate = week.weekStartDate
    const weekEndDate = getWeekEndDate(weekStartDate)
    const generatedSessions = week.sessions
    const allowedSessions = filterCoachSessionsToAllowedSports(generatedSessions, athleteProfile)
    const allowedSet = new Set(allowedSessions)
    const filteredSessions = generatedSessions.filter((session) => !allowedSet.has(session))
    const replacementDates = new Set(allowedSessions.map((session) => session.date))
    const existingWeekSessions = filterRowsToActiveScope(
      await db.sessions
        .where('date')
        .between(weekStartDate, weekEndDate, true, true)
        .toArray(),
    )

    const replacedPlannedSessions = existingWeekSessions.filter(
      (session) => session.status === 'planned' && replacementDates.has(session.date),
    )
    const preservedHistorySessions = existingWeekSessions.filter(
      (session) => session.status !== 'planned' && replacementDates.has(session.date),
    )
    const untouchedPlannedSessions = existingWeekSessions.filter(
      (session) => session.status === 'planned' && !replacementDates.has(session.date),
    )
    const blockedByHistorySessions = allowedSessions
      .map((proposed) => {
        const existing = preservedHistorySessions.find((session) =>
          session.date === proposed.date && session.timeBlock === proposed.timeBlock,
        )
        return existing ? { proposed, existing } : null
      })
      .filter((item): item is { proposed: CoachSessionProposal; existing: Session } => item != null)
    const blockedKeys = new Set(blockedByHistorySessions.map(({ proposed }) => `${proposed.date}|${proposed.timeBlock}`))
    const creatableSessions = allowedSessions.filter((session) => !blockedKeys.has(`${session.date}|${session.timeBlock}`))

    const weekImpact: PlanCommitWeekImpact = {
      weekIndex: week.weekIndex,
      weekStartDate,
      weekEndDate,
      generatedSessions,
      creatableSessions,
      filteredSessions,
      replacedPlannedSessions,
      preservedHistorySessions,
      blockedByHistorySessions,
      untouchedPlannedSessions,
    }
    impactWeeks.push(weekImpact)
    addToTotals(totals, weekImpact)
  }

  return {
    weeks: impactWeeks,
    totals,
    hasExistingPlannedSessions: totals.replacedPlannedSessions > 0 || totals.untouchedPlannedSessions > 0,
    hasHistoryConflicts: totals.preservedHistorySessions > 0 || totals.blockedByHistorySessions > 0,
    hasFilteredSessions: totals.filteredSessions > 0,
  }
}
