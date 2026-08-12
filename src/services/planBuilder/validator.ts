import type { CoachSessionProposal, DayOfWeek, SupportedSport } from '../../types'
import type { PlanValidationIssue, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from './dateRange'
import {
  EVENT_WINDOW_SUPPORT_CAPS,
  MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK,
  isPlanEventAnchorDate,
  isDeclaredSquashMatchSession,
  isWithinPlanEventWindow,
  planEventAppliesToSquash,
  planWeekContainsEventAnchor,
  resolveEventWindowSupportKind,
  resolvePlanEventWindow,
} from './eventWindowRules'

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
    const isSquashEventAnchor = week.phase === 'race'
      && getPrimarySport(plan) === 'squash'
      && isPlanEventAnchorDate(plan, session.date)
    if (dayOfWeek && !expectedDays.has(dayOfWeek) && !isSquashEventAnchor) {
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
  } else if (plan.wizardConfig.doubleSessionDays && plan.wizardConfig.doubleSessionDays.length > 0) {
    const doubleDays = new Set(plan.wizardConfig.doubleSessionDays)
    for (const [date, count] of sessionCountByDate.entries()) {
      if (count <= 1) continue
      const dayOfWeek = isoDateToDayOfWeek(date)
      if (dayOfWeek && doubleDays.has(dayOfWeek)) continue
      issues.push({
        severity: 'error',
        code: 'week.sessions.double_session_day_not_allowed',
        message: `La semana ${week.weekIndex + 1} tiene ${count} sesiones el ${date}, pero ese día no está habilitado para doble sesión.`,
        weekIndex: week.weekIndex,
      })
    }
  }

  return issues
}

function validateSportDistributionForWeek(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  // Hueco preexistente, no introducido por la ventana: sin esto una fila con
  // `sessions` ausente hacía lanzar a `validatePlanWeek` entero.
  if (!Array.isArray(week.sessions)) return issues
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

export function validateLoadProgression(weeks: TrainingPlanWeek[], plan?: TrainingPlan): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const generated = weeks.filter((w) => w.sessions.length > 0).sort((a, b) => a.weekIndex - b.weekIndex)
  for (let i = 1; i < generated.length; i++) {
    const prevWeek = generated[i - 1]
    const currWeek = generated[i]
    const prevExpected = plan ? getExpectedSessionsForPlanWeek(plan, prevWeek) : prevWeek.sessions.length
    const currExpected = plan ? getExpectedSessionsForPlanWeek(plan, currWeek) : currWeek.sessions.length
    if (prevExpected === 0 || currExpected === 0) continue
    // Normalize by expected session capacity, not the actual count. This keeps a
    // genuinely short first/last week comparable while still flagging incomplete
    // generated weeks followed by a full-volume week.
    const prev = computeWeekLoad(prevWeek.sessions) / prevExpected
    const curr = computeWeekLoad(currWeek.sessions) / currExpected
    if (prev === 0) continue
    const jump = (curr - prev) / prev
    if (jump > 0.4 && currWeek.phase !== 'race') {
      issues.push({
        severity: 'warning',
        code: 'plan.load.jump',
        message: `Salto de carga ${Math.round(jump * 100)}% entre semanas ${prevWeek.weekIndex + 1} y ${currWeek.weekIndex + 1}.`,
        weekIndex: currWeek.weekIndex,
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
  if (!Array.isArray(week.sessions)) return issues
  if (getPrimarySport(plan) !== 'squash') return issues
  // Mismo gate que `normalizeSquashEventWindow`: sin esto el validator exigía
  // un ancla de squash que el repair, correctamente, nunca iba a construir.
  if (!planEventAppliesToSquash(plan)) return issues

  const { anchorDate } = resolvePlanEventWindow(plan)
  const anchorInsideWeek = planWeekContainsEventAnchor(plan, week)

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

    if (week.phase !== 'race') continue
    // Fuera de los días del evento no hay "apoyo de campeonato" que exigir.
    if (!isWithinPlanEventWindow(plan, session.date)) continue

    const isAnchor = session.date === anchorDate && isDeclaredSquashMatchSession(session)
    if (session.date === anchorDate && !isAnchor) {
      issues.push({
        severity: 'error',
        code: 'squash.event_window.anchor_extra_session',
        message: `El día clave ${anchorDate} debe quedar reservado para la única ancla competitiva; retira ${session.title}.`,
        weekIndex: week.weekIndex,
      })
    }
    if (isAnchor) continue

    if (isDeclaredSquashMatchSession(session)) {
      issues.push({
        severity: 'error',
        code: 'squash.event_window.extra_match',
        message: `La ventana ya está representada por el ancla ${anchorDate}; ${session.title} (${session.date}) agrega match-play de entrenamiento no permitido.`,
        weekIndex: week.weekIndex,
      })
      continue
    }

    const supportKind = resolveEventWindowSupportKind(session)
    if (!supportKind) {
      issues.push({
        severity: 'error',
        code: 'squash.event_window.incompatible_support',
        message: `Durante el campeonato ${session.title} (${session.date}) debe ser activación, toque técnico corto o recuperación; ${session.sessionType} no es un apoyo compatible.`,
        weekIndex: week.weekIndex,
      })
      continue
    }

    const caps = EVENT_WINDOW_SUPPORT_CAPS[supportKind]
    const rpe = session.rpe ?? caps.maxRpe
    if (supportKind === 'technical_touch' && plan.wizardConfig.partnerAvailability === 'solo') {
      issues.push({
        severity: 'error',
        code: 'squash.event_window.technical_partner_required',
        message: `${session.title} (${session.date}) requiere partner, pero el wizard declara disponibilidad solo.`,
        weekIndex: week.weekIndex,
      })
    }
    if (
      session.durationMin < caps.minDurationMin
      || session.durationMin > caps.maxDurationMin
      || rpe < caps.minRpe
      || rpe > caps.maxRpe
    ) {
      issues.push({
        severity: 'error',
        code: 'squash.event_window.support_out_of_bounds',
        message: `${session.title} (${session.date}) excede el rango de ${supportKind}: ${caps.minDurationMin}-${caps.maxDurationMin}min, RPE ${caps.minRpe}-${caps.maxRpe}.`,
        weekIndex: week.weekIndex,
      })
    }
  }

  if (week.phase === 'race') {
    const anchors = week.sessions.filter((session) =>
      session.date === anchorDate && isDeclaredSquashMatchSession(session))
    if (anchorInsideWeek && anchors.length !== 1) {
      issues.push({
        severity: 'error',
        code: 'squash.event_window.anchor_count',
        message: `La semana que contiene ${anchorDate} debe tener exactamente una ancla squash match/competitive; tiene ${anchors.length}.`,
        weekIndex: week.weekIndex,
      })
    }

    const supportCount = week.sessions.filter((session) =>
      isWithinPlanEventWindow(plan, session.date)
      && !(session.date === anchorDate && isDeclaredSquashMatchSession(session))).length
    if (supportCount > MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK) {
      issues.push({
        severity: 'error',
        code: 'squash.event_window.too_many_supports',
        message: `La semana ${week.weekIndex + 1} tiene ${supportCount} apoyos durante el campeonato; el máximo es ${MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK}.`,
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
    ...validateLoadProgression(weeks, plan),
  ]
}
