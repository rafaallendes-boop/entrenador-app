import { addDays } from 'date-fns'
import { db } from '../../db/db'
import type { DayLog, Session, SessionType, WeekSummary } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import { fromISO, getWeekStart, toISO } from '../../utils/date'

export interface PlanBuilderRecentWeekContext {
  weekStartDate: string
  plannedSessions: number
  completedSessions: number
  adherencePct?: number
  plannedMinutes: number
  completedMinutes: number
  avgActualRpe?: number
  avgSleep?: number
  avgEnergy?: number
  sports: Partial<Record<SessionType, number>>
  painNotes: string[]
  sessionHighlights: string[]
}

export interface PlanBuilderRecentContext {
  referenceDate: string
  lookbackWeeks: number
  hasHistory: boolean
  weeks: PlanBuilderRecentWeekContext[]
  summary: {
    avgAdherencePct?: number
    avgCompletedMinutes?: number
    avgActualRpe?: number
    avgSleep?: number
    avgEnergy?: number
    dominantSports: Array<{ sport: SessionType; sessions: number }>
    recentPainNotes: string[]
    recommendation: 'normal' | 'conservative' | 'progressive'
  }
}

const DEFAULT_LOOKBACK_WEEKS = 6

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

function getActualMinutes(session: Session): number {
  if (session.status !== 'completed' && session.status !== 'adjusted') return 0
  return session.actualDurationMin ?? session.durationMin
}

function summarizeSports(sessions: Session[]): Partial<Record<SessionType, number>> {
  return sessions.reduce<Partial<Record<SessionType, number>>>((acc, session) => {
    if (session.status === 'skipped') return acc
    acc[session.type] = (acc[session.type] ?? 0) + 1
    return acc
  }, {})
}

function summarizeHighlights(sessions: Session[]): string[] {
  return sessions
    .filter((session) => session.status === 'completed' || session.status === 'adjusted')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4)
    .map((session) => `${session.date} ${session.type}: ${session.title}${session.actualRpe ? ` RPE ${session.actualRpe}` : ''}`)
}

function buildWeekContext(
  weekStartDate: string,
  sessions: Session[],
  dayLogs: DayLog[],
  summary: WeekSummary | undefined,
): PlanBuilderRecentWeekContext {
  const activeSessions = sessions.filter((session) => session.status !== 'skipped')
  const completedSessions = sessions.filter((session) => session.status === 'completed' || session.status === 'adjusted')
  const plannedSessions = summary?.plannedSessions ?? activeSessions.length
  const completedCount = summary?.completedSessions ?? completedSessions.length
  const plannedMinutes = summary?.plannedMinutes ?? activeSessions.reduce((sum, session) => sum + session.durationMin, 0)
  const completedMinutes = summary?.completedMinutes ?? completedSessions.reduce((sum, session) => sum + getActualMinutes(session), 0)
  const adherencePct = summary?.adherencePct ?? (plannedSessions > 0 ? Math.round((completedCount / plannedSessions) * 100) : undefined)
  const actualRpeValues = [
    ...completedSessions.map((session) => session.actualRpe).filter((value): value is number => value != null),
    ...dayLogs.map((log) => log.rpeActual).filter((value): value is number => value != null),
  ]
  const sleepValues = dayLogs.map((log) => log.sleepHours).filter((value): value is number => value != null)
  const energyValues = dayLogs.map((log) => log.energyLevel).filter((value): value is number => value != null)
  const painNotes = dayLogs
    .filter((log) => (log.painLevel ?? 0) > 0 || Boolean(log.painNotes))
    .map((log) => `${log.date}: ${log.painNotes ?? `dolor ${log.painLevel}/10`}`)
    .slice(-3)

  return {
    weekStartDate,
    plannedSessions,
    completedSessions: completedCount,
    adherencePct,
    plannedMinutes,
    completedMinutes,
    avgActualRpe: summary?.avgActualRpe ?? average(actualRpeValues),
    avgSleep: summary?.avgSleep ?? average(sleepValues),
    avgEnergy: summary?.avgEnergy ?? average(energyValues),
    sports: summarizeSports(sessions),
    painNotes,
    sessionHighlights: summarizeHighlights(sessions),
  }
}

function recommendationFromWeeks(weeks: PlanBuilderRecentWeekContext[]): PlanBuilderRecentContext['summary']['recommendation'] {
  if (weeks.length === 0) return 'normal'
  const avgAdherence = average(weeks.map((week) => week.adherencePct).filter((value): value is number => value != null))
  const avgSleep = average(weeks.map((week) => week.avgSleep).filter((value): value is number => value != null))
  const avgEnergy = average(weeks.map((week) => week.avgEnergy).filter((value): value is number => value != null))
  const avgRpe = average(weeks.map((week) => week.avgActualRpe).filter((value): value is number => value != null))
  const hasPain = weeks.some((week) => week.painNotes.length > 0)

  if ((avgAdherence != null && avgAdherence < 70) || (avgSleep != null && avgSleep < 6.5) || (avgEnergy != null && avgEnergy < 5.5) || (avgRpe != null && avgRpe >= 8) || hasPain) {
    return 'conservative'
  }
  if ((avgAdherence == null || avgAdherence >= 85) && (avgEnergy == null || avgEnergy >= 7) && (avgRpe == null || avgRpe <= 7)) {
    return 'progressive'
  }
  return 'normal'
}

function buildSummary(weeks: PlanBuilderRecentWeekContext[]): PlanBuilderRecentContext['summary'] {
  const sportTotals = new Map<SessionType, number>()
  for (const week of weeks) {
    for (const [sport, count] of Object.entries(week.sports) as Array<[SessionType, number]>) {
      sportTotals.set(sport, (sportTotals.get(sport) ?? 0) + count)
    }
  }

  return {
    avgAdherencePct: average(weeks.map((week) => week.adherencePct).filter((value): value is number => value != null)),
    avgCompletedMinutes: average(weeks.map((week) => week.completedMinutes)),
    avgActualRpe: average(weeks.map((week) => week.avgActualRpe).filter((value): value is number => value != null)),
    avgSleep: average(weeks.map((week) => week.avgSleep).filter((value): value is number => value != null)),
    avgEnergy: average(weeks.map((week) => week.avgEnergy).filter((value): value is number => value != null)),
    dominantSports: [...sportTotals.entries()]
      .map(([sport, sessions]) => ({ sport, sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 4),
    recentPainNotes: weeks.flatMap((week) => week.painNotes).slice(-5),
    recommendation: recommendationFromWeeks(weeks),
  }
}

export async function buildPlanBuilderRecentContext(
  plan: TrainingPlan,
  lookbackWeeks = DEFAULT_LOOKBACK_WEEKS,
): Promise<PlanBuilderRecentContext> {
  const referenceDate = plan.startDate
  const referenceWeekStart = getWeekStart(fromISO(referenceDate))
  const firstWeekStart = toISO(addDays(referenceWeekStart, -(lookbackWeeks * 7)))
  const lastHistoryDate = toISO(addDays(referenceWeekStart, -1))
  const sessions = await db.sessions
    .where('date')
    .between(firstWeekStart, lastHistoryDate, true, true)
    .toArray()
  const dayLogs = await db.dayLogs
    .where('date')
    .between(firstWeekStart, lastHistoryDate, true, true)
    .toArray()
  const summaries = await db.weekSummaries
    .where('weekStartDate')
    .between(firstWeekStart, lastHistoryDate, true, true)
    .toArray()
  const summariesByWeek = new Map(summaries.map((summary) => [summary.weekStartDate, summary]))
  const sessionsByWeek = new Map<string, Session[]>()
  const logsByWeek = new Map<string, DayLog[]>()

  for (const session of sessions) {
    const weekStart = session.weekStartDate ?? toISO(getWeekStart(fromISO(session.date)))
    sessionsByWeek.set(weekStart, [...(sessionsByWeek.get(weekStart) ?? []), session])
  }
  for (const log of dayLogs) {
    const weekStart = toISO(getWeekStart(fromISO(log.date)))
    logsByWeek.set(weekStart, [...(logsByWeek.get(weekStart) ?? []), log])
  }

  const weeks: PlanBuilderRecentWeekContext[] = []
  for (let i = 0; i < lookbackWeeks; i++) {
    const weekStartDate = toISO(addDays(fromISO(firstWeekStart), i * 7))
    const weekSessions = sessionsByWeek.get(weekStartDate) ?? []
    const weekLogs = logsByWeek.get(weekStartDate) ?? []
    const summary = summariesByWeek.get(weekStartDate)
    if (!summary && weekSessions.length === 0 && weekLogs.length === 0) continue
    weeks.push(buildWeekContext(weekStartDate, weekSessions, weekLogs, summary))
  }

  return {
    referenceDate,
    lookbackWeeks,
    hasHistory: weeks.length > 0,
    weeks,
    summary: buildSummary(weeks),
  }
}

export function renderPlanBuilderRecentContext(context: PlanBuilderRecentContext | undefined): string {
  if (!context || !context.hasHistory) {
    return [
      'Historial reciente:',
      '- Sin historial suficiente antes del inicio del plan. No inventes adherencia, fatiga ni cargas previas.',
      '- Usa el perfil, el wizard y las reglas de fase como fuente principal.',
    ].join('\n')
  }

  const summary = context.summary
  const header = [
    'Historial reciente real:',
    `- Ventana: ${context.lookbackWeeks} semanas antes de ${context.referenceDate}`,
    summary.avgAdherencePct != null ? `- Adherencia promedio: ${summary.avgAdherencePct}%` : '',
    summary.avgCompletedMinutes != null ? `- Minutos completados promedio/semana: ${summary.avgCompletedMinutes}` : '',
    summary.avgActualRpe != null ? `- RPE real promedio: ${summary.avgActualRpe}/10` : '',
    summary.avgSleep != null ? `- Sueño promedio: ${summary.avgSleep}h` : '',
    summary.avgEnergy != null ? `- Energía promedio: ${summary.avgEnergy}/10` : '',
    summary.dominantSports.length > 0 ? `- Deportes recientes: ${summary.dominantSports.map((item) => `${item.sport} ${item.sessions}`).join(', ')}` : '',
    `- Recomendación de carga inicial: ${summary.recommendation}`,
    summary.recentPainNotes.length > 0 ? `- Alertas de dolor: ${summary.recentPainNotes.join(' | ')}` : '',
  ].filter(Boolean)

  const weekLines = context.weeks.slice(-4).map((week) => {
    const sports = Object.entries(week.sports)
      .map(([sport, count]) => `${sport} ${count}`)
      .join(', ')
    return [
      `- Semana ${week.weekStartDate}: ${week.completedSessions}/${week.plannedSessions} sesiones`,
      week.adherencePct != null ? `adh ${week.adherencePct}%` : '',
      `${week.completedMinutes}min completados`,
      week.avgActualRpe != null ? `RPE ${week.avgActualRpe}` : '',
      week.avgEnergy != null ? `energía ${week.avgEnergy}` : '',
      sports ? `deportes ${sports}` : '',
    ].filter(Boolean).join(' · ')
  })

  return [
    ...header,
    weekLines.length > 0 ? 'Últimas semanas:' : '',
    ...weekLines,
    'Uso del historial: calibra el arranque del plan con estos datos, pero respeta evento, fase, días disponibles y deportes permitidos.',
  ].filter(Boolean).join('\n')
}
