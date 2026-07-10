import type {
  DayLog,
  MacroWeekCoherenceSummary,
  ReadinessDaily,
  Session,
  WeekSummary,
  WeeklyActionAdherenceStatus,
  WeeklyActionCheckInStatus,
  WeeklyActionItem,
  WeeklyActionSummary,
  WeeklyActionWeekState,
} from '../types'
import type { LoadAnalytics } from './loadAnalytics'
import { buildActionAlerts } from './actionAlerts'
import { todayISO, toISO, fromISO, getWeekStart } from '../utils/date'
import { isWeeklyReviewWindowOpen } from './weeklyReviewWindow'
import { hasFreshWeeklyCoachNote } from './weeklyCoachNote'

export interface WeeklyActionLoopInput {
  sessions: Session[]
  currentWeekSummary?: WeekSummary | null
  todayDayLog?: DayLog
  readiness?: ReadinessDaily
  macroWeekCoherence?: MacroWeekCoherenceSummary | null
  loadAnalytics?: LoadAnalytics | null
  today?: string
}

const PRIORITY = {
  planWeek: 0,
  fixCoherence: 10,
  closeCheckIn: 20,
  recoverAdherence: 30,
  reviewLoadRisk: 40,
  reviewCoachNote: 50,
} as const

function getWeekSessionCount(
  summary: WeekSummary | null | undefined,
  sessions: Session[],
): number {
  if (summary?.plannedSessions != null) return summary.plannedSessions
  if (summary?.totalSessions != null) return summary.totalSessions
  return sessions.filter((session) => session.status !== 'skipped').length
}

export function buildWeeklyActionSummary(input: WeeklyActionLoopInput): WeeklyActionSummary {
  const today = input.today ?? todayISO()
  const weekSessions = getWeekSessionCount(input.currentWeekSummary, input.sessions)
  const actions: WeeklyActionItem[] = []

  if (shouldPlanWeek(input.currentWeekSummary, input.sessions, today)) {
    actions.push({
      id: 'weekly-plan-week',
      kind: 'plan_week',
      priority: PRIORITY.planWeek,
      title: 'Tu semana sigue sin estructura',
      body: 'Aun no tienes una semana definida y eso corta continuidad, carga y feedback util.',
      reason: 'La semana esta vacia entre lunes y miercoles.',
      ctaLabel: 'Crear semana',
      ctaTarget: 'plan_builder',
      status: 'pending',
    })
  }

  const actionAlerts = buildActionAlerts(input)
  for (const alert of actionAlerts) {
    const mapped = mapAlertToWeeklyAction(alert)
    if (mapped) actions.push(mapped)
  }

  // El coach note es solo de la semana en curso: no sugerir generarlo para una
  // semana pasada/futura (generateCoachNote lo rechaza y mostraría un error).
  const currentWeekStart = toISO(getWeekStart(fromISO(today)))
  const summaryIsCurrentWeek = input.currentWeekSummary?.weekStartDate === currentWeekStart
  if (summaryIsCurrentWeek && shouldReviewCoachNote(input.currentWeekSummary, weekSessions, today)) {
    actions.push({
      id: 'weekly-review-coach-note',
      kind: 'review_coach_note',
      priority: PRIORITY.reviewCoachNote,
      title: 'Te falta la lectura semanal del coach',
      body: 'Ya hay semana creada, pero todavia no tienes una nota que resuma foco, riesgo y prioridad.',
      reason: 'La semana tiene sesiones pero no tiene coach note.',
      ctaLabel: 'Generar coach note',
      ctaTarget: 'generate_coach_note',
      status: 'pending',
    })
  }

  const deduped = dedupeAndSort(actions).slice(0, 3)
  const primaryAction = deduped[0] ?? null
  const secondaryActions = deduped.slice(1, 3)
  const adherenceStatus = buildAdherenceStatus(input.currentWeekSummary, input.sessions, today)
  const checkInStatus = buildCheckInStatus(input.sessions, today, input.todayDayLog)
  const coherenceStatus = input.macroWeekCoherence?.coherenceStatus ?? 'ok'
  const weekState = buildWeekState({
    weekSessions,
    primaryAction,
    secondaryActions,
  })

  return {
    primaryAction,
    secondaryActions,
    adherenceStatus,
    checkInStatus,
    coherenceStatus,
    weekState,
  }
}

function shouldPlanWeek(
  summary: WeekSummary | null | undefined,
  sessions: Session[],
  today: string,
): boolean {
  const weekday = new Date(`${today}T12:00:00`).getDay()
  const mondayToWednesday = weekday >= 1 && weekday <= 3
  const weekSessions = getWeekSessionCount(summary, sessions)
  return mondayToWednesday && weekSessions === 0
}

function shouldReviewCoachNote(
  summary: WeekSummary | null | undefined,
  weekSessions: number,
  today: string,
): boolean {
  if (!summary) return false
  if (weekSessions === 0) return false
  if (!isWeeklyReviewWindowOpen(today)) return false
  return !hasFreshWeeklyCoachNote(summary)
}

function mapAlertToWeeklyAction(
  alert: ReturnType<typeof buildActionAlerts>[number],
): WeeklyActionItem | null {
  switch (alert.id) {
    case 'macro-week-coherence-warning':
      return {
        id: 'weekly-fix-coherence',
        kind: 'fix_coherence',
        priority: PRIORITY.fixCoherence,
        title: alert.title,
        body: alert.body,
        reason: alert.recommendation,
        ctaLabel: 'Hablar con el coach',
        ctaTarget: 'chat_adjust_week',
        status: 'recommended',
      }
    case 'recovery-checkin-strain':
    case 'recovery-checkin-missing':
      return {
        id: `weekly-${alert.id}`,
        kind: 'close_checkin',
        priority: PRIORITY.closeCheckIn,
        title: alert.title,
        body: alert.body,
        reason: alert.recommendation,
        ctaLabel: 'Abrir check-in',
        ctaTarget: 'today_checkin',
        status: 'pending',
      }
    case 'weekly-adherence-drop':
      return {
        id: 'weekly-recover-adherence',
        kind: 'recover_adherence',
        priority: PRIORITY.recoverAdherence,
        title: alert.title,
        body: alert.body,
        reason: alert.recommendation,
        ctaLabel: 'Hablar con el coach',
        ctaTarget: 'chat_adjust_week',
        status: 'recommended',
      }
    default:
      if (alert.id.startsWith('readiness-recovery-low-')) {
        return {
          id: `weekly-${alert.id}`,
          kind: 'close_checkin',
          priority: PRIORITY.closeCheckIn,
          title: alert.title,
          body: alert.body,
          reason: alert.recommendation,
          ctaLabel: 'Abrir check-in',
          ctaTarget: 'today_checkin',
          status: 'recommended',
        }
      }
      if (!alert.id.startsWith('acwr-')) return null
      return {
        id: `weekly-${alert.id}`,
        kind: 'review_load_risk',
        priority: PRIORITY.reviewLoadRisk,
        title: alert.title,
        body: alert.body,
        reason: alert.recommendation,
        ctaLabel: alert.target === 'week' ? 'Ver dia de hoy' : 'Pedir ajuste',
        ctaTarget: alert.target === 'week' ? 'today_detail' : 'chat_adjust_week',
        status: 'recommended',
      }
  }
}

function dedupeAndSort(actions: WeeklyActionItem[]): WeeklyActionItem[] {
  const byKind = new Map<string, WeeklyActionItem>()
  for (const action of actions) {
    const existing = byKind.get(action.kind)
    if (!existing || action.priority < existing.priority) {
      byKind.set(action.kind, action)
    }
  }

  return [...byKind.values()].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))
}

function buildAdherenceStatus(
  summary: WeekSummary | null | undefined,
  sessions: Session[],
  today: string,
): WeeklyActionAdherenceStatus {
  if (!summary) return 'unknown'
  if (summary.plannedSessions === 0) return 'no_plan'
  const hasPastUncompleted = sessions.some((session) =>
    session.status !== 'skipped' && session.status !== 'completed' && session.date < today,
  )
  const hasFutureOrTodayPending = sessions.some((session) =>
    session.status !== 'skipped' && session.status !== 'completed' && session.date >= today,
  )
  if (!hasPastUncompleted && hasFutureOrTodayPending) return 'on_track'

  const adherence = summary.adherencePct ?? Math.round((summary.completedSessions / summary.plannedSessions) * 100)
  if (adherence >= 80) return 'on_track'
  if (adherence >= 60) return 'low'
  return 'at_risk'
}

function buildCheckInStatus(
  sessions: Session[],
  today: string,
  todayDayLog?: DayLog,
): WeeklyActionCheckInStatus {
  const todaySessions = sessions.filter((session) => session.date === today && session.status !== 'skipped')
  if (todaySessions.length === 0) return 'not_needed'

  const completedSessions = todaySessions.filter((session) => session.status === 'completed')
  const hasPendingFeedback = completedSessions.some((session) => !session.sessionFeedback)
  const missingCheckIn =
    todayDayLog == null ||
    todayDayLog.energyLevel == null ||
    todayDayLog.sleepQuality == null ||
    todayDayLog.rpeActual == null

  if (completedSessions.length === 0 && missingCheckIn) return 'pending'
  return hasPendingFeedback || missingCheckIn ? 'pending' : 'complete'
}

function buildWeekState({
  weekSessions,
  primaryAction,
  secondaryActions,
}: {
  weekSessions: number
  primaryAction: WeeklyActionItem | null
  secondaryActions: WeeklyActionItem[]
}): WeeklyActionWeekState {
  if (weekSessions === 0) return 'empty'
  if (!primaryAction) return 'on_track'
  if (primaryAction.kind === 'review_coach_note' && secondaryActions.length === 0) return 'planned'
  return 'needs_attention'
}
