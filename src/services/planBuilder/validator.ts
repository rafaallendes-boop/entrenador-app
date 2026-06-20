import type { CoachSessionProposal, DayOfWeek, SupportedSport } from '../../types'
import type { PlanValidationIssue, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from './dateRange'

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

function validateWeekSessions(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  if (week.status !== 'draft' && week.status !== 'accepted') return issues

  const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)

  if (!Array.isArray(week.sessions) || week.sessions.length === 0) {
    if (expectedSessions === 0) return issues
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
  const validRange = getPlanWeekDateRange(plan, week)
  const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)

  if (week.sessions.length !== expectedSessions) {
    const diff = Math.abs(week.sessions.length - expectedSessions)
    issues.push({
      severity: diff <= 1 ? 'warning' : 'error',
      code: 'week.sessions.count_mismatch',
      message: `La semana ${week.weekIndex + 1} tiene ${week.sessions.length} sesiones, pero el rango válido permite ${expectedSessions}.`,
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

    if (session.date < validRange.startDate || session.date > validRange.endDate) {
      issues.push({
        severity: 'error',
        code: 'week.sessions.out_of_week',
        message: `La sesión ${session.title} (${session.date}) cae fuera del rango válido ${validRange.startDate} a ${validRange.endDate} para la semana ${week.weekIndex + 1}.`,
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

export function validateLoadProgression(weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const generated = weeks.filter((w) => w.sessions.length > 0).sort((a, b) => a.weekIndex - b.weekIndex)
  for (let i = 1; i < generated.length; i++) {
    const prevSessions = generated[i - 1].sessions.length
    const currSessions = generated[i].sessions.length
    if (prevSessions === 0 || currSessions === 0) continue
    // Compare average load per session, not the weekly total: a partial first/last
    // week (e.g. a plan that starts mid-week) has fewer sessions but the same
    // intensity, which would otherwise read as a spurious jump.
    const prev = computeWeekLoad(generated[i - 1].sessions) / prevSessions
    const curr = computeWeekLoad(generated[i].sessions) / currSessions
    if (prev === 0) continue
    const jump = (curr - prev) / prev
    if (jump > 0.4 && generated[i].phase !== 'race') {
      issues.push({
        severity: 'warning',
        code: 'plan.load.jump',
        message: `Salto de intensidad ${Math.round(jump * 100)}% entre semanas ${generated[i - 1].weekIndex + 1} y ${generated[i].weekIndex + 1}.`,
        weekIndex: generated[i].weekIndex,
      })
    }
  }
  return issues
}


function minimumPrimarySessions(primarySport: SupportedSport, week: TrainingPlanWeek, expectedSessions: number): number {
  if (week.phase === 'transition') return 0
  if (expectedSessions <= 0) return 0
  if (week.phase === 'build' || week.phase === 'peak') {
    if (primarySport === 'squash') {
      const loadedSupportSports = (['running', 'strength', 'cycling', 'mobility'] as SupportedSport[])
        .filter((sport) => (week.targetLoadBySport[sport] ?? 0) > 0)
        .length
      if (loadedSupportSports >= 2 && expectedSessions >= 4) {
        return Math.max(2, Math.floor(expectedSessions / 2))
      }
      return expectedSessions >= 4
        ? Math.min(expectedSessions, Math.floor(expectedSessions / 2) + 1)
        : Math.min(expectedSessions, 2)
    }
    return 1
  }
  if (week.phase === 'taper' || week.phase === 'race' || week.phase === 'base') return Math.min(expectedSessions, 1)
  return Math.min(expectedSessions, 1)
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
    const minimum = minimumPrimarySessions(primarySport, week, getExpectedSessionsForPlanWeek(plan, week))

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

function getPrimarySport(plan: TrainingPlan): SupportedSport | undefined {
  return plan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
}

function validateSquashCompetitionReadiness(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  if (week.status !== 'draft' && week.status !== 'accepted') return issues
  if (!Array.isArray(week.sessions) || week.sessions.length === 0) return issues
  if (getPrimarySport(plan) !== 'squash') return issues

  const validRange = getPlanWeekDateRange(plan, week)
  const eventDate = plan.macroSnapshot.goalEventDate
  const eventInsideWeek = eventDate >= validRange.startDate && eventDate <= validRange.endDate

  for (const session of week.sessions) {
    if (session.sessionType === 'running' || session.sessionType === 'cycling') {
      if (week.phase === 'build' || week.phase === 'peak') {
        const isHardRunning = session.sessionType === 'running' && (session.runningType === 'tempo' || session.runningType === 'intervals' || session.runningType === 'long')
        if (isHardRunning || (session.rpe ?? 6) > 5 || session.durationMin > 45) {
          issues.push({
            severity: 'error',
            code: 'squash.support_aerobic.too_hard',
            message: `Para squash en ${week.phase}, ${session.title} (${session.date}) debe ser soporte aeróbico suave: Z2 corta, RPE <=5 y <=45min; no tempo/intervalos/long.`,
            weekIndex: week.weekIndex,
          })
        }
      }

      if (week.phase === 'taper' || week.phase === 'race') {
        const isTooMuchSupport = session.sessionType === 'cycling'
          || session.runningType === 'tempo'
          || session.runningType === 'intervals'
          || session.runningType === 'long'
          || (session.rpe ?? 4) > 3
          || session.durationMin > 25
        if (isTooMuchSupport) {
          issues.push({
            severity: 'error',
            code: 'squash.taper.support_aerobic.too_much',
            message: `En taper/race de squash, ${session.title} (${session.date}) no debe sumar fatiga: evita cycling y limita running a Z2/recovery <=25min RPE <=3.`,
            weekIndex: week.weekIndex,
          })
        }
      }

    }

    if (
      week.phase === 'race'
      && session.date === eventDate
      && session.sessionType !== 'squash'
      && session.sessionType !== 'mobility'
      && session.sessionType !== 'recovery'
    ) {
      issues.push({
        // Warning (not error): race week is intentionally calm/minimal; we don't force-schedule
        // around the exact event day since its timing within the week may be unknown.
        severity: 'warning',
        code: 'squash.race_day.non_squash',
        message: `El día del torneo (${eventDate}) no debe incluir ${session.sessionType}; reserva esa fecha para competencia/activación específica de squash.`,
        weekIndex: week.weekIndex,
      })
    }
  }

  if (week.phase === 'race' && eventInsideWeek) {
    const hasEventSquash = week.sessions.some((session) =>
      session.date === eventDate
      && session.sessionType === 'squash'
      && (session.subtype === 'match' || session.subtype === 'competitive' || session.squashDetails?.sessionKind === 'match'),
    )
    if (!hasEventSquash) {
      issues.push({
        // Warning (not error): race week is kept calm without forcing a 'match' session on a
        // specific day; the competition itself provides the competitive event.
        severity: 'warning',
        code: 'squash.race_day.missing_event',
        message: `La semana de carrera debe marcar el torneo de squash el ${eventDate} como sesión match/competitiva.`,
        weekIndex: week.weekIndex,
      })
    }
  }

  return issues
}

export function validatePlanWeek(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  return [
    ...validateWeekSessions(plan, week),
    ...validateWeekConstraints(plan, week),
    ...validateSportDistributionForWeek(plan, week),
    ...validatePrimarySportCoherence(plan, [week]),
    ...validateSquashCompetitionReadiness(plan, week),
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
