import { addDays } from 'date-fns'
import { db } from '../../db/db'
import type { AthleteProfile, CoachSessionProposal, Session } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { fromISO, toISO } from '../../utils/date'
import { filterCoachSessionsToAllowedSports } from '../planningConstraints'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import {
  getPlanLifecycleCutoff,
  selectActivePlansToSupersede,
  selectSupersededPlanSessionsForCleanup,
} from './planLifecycle'

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
    lifecycleRemovedSessions: number
  }
  lifecycleRemovedSessions: Session[]
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
    lifecycleRemovedSessions: 0,
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
  plan: TrainingPlan,
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
    const existingWeekSessions = filterRowsToActiveScope(
      await db.sessions
        .where('date')
        .between(weekStartDate, weekEndDate, true, true)
        .toArray(),
    )

    const appliesReplacement = allowedSessions.length > 0
    const replacedPlannedSessions = appliesReplacement ? existingWeekSessions.filter(
      (session) => (
        session.status === 'planned'
        && session.source !== 'manual'
      ),
    ) : []
    const preservedHistorySessions = appliesReplacement ? existingWeekSessions.filter(
      (session) => (
        (session.status !== 'planned' || session.source === 'manual')
      ),
    ) : []
    const untouchedPlannedSessions = existingWeekSessions.filter(
      (session) => (
        session.status === 'planned'
        && !appliesReplacement
      ),
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

  const supersededPlanIds = new Set(
    selectActivePlansToSupersede(await db.trainingPlans.toArray(), plan)
      .map((candidate) => candidate.id),
  )
  const replacementIds = new Set(
    impactWeeks.flatMap((week) => week.replacedPlannedSessions.map((session) => session.id)),
  )
  const lifecycleCutoff = getPlanLifecycleCutoff(plan)
  const lifecycleRemovedSessions = supersededPlanIds.size === 0
    ? []
    : selectSupersededPlanSessionsForCleanup(
        await db.sessions.where('date').aboveOrEqual(lifecycleCutoff).toArray(),
        supersededPlanIds,
        lifecycleCutoff,
      ).filter((session) => !replacementIds.has(session.id))
  totals.lifecycleRemovedSessions = lifecycleRemovedSessions.length

  return {
    weeks: impactWeeks,
    totals,
    lifecycleRemovedSessions,
    hasExistingPlannedSessions: totals.replacedPlannedSessions > 0
      || totals.untouchedPlannedSessions > 0
      || totals.lifecycleRemovedSessions > 0,
    hasHistoryConflicts: totals.preservedHistorySessions > 0 || totals.blockedByHistorySessions > 0,
    hasFilteredSessions: totals.filteredSessions > 0,
  }
}
