import type { CoachSessionProposal, DayOfWeek, SupportedSport } from '../../types'
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

function isStrictISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

function isoDateToDayOfWeek(date: string): DayOfWeek | null {
  if (!isStrictISODate(date)) return null
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const mapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[weekday] ?? null
}

function validateWeekConstraints(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  if (week.status !== 'draft' && week.status !== 'accepted') return issues
  if (!Array.isArray(week.sessions) || week.sessions.length === 0) return issues

  const expectedDays = new Set(plan.wizardConfig.trainingDays)
  const sessionCountByDate = new Map<string, number>()
  const weekStart = new Date(`${week.weekStartDate}T00:00:00.000Z`).getTime()
  const weekEndExclusive = weekStart + 7 * 24 * 60 * 60 * 1000

  if (week.sessions.length !== plan.wizardConfig.sessionsPerWeek) {
    const diff = Math.abs(week.sessions.length - plan.wizardConfig.sessionsPerWeek)
    issues.push({
      severity: diff <= 1 ? 'warning' : 'error',
      code: 'week.sessions.count_mismatch',
      message: `La semana ${week.weekIndex + 1} tiene ${week.sessions.length} sesiones, pero el wizard esperaba ${plan.wizardConfig.sessionsPerWeek}.`,
      weekIndex: week.weekIndex,
    })
  }

  for (const session of week.sessions) {
    if (!isStrictISODate(session.date)) {
      issues.push({
        severity: 'error',
        code: 'week.sessions.invalid_date',
        message: `La sesión ${session.title} tiene una fecha inválida (${session.date}).`,
        weekIndex: week.weekIndex,
      })
      continue
    }

    const sessionTs = new Date(`${session.date}T00:00:00.000Z`).getTime()
    if (sessionTs < weekStart || sessionTs >= weekEndExclusive) {
      issues.push({
        severity: 'error',
        code: 'week.sessions.out_of_week',
        message: `La sesión ${session.title} (${session.date}) cae fuera de la semana ${week.weekIndex + 1}.`,
        weekIndex: week.weekIndex,
      })
    }

    const dayOfWeek = isoDateToDayOfWeek(session.date)
    if (dayOfWeek && !expectedDays.has(dayOfWeek)) {
      issues.push({
        severity: 'warning',
        code: 'week.sessions.out_of_allowed_day',
        message: `La sesión ${session.title} (${session.date}) usa un día no permitido por el wizard.`,
        weekIndex: week.weekIndex,
      })
    }

    sessionCountByDate.set(session.date, (sessionCountByDate.get(session.date) ?? 0) + 1)
  }

  if (!plan.wizardConfig.allowDoubleSession) {
    for (const [date, count] of sessionCountByDate.entries()) {
      if (count <= 1) continue
      issues.push({
        severity: 'error',
        code: 'week.sessions.double_session_not_allowed',
        message: `La semana ${week.weekIndex + 1} tiene ${count} sesiones el ${date}, pero el wizard no permite doble sesión.`,
        weekIndex: week.weekIndex,
      })
    }
  }

  return issues
}

function validateSportDistributionForWeek(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const allowed = new Set<string>(
    [
      ...plan.macroSnapshot.sportDetails.map((d) => d.sport),
      ...(plan.wizardConfig.complementarySports as SupportedSport[]),
      'mobility',
      'recovery',
      'nutrition',
    ],
  )

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

  return issues
}

function computeWeekLoad(sessions: CoachSessionProposal[]): number {
  return sessions.reduce((sum, s) => sum + (s.durationMin * (s.rpe ?? 6)), 0)
}

function countSessionsBySport(sessions: CoachSessionProposal[]): Partial<Record<SupportedSport, number>> {
  return sessions.reduce<Partial<Record<SupportedSport, number>>>((counts, session) => {
    const sport = session.sessionType as SupportedSport
    counts[sport] = (counts[sport] ?? 0) + 1
    return counts
  }, {})
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


function minimumPrimarySessions(primarySport: SupportedSport, phase: TrainingPlanWeek['phase']): number {
  if (phase === 'transition') return 0
  if (phase === 'build' || phase === 'peak') return primarySport === 'squash' ? 2 : 1
  if (phase === 'taper' || phase === 'race' || phase === 'base') return 1
  return 1
}

function validatePrimarySportCoherence(plan: TrainingPlan, weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const primarySport = plan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
  if (!primarySport) return issues

  for (const week of weeks) {
    if (week.status !== 'draft' && week.status !== 'accepted') continue
    if (!Array.isArray(week.sessions) || week.sessions.length === 0) continue

    const counts = countSessionsBySport(week.sessions)
    const primaryCount = counts[primarySport] ?? 0
    const supportCount = Object.entries(counts).reduce((total, [sport, count]) => {
      if (sport === primarySport) return total
      return total + (count ?? 0)
    }, 0)
    const minimum = minimumPrimarySessions(primarySport, week.phase)

    if (primaryCount === 0 && minimum > 0) {
      issues.push({
        severity: 'error',
        code: 'week.primary_sport.missing',
        message: `La semana ${week.weekIndex + 1} no incluye sesiones de ${primarySport}, aunque es el deporte principal del objetivo.`,
        weekIndex: week.weekIndex,
      })
      continue
    }

    if (primaryCount < minimum) {
      const sessionLabel = minimum > 1 ? 'sesiones' : 'sesión'
      issues.push({
        severity: 'error',
        code: 'week.primary_sport.too_low',
        message: `La semana ${week.weekIndex + 1} necesita al menos ${minimum} ${sessionLabel} de ${primarySport} para la fase ${week.phase}.`,
        weekIndex: week.weekIndex,
      })
    }

    if ((week.phase === 'build' || week.phase === 'peak') && primaryCount > 0 && primaryCount <= supportCount) {
      issues.push({
        severity: 'warning',
        code: 'week.primary_sport.underweighted',
        message: `La semana ${week.weekIndex + 1} deja demasiado protagonismo al trabajo accesorio frente a ${primarySport}.`,
        weekIndex: week.weekIndex,
      })
    }
  }

  return issues
}

export function validatePlanWeek(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  return [
    ...validateWeekSessions(week),
    ...validateWeekConstraints(plan, week),
    ...validateSportDistributionForWeek(plan, week),
    ...validatePrimarySportCoherence(plan, [week]),
  ]
}

export function validatePlan(input: ValidatePlanInput): PlanValidationIssue[] {
  const { plan, weeks } = input
  return [
    ...validateStructure(plan, weeks),
    ...weeks.flatMap((week) => validatePlanWeek(plan, week)),
    ...validateLoadProgression(weeks),
  ]
}
