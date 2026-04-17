import type { CoachSessionProposal, SupportedSport } from '../../types'
import type { PlanValidationIssue, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

export interface ValidatePlanInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
}

function validateStructure(plan: TrainingPlan, weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  if (weeks.length !== plan.totalWeeks) {
    issues.push({
      severity: 'error',
      code: 'plan.structure.weeks_mismatch',
      message: `El plan debería tener ${plan.totalWeeks} semanas pero hay ${weeks.length}.`,
    })
  }
  const sorted = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]
    const next = sorted[i + 1]
    if (next.weekIndex !== current.weekIndex + 1) {
      issues.push({
        severity: 'error',
        code: 'plan.structure.gap',
        message: `Hueco de semanas entre índice ${current.weekIndex} y ${next.weekIndex}.`,
      })
    }
  }
  return issues
}

function validateWeekSessions(week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  if (week.status !== 'draft' && week.status !== 'accepted') return issues

  if (!Array.isArray(week.sessions) || week.sessions.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'week.sessions.empty',
      message: 'La semana no tiene sesiones generadas.',
      weekIndex: week.weekIndex,
    })
    return issues
  }

  const dayBlockSet = new Set<string>()
  for (const session of week.sessions) {
    const key = `${session.date}|${session.timeBlock}`
    if (dayBlockSet.has(key)) {
      issues.push({
        severity: 'error',
        code: 'week.sessions.collision',
        message: `Colisión de sesiones en ${session.date} ${session.timeBlock}.`,
        weekIndex: week.weekIndex,
      })
    }
    dayBlockSet.add(key)

    if (session.sessionType === 'squash' && !session.squashDetails) {
      issues.push({
        severity: 'warning',
        code: 'session.squash.missing_details',
        message: `Sesión de squash sin squashDetails (${session.date}).`,
        weekIndex: week.weekIndex,
      })
    }
    if (session.sessionType === 'cycling' && !session.cyclingDetails) {
      issues.push({
        severity: 'warning',
        code: 'session.cycling.missing_details',
        message: `Sesión de cycling sin cyclingDetails (${session.date}).`,
        weekIndex: week.weekIndex,
      })
    }
    if (session.sessionType === 'mobility' && !session.mobilityDetails) {
      issues.push({
        severity: 'warning',
        code: 'session.mobility.missing_details',
        message: `Sesión de mobility sin mobilityDetails (${session.date}).`,
        weekIndex: week.weekIndex,
      })
    }
  }
  return issues
}

function computeWeekLoad(sessions: CoachSessionProposal[]): number {
  return sessions.reduce((sum, s) => sum + (s.durationMin * (s.rpe ?? 6)), 0)
}

function validateLoadProgression(weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const generated = weeks.filter((w) => w.sessions.length > 0).sort((a, b) => a.weekIndex - b.weekIndex)
  for (let i = 1; i < generated.length; i++) {
    const prev = computeWeekLoad(generated[i - 1].sessions)
    const curr = computeWeekLoad(generated[i].sessions)
    if (prev === 0) continue
    const jump = (curr - prev) / prev
    if (jump > 0.4 && generated[i].phase !== 'race') {
      issues.push({
        severity: 'warning',
        code: 'plan.load.jump',
        message: `Salto de carga ${Math.round(jump * 100)}% entre semanas ${generated[i - 1].weekIndex + 1} y ${generated[i].weekIndex + 1}.`,
        weekIndex: generated[i].weekIndex,
      })
    }
  }
  return issues
}

function validateSportDistribution(plan: TrainingPlan, weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const allowed = new Set<SupportedSport>(
    plan.macroSnapshot.sportDetails.map((d) => d.sport),
  )
  for (const week of weeks) {
    for (const session of week.sessions) {
      if (!allowed.has(session.sessionType as SupportedSport)) {
        issues.push({
          severity: 'error',
          code: 'session.sport.not_allowed',
          message: `Sesión con deporte no permitido: ${session.sessionType} (${session.date}).`,
          weekIndex: week.weekIndex,
        })
      }
    }
  }
  return issues
}

export function validatePlan(input: ValidatePlanInput): PlanValidationIssue[] {
  const { plan, weeks } = input
  return [
    ...validateStructure(plan, weeks),
    ...weeks.flatMap(validateWeekSessions),
    ...validateLoadProgression(weeks),
    ...validateSportDistribution(plan, weeks),
  ]
}
