import { addDays } from 'date-fns'
import type { CoachAction, CoachProposal, Session, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { db } from '../../db/db'
import { getWeekSummary } from '../../db/queries'
import * as syncService from '../syncService'
import { useCoachActionsStore } from '../../store/useCoachActionsStore'
import { useTrainingStore } from '../../store/useTrainingStore'
import { fromISO, toISO } from '../../utils/date'
import { validatePlan } from './validator'

export interface CommitPlanResult {
  errors: string[]
  warnings: string[]
  acceptedWeeks: number[]
}

interface WeekCommitSnapshot {
  weekIndex: number
  weekStartDate: string
  sessions: Session[]
  summary: WeekSummary | null
  proposalId: string | null
}

function getWeekEndDate(weekStartDate: string): string {
  return toISO(addDays(fromISO(weekStartDate), 6))
}

async function captureWeekCommitSnapshot(week: TrainingPlanWeek): Promise<WeekCommitSnapshot> {
  const sessions = await db.sessions
    .where('date')
    .between(week.weekStartDate, getWeekEndDate(week.weekStartDate), true, true)
    .toArray()
  const summary = await getWeekSummary(week.weekStartDate)

  return {
    weekIndex: week.weekIndex,
    weekStartDate: week.weekStartDate,
    sessions: sessions.map((session) => ({ ...session })),
    summary: summary ? { ...summary } : null,
    proposalId: null,
  }
}

async function markProposalRolledBack(proposalId: string): Promise<void> {
  const proposal = await db.coachProposals.get(proposalId)
  if (!proposal) return

  const rolledBackProposal: CoachProposal = {
    ...proposal,
    status: 'rejected',
    resolvedAt: Date.now(),
    metadata: proposal.metadata
      ? { ...proposal.metadata, resolutionOutcome: 'rejected' }
      : proposal.metadata,
  }

  await db.coachProposals.put(rolledBackProposal)
  void syncService.pushCoachProposal(rolledBackProposal)
  useCoachActionsStore.setState((state) => ({
    proposals: state.proposals.map((item) => item.id === proposalId ? rolledBackProposal : item),
  }))
}

async function restoreWeekCommitSnapshots(snapshots: WeekCommitSnapshot[]): Promise<void> {
  const trainingStore = useTrainingStore.getState()
  const affectedWeekStarts = new Set<string>()

  for (const snapshot of [...snapshots].reverse()) {
    const currentSessions = await db.sessions
      .where('date')
      .between(snapshot.weekStartDate, getWeekEndDate(snapshot.weekStartDate), true, true)
      .toArray()
    const snapshotSessionIds = new Set(snapshot.sessions.map((session) => session.id))

    for (const session of currentSessions) {
      if (snapshotSessionIds.has(session.id)) continue
      await db.sessions.delete(session.id)
      void syncService.deleteSession(session.id)
    }

    for (const session of snapshot.sessions) {
      await db.sessions.put(session)
      void syncService.pushSession(session)
    }

    const currentSummary = await getWeekSummary(snapshot.weekStartDate)
    if (snapshot.summary) {
      await db.weekSummaries.put(snapshot.summary)
      void syncService.pushWeekSummary(snapshot.summary)
    } else if (currentSummary) {
      await db.weekSummaries.delete(currentSummary.id)
    }

    if (snapshot.proposalId) {
      await markProposalRolledBack(snapshot.proposalId)
    }

    affectedWeekStarts.add(snapshot.weekStartDate)
  }

  if (trainingStore.loadedWeekStart && affectedWeekStarts.has(trainingStore.loadedWeekStart)) {
    await trainingStore.loadWeek(trainingStore.loadedWeekStart)
  }
  await trainingStore.loadAllSummaries()
}

function describeWeekReadiness(week: TrainingPlanWeek): string | null {
  if (week.status !== 'draft') {
    return `Semana ${week.weekIndex + 1} no está lista para aceptar (estado ${week.status}).`
  }
  if (week.sessions.length === 0) {
    return `Semana ${week.weekIndex + 1} no tiene sesiones generadas.`
  }
  return null
}

/**
 * Commits a draft TrainingPlan by expanding each generated week into real sessions.
 * Reuses the coach actions store to benefit from validation, protocol injection,
 * collision detection, and week summary recomputation.
 */
export async function commitPlan(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
): Promise<CommitPlanResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const acceptedWeeks: number[] = []
  const store = useCoachActionsStore.getState()
  const orderedWeeks = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
  const readinessErrors = orderedWeeks
    .map(describeWeekReadiness)
    .filter((issue): issue is string => issue != null)

  if (readinessErrors.length > 0) {
    return { errors: readinessErrors, warnings, acceptedWeeks }
  }

  const validationIssues = validatePlan({ plan, weeks: orderedWeeks })
  const validationErrors = validationIssues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
  warnings.push(...validationIssues.filter((issue) => issue.severity !== 'error').map((issue) => issue.message))

  if (validationErrors.length > 0) {
    return { errors: validationErrors, warnings, acceptedWeeks }
  }

  const appliedSnapshots: WeekCommitSnapshot[] = []

  for (const week of orderedWeeks) {
    const snapshot = await captureWeekCommitSnapshot(week)
    const action: CoachAction = {
      type: 'create_week',
      targetDate: week.weekStartDate,
      sessions: week.sessions,
      weekObjectives: week.weekObjectives.map((o) => o.goal),
      reason: `Plan "${plan.title}" semana ${week.weekIndex + 1}/${plan.totalWeeks} (${week.phase})`,
    }
    try {
      const proposal = await store.addProposal(
        `Plan Builder: semana ${week.weekIndex + 1} de ${plan.totalWeeks}`,
        [action],
        undefined,
        { source: 'plan_builder' },
      )
      snapshot.proposalId = proposal.id
      const result = await store.acceptProposal(proposal.id)
      if (result.errors.length > 0) {
        errors.push(...result.errors.map((err) => `Semana ${week.weekIndex + 1}: ${err}`))
      } else {
        acceptedWeeks.push(week.weekIndex)
        appliedSnapshots.push(snapshot)
      }
      warnings.push(...result.warnings)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`Semana ${week.weekIndex + 1}: ${msg}`)
    }

    if (errors.length > 0) break
  }

  if (errors.length > 0 && appliedSnapshots.length > 0) {
    await restoreWeekCommitSnapshots(appliedSnapshots)
    warnings.push(`Se revirtieron ${appliedSnapshots.length} semanas aceptadas antes del fallo.`)
    acceptedWeeks.length = 0
  }

  if (errors.length === 0) {
    const nowTs = Date.now()
    const nextPlan: TrainingPlan = {
      ...plan,
      status: 'active',
      acceptedAt: nowTs,
      updatedAt: nowTs,
      generationSummary: plan.generationSummary
        ? {
          ...plan.generationSummary,
          acceptedAt: plan.generationSummary.acceptedAt ?? nowTs,
        }
        : undefined,
    }
    const nextWeeks = orderedWeeks.map((w) => ({
      ...w,
      status: acceptedWeeks.includes(w.weekIndex) ? 'accepted' : w.status,
      updatedAt: nowTs,
    }))
    await db.trainingPlans.put(nextPlan)
    await Promise.all(
      nextWeeks.map((w) => db.trainingPlanWeeks.put(w)),
    )
    void syncService.pushTrainingPlan(nextPlan)
    void syncService.pushTrainingPlanWeeks(nextPlan, nextWeeks.filter((week) => week.status === 'accepted'))
  }

  return { errors, warnings, acceptedWeeks }
}
