import type { CoachSessionProposal, SupportedSport } from '../../types'
import type { PlanValidationIssue, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { getExpectedSessionsForPlanWeek } from './dateRange'
import { validatePlan, validatePlanWeek } from './validator'

export type PlanQualityGrade = 'excellent' | 'good' | 'needs_review' | 'poor'

export interface PlanQualityWeekReview {
  weekIndex: number
  weekStartDate: string
  score: number
  grade: PlanQualityGrade
  issues: PlanValidationIssue[]
  repairCount: number
}

export interface PlanQualityReview {
  score: number
  grade: PlanQualityGrade
  issues: PlanValidationIssue[]
  weeks: PlanQualityWeekReview[]
  repairCount: number
  criticalIssueCount: number
  warningCount: number
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function gradeFromScore(score: number): PlanQualityGrade {
  if (score >= 90) return 'excellent'
  if (score >= 78) return 'good'
  if (score >= 62) return 'needs_review'
  return 'poor'
}

function issue(input: {
  severity: PlanValidationIssue['severity']
  code: string
  message: string
  weekIndex?: number
}): PlanValidationIssue {
  return input
}

function getPrimarySport(plan: TrainingPlan): SupportedSport | undefined {
  return plan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
}

function countBySport(sessions: CoachSessionProposal[]): Partial<Record<SupportedSport, number>> {
  return sessions.reduce<Partial<Record<SupportedSport, number>>>((acc, session) => {
    const sport = session.sessionType as SupportedSport
    acc[sport] = (acc[sport] ?? 0) + 1
    return acc
  }, {})
}

function weekLoad(week: TrainingPlanWeek): number {
  return week.sessions.reduce((total, session) => total + session.durationMin * (session.rpe ?? 6), 0)
}

function hasRunningStructure(session: CoachSessionProposal): boolean {
  return Boolean(
    session.runningType
    && (session.targetPaceMin || session.targetPaceMax || session.targetHrMin || session.targetHrMax)
    && Array.isArray(session.intervalStructure?.blocks)
    && session.intervalStructure.blocks.length > 0,
  )
}

function strengthDensityTarget(durationMin: number): number {
  if (durationMin >= 60) return 6
  if (durationMin >= 45) return 5
  return 3
}

function getSportCompletenessIssues(week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []

  for (const session of week.sessions) {
    if (session.sessionType === 'running' && !hasRunningStructure(session)) {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.running.incomplete_structure',
        message: `Running sin ritmos/HR o estructura de bloques (${session.date}).`,
        weekIndex: week.weekIndex,
      }))
    }

    if (session.sessionType === 'strength') {
      const exercises = session.exercises ?? []
      const target = strengthDensityTarget(session.durationMin)
      if (exercises.length < target) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.strength.low_density',
          message: `Fuerza con baja densidad (${exercises.length}/${target} ejercicios) en ${session.date}.`,
          weekIndex: week.weekIndex,
        }))
      }
      if (!exercises.some((exercise) => exercise.group === 'core')) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.strength.missing_core',
          message: `Fuerza sin bloque explícito de zona media en ${session.date}.`,
          weekIndex: week.weekIndex,
        }))
      }
    }

    if (session.sessionType === 'squash') {
      const drills = session.squashDetails?.drills ?? []
      if (drills.length < 2 && session.durationMin >= 45) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.squash.low_drill_depth',
          message: `Squash con pocos drills específicos (${drills.length}) en ${session.date}.`,
          weekIndex: week.weekIndex,
        }))
      }
    }
  }

  return issues
}

function getDistributionIssues(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const primarySport = getPrimarySport(plan)
  const expected = getExpectedSessionsForPlanWeek(plan, week)
  const counts = countBySport(week.sessions)

  if (
    primarySport === 'squash'
    && (week.phase === 'build' || week.phase === 'peak')
    && expected >= 5
    && (counts.strength ?? 0) === 0
  ) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.support.missing_strength',
      message: `Semana ${week.weekIndex + 1} no incluye fuerza de soporte pese a ser bloque ${week.phase}.`,
      weekIndex: week.weekIndex,
    }))
  }

  if (
    primarySport === 'squash'
    && (week.phase === 'build' || week.phase === 'peak')
    && expected >= 5
    && (counts.running ?? 0) === 0
    && (counts.cycling ?? 0) === 0
  ) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.support.missing_aerobic',
      message: `Semana ${week.weekIndex + 1} no incluye trabajo aeróbico complementario.`,
      weekIndex: week.weekIndex,
    }))
  }

  return issues
}

function getHardSessionClusterIssues(week: TrainingPlanWeek): PlanValidationIssue[] {
  const hardDates = new Set(
    week.sessions
      .filter((session) => (session.rpe ?? 6) >= 8)
      .map((session) => session.date),
  )
  const sortedDates = [...hardDates].sort()
  const issues: PlanValidationIssue[] = []

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(`${sortedDates[i - 1]}T00:00:00.000Z`).getTime()
    const curr = new Date(`${sortedDates[i]}T00:00:00.000Z`).getTime()
    const dayDiff = Math.round((curr - prev) / (24 * 60 * 60 * 1000))
    if (dayDiff === 1) {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.load.hard_days_clustered',
        message: `Semana ${week.weekIndex + 1} acumula sesiones duras en días consecutivos.`,
        weekIndex: week.weekIndex,
      }))
      break
    }
  }

  return issues
}

function getPlanLevelIssues(weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const generated = weeks.filter((week) => week.sessions.length > 0).sort((a, b) => a.weekIndex - b.weekIndex)

  for (let i = 1; i < generated.length; i++) {
    const prev = weekLoad(generated[i - 1])
    const curr = weekLoad(generated[i])
    if (prev <= 0) continue
    const jump = (curr - prev) / prev
    if (jump > 0.3 && generated[i].phase !== 'race') {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.load.progression_jump',
        message: `La carga sube ${Math.round(jump * 100)}% entre semanas ${generated[i - 1].weekIndex + 1} y ${generated[i].weekIndex + 1}.`,
        weekIndex: generated[i].weekIndex,
      }))
    }
  }

  for (let i = 1; i < generated.length; i++) {
    const week = generated[i]
    const prev = generated[i - 1]
    if (week.phase !== 'taper') continue
    const prevLoad = weekLoad(prev)
    const taperLoad = weekLoad(week)
    if (prevLoad > 0 && taperLoad > prevLoad * 0.9) {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.taper.not_reduced',
        message: `La semana taper ${week.weekIndex + 1} no reduce claramente la carga frente a la semana anterior.`,
        weekIndex: week.weekIndex,
      }))
    }
  }

  return issues
}

function scoreWeek(issues: PlanValidationIssue[], repairCount: number): number {
  const penalty = issues.reduce((total, item) => {
    if (item.severity === 'error') return total + 22
    if (item.severity === 'warning') return total + 7
    return total + 3
  }, 0)
  const repairCredit = Math.min(6, repairCount)
  return clampScore(100 - penalty + repairCredit)
}

function scorePlan(weeks: PlanQualityWeekReview[], planIssues: PlanValidationIssue[], repairCount: number): number {
  if (weeks.length === 0) return 0
  const average = weeks.reduce((total, week) => total + week.score, 0) / weeks.length
  const planPenalty = planIssues.reduce((total, item) => total + (item.severity === 'error' ? 14 : item.severity === 'warning' ? 5 : 2), 0)
  const repairCredit = Math.min(4, Math.floor(repairCount / 2))
  return clampScore(average - planPenalty + repairCredit)
}

function countRepairs(week: TrainingPlanWeek): number {
  const meta = week.generationMeta
  return (meta.repairedSessionCount ?? 0)
    + (meta.movedSessionCount ?? 0)
    + (meta.addedFallbackCount ?? 0)
    + (meta.filteredSportCount ?? 0)
}

export function reviewPlanQuality(plan: TrainingPlan, weeks: TrainingPlanWeek[]): PlanQualityReview {
  const sortedWeeks = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
  const planValidationIssues = validatePlan({ plan, weeks: sortedWeeks })
  const planLevelQualityIssues = getPlanLevelIssues(sortedWeeks)

  const weekReviews = sortedWeeks.map((week) => {
    const issues = [
      ...validatePlanWeek(plan, week),
      ...getSportCompletenessIssues(week),
      ...getDistributionIssues(plan, week),
      ...getHardSessionClusterIssues(week),
      ...planLevelQualityIssues.filter((item) => item.weekIndex === week.weekIndex),
    ]
    const repairCount = countRepairs(week)
    const score = scoreWeek(issues, repairCount)
    return {
      weekIndex: week.weekIndex,
      weekStartDate: week.weekStartDate,
      score,
      grade: gradeFromScore(score),
      issues,
      repairCount,
    }
  })

  const allIssues = [
    ...planValidationIssues,
    ...planLevelQualityIssues,
    ...weekReviews.flatMap((week) => week.issues),
  ]
  const uniqueIssues = allIssues.filter((item, index, arr) =>
    arr.findIndex((candidate) =>
      candidate.code === item.code
      && candidate.weekIndex === item.weekIndex
      && candidate.message === item.message,
    ) === index,
  )
  const repairCount = sortedWeeks.reduce((total, week) => total + countRepairs(week), 0)
  const score = scorePlan(weekReviews, planLevelQualityIssues, repairCount)

  return {
    score,
    grade: gradeFromScore(score),
    issues: uniqueIssues,
    weeks: weekReviews,
    repairCount,
    criticalIssueCount: uniqueIssues.filter((item) => item.severity === 'error').length,
    warningCount: uniqueIssues.filter((item) => item.severity === 'warning').length,
  }
}
