import { getExecutedSessions } from '../training/executedSessions'
import { addDays, getDay } from 'date-fns'
import { db } from '../../db/db'
import type { DayLog, Session, SessionType, WeekSummary } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { isWhoopPrefilled } from '../readiness/dayLogPrefillSave'

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
  /** RPE real autoreportado, excluyendo prefill Whoop. */
  avgManualActualRpe?: number
  /** Cuántos valores respaldan `avgManualActualRpe`. */
  manualRpeSampleCount: number
  /** Energía autoreportada más reciente de la semana, excluyendo prefill Whoop. */
  latestManualEnergyLevel?: number
  /** Dolor numérico más reciente de la semana. Whoop nunca lo prellena. */
  latestManualPainLevel?: number
  /** Sueño autoreportado promedio, excluyendo prefill Whoop. */
  avgManualSleepHours?: number
}

export interface PlanBuilderWeeklyStructureSport {
  sport: SessionType
  count: number
  typicalDurationMin?: number
}

export interface PlanBuilderWeeklyStructureDay {
  /** ISO weekday: 1 = lunes ... 7 = domingo. */
  weekday: number
  sports: PlanBuilderWeeklyStructureSport[]
}

export interface PlanBuilderRecentContext {
  executedSessions?: Session[]
  /** Instante de la captura (B2). Ausente en payloads anteriores a la Fase B. */
  capturedAt?: number
  /** Hasta 5 sesiones de fuerza ejecutadas antes del corte: historial de progresión de B1. */
  executedStrengthSessions?: Session[]
  /**
   * Filas crudas de la última semana vivida con datos (sólo en recalibración).
   * Alimentan `buildExecutionSignals`; `adherencePct` conserva el valor que ya
   * calculaba el contexto (WeekSummary si existe).
   */
  signalRows?: { weekStartDate: string; sessions: Session[]; dayLogs: DayLog[]; adherencePct?: number }
  referenceDate: string
  lookbackWeeks: number
  hasHistory: boolean
  weeks: PlanBuilderRecentWeekContext[]
  /** Número de semanas reales usadas para derivar el esqueleto estructural. */
  structureWeeks: number
  /** Esqueleto semanal por día derivado del último bloque real del atleta. */
  weeklyStructure: PlanBuilderWeeklyStructureDay[]
  /**
   * Semanas del propio plan que el atleta YA vivió. Sólo se puebla cuando se
   * pide el contexto con `asOfDate` (recalibración de un plan en curso). En la
   * generación inicial es `undefined`, porque ninguna semana del plan ocurrió
   * todavía.
   *
   * NOTA: esta interfaz está duplicada en `recentContext.ts` y
   * `recentContextRender.ts`. Mantener ambas en sincronía.
   */
  livedPlanWeeks?: PlanBuilderRecentWeekContext[]
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
const STRUCTURE_WEEKS = 3
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

/** ISO weekday: 1 = lunes ... 7 = domingo (date-fns getDay devuelve 0 = domingo). */
function isoWeekday(dateIso: string): number {
  return ((getDay(fromISO(dateIso)) + 6) % 7) + 1
}

/**
 * Deriva el esqueleto semanal del atleta a partir de sesiones reales: qué deporte
 * cae en cada día, cuántas veces y su duración planificada típica. Sirve para que la
 * IA replique la estructura que ya le funcionó, adaptándola al contexto del plan.
 */
export function summarizeWeeklyStructure(sessions: Session[]): PlanBuilderWeeklyStructureDay[] {
  const byDay = new Map<number, Map<SessionType, { count: number; durations: number[] }>>()
  for (const session of sessions) {
    if (session.status === 'skipped') continue
    const weekday = isoWeekday(session.date)
    const sportsForDay = byDay.get(weekday) ?? new Map<SessionType, { count: number; durations: number[] }>()
    const entry = sportsForDay.get(session.type) ?? { count: 0, durations: [] }
    entry.count += 1
    if (session.durationMin > 0) entry.durations.push(session.durationMin)
    sportsForDay.set(session.type, entry)
    byDay.set(weekday, sportsForDay)
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, sportsMap]) => ({
      weekday,
      sports: [...sportsMap.entries()]
        .map(([sport, data]) => ({
          sport,
          count: data.count,
          typicalDurationMin: data.durations.length > 0
            ? Math.round(data.durations.reduce((sum, value) => sum + value, 0) / data.durations.length)
            : undefined,
        }))
        .sort((a, b) => b.count - a.count),
    }))
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

  // Señales AUTOREPORTADAS. Se calculan aparte de los promedios existentes a
  // propósito: `avgActualRpe`/`avgEnergy`/`avgSleep` alimentan el render del
  // historial y el `recommendation`, y cambiarles la definición movería un
  // comportamiento ya desplegado. Estas otras alimentan la directiva de carga,
  // que exige datos declarados por el atleta.
  const manualLogs = [...dayLogs].sort((a, b) => a.date.localeCompare(b.date))

  const manualRpeValues = [
    ...completedSessions
      .map((session) => session.actualRpe)
      .filter((value): value is number => value != null),
    ...manualLogs
      .filter((log) => !isWhoopPrefilled(log, 'rpeActual'))
      .map((log) => log.rpeActual)
      .filter((value): value is number => value != null),
  ]

  const manualSleepValues = manualLogs
    .filter((log) => !isWhoopPrefilled(log, 'sleepHours'))
    .map((log) => log.sleepHours)
    .filter((value): value is number => value != null)

  const manualEnergyLogs = manualLogs.filter((log) => !isWhoopPrefilled(log, 'energyLevel'))
  const latestManualEnergy = [...manualEnergyLogs]
    .reverse()
    .find((log) => log.energyLevel != null)?.energyLevel

  // El dolor no es prellenable por Whoop, así que no se filtra.
  const latestManualPain = [...manualLogs]
    .reverse()
    .find((log) => log.painLevel != null)?.painLevel

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
    avgManualActualRpe: average(manualRpeValues),
    manualRpeSampleCount: manualRpeValues.length,
    latestManualEnergyLevel: latestManualEnergy,
    latestManualPainLevel: latestManualPain,
    avgManualSleepHours: average(manualSleepValues),
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

const PAYLOAD_MAX_WEEKS = 4
const PAYLOAD_MAX_HIGHLIGHTS = 3
const PAYLOAD_MAX_PAIN_NOTES = 3

/**
 * Reduces the recent context to a payload-friendly subset before sending it to
 * the background generator: only the most recent weeks, with capped per-week
 * highlight/pain arrays. The summary and weekly structure are kept intact
 * because they are already bounded and carry the highest signal per byte.
 */
export function trimRecentContextForPayload(context: PlanBuilderRecentContext): PlanBuilderRecentContext {
  const trimWeek = (week: PlanBuilderRecentWeekContext): PlanBuilderRecentWeekContext => ({
    ...week,
    sessionHighlights: week.sessionHighlights.slice(0, PAYLOAD_MAX_HIGHLIGHTS),
    painNotes: week.painNotes.slice(0, PAYLOAD_MAX_PAIN_NOTES),
  })
  return {
    ...context,
    weeks: context.weeks.slice(-PAYLOAD_MAX_WEEKS).map(trimWeek),
    // `livedPlanWeeks` crece con el largo del plan, así que necesita el mismo
    // tope que el historial pre-plan: sin esto un plan de 12 semanas
    // recalibrado tarde manda las semanas vividas sin acotar y las renderiza
    // en cada prompt del batch. Se conserva `undefined` cuando no hay
    // recalibración, para no introducir un arreglo vacío en el payload.
    ...(context.livedPlanWeeks
      ? { livedPlanWeeks: context.livedPlanWeeks.slice(-PAYLOAD_MAX_WEEKS).map(trimWeek) }
      : {}),
  }
}

export async function buildPlanBuilderRecentContext(
  plan: TrainingPlan,
  lookbackWeeks = DEFAULT_LOOKBACK_WEEKS,
  options?: { asOfDate?: string; now?: number },
): Promise<PlanBuilderRecentContext> {
  // Sin `asOfDate` el anclaje sigue siendo el inicio del plan, que es el
  // comportamiento de la generación inicial y no debe cambiar. Con `asOfDate`
  // —recalibración— el anclaje se mueve a hoy, de modo que la ventana de
  // lookback alcanza las semanas del plan que el atleta ya vivió.
  const referenceDate = options?.asOfDate ?? plan.startDate
  const referenceWeekStart = getWeekStart(fromISO(referenceDate))
  const planStart = toISO(getWeekStart(fromISO(plan.startDate)))
  const lookbackFirstWeekStart = toISO(addDays(referenceWeekStart, -(lookbackWeeks * 7)))
  // Con `asOfDate`, la ventana de lookback fija (6 semanas por defecto) puede
  // no alcanzar hasta el inicio del plan en un plan largo, dejando fuera en
  // silencio las primeras semanas vividas. La ventana de lectura se extiende
  // hacia atrás como mínimo hasta la semana de `plan.startDate` — nunca la
  // acorta — para que `livedPlanWeeks` siempre pueda cubrir el plan completo.
  // Sin `asOfDate` esto no aplica: `planStart` coincide con `referenceWeekStart`
  // (no hay semanas vividas que cubrir) y el comportamiento no cambia.
  const firstWeekStart = options?.asOfDate && planStart < lookbackFirstWeekStart
    ? planStart
    : lookbackFirstWeekStart
  const lastHistoryDate = toISO(addDays(referenceWeekStart, -1))
  const sessions = filterRowsToActiveScope(
    await db.sessions
      .where('date')
      .between(firstWeekStart, lastHistoryDate, true, true)
      .toArray(),
  )
  const dayLogs = filterRowsToActiveScope(
    await db.dayLogs
      .where('date')
      .between(firstWeekStart, lastHistoryDate, true, true)
      .toArray(),
  )
  const summaries = filterRowsToActiveScope(
    await db.weekSummaries
      .where('weekStartDate')
      .between(firstWeekStart, lastHistoryDate, true, true)
      .toArray(),
  )
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

  // `allWeeks` recorre toda la ventana leída (`firstWeekStart` .. `referenceWeekStart`
  // exclusivo) en pasos de 7 días. Con `asOfDate`, esa ventana ya puede exceder
  // `lookbackWeeks` semanas (ver comentario de `firstWeekStart`), así que el
  // recorrido usa la distancia real en vez del contador fijo original.
  const allWeeks: PlanBuilderRecentWeekContext[] = []
  let cursor = fromISO(firstWeekStart)
  while (cursor < referenceWeekStart) {
    const weekStartDate = toISO(cursor)
    const weekSessions = sessionsByWeek.get(weekStartDate) ?? []
    const weekLogs = logsByWeek.get(weekStartDate) ?? []
    const summary = summariesByWeek.get(weekStartDate)
    if (summary || weekSessions.length > 0 || weekLogs.length > 0) {
      allWeeks.push(buildWeekContext(weekStartDate, weekSessions, weekLogs, summary))
    }
    cursor = addDays(cursor, 7)
  }

  const structureWeekStarts = [...sessionsByWeek.keys()].sort().slice(-STRUCTURE_WEEKS)
  const structureSessions = structureWeekStarts.flatMap((weekStart) => sessionsByWeek.get(weekStart) ?? [])

  // Las semanas del propio plan ya vividas se exponen aparte: mezclarlas con el
  // historial pre-plan borraría la distinción entre "así entrenaba antes" y
  // "así le está yendo con ESTE plan", que es justo lo que la directiva de
  // carga necesita distinguir. Por eso la partición ocurre en el origen —
  // `weeks`/`summary`/`recommendation` sólo ven `preWeeks` — y no como un
  // filtro derivado que dejaría las mismas semanas presentes en ambos lados.
  // Sin `asOfDate`, `allWeeks` ya es puramente pre-plan (la ventana de lectura
  // termina antes de `referenceWeekStart === planStart`), así que `preWeeks`
  // es idéntico a `allWeeks` y `livedPlanWeeks` permanece `undefined`.
  const preWeeks = options?.asOfDate
    ? allWeeks.filter((week) => week.weekStartDate < planStart)
    : allWeeks
  const livedPlanWeeks = options?.asOfDate
    ? allWeeks.filter((week) => week.weekStartDate >= planStart)
    : undefined

  const lastLived = livedPlanWeeks?.at(-1)
  const signalRows = lastLived
    ? {
        weekStartDate: lastLived.weekStartDate,
        sessions: sessionsByWeek.get(lastLived.weekStartDate) ?? [],
        dayLogs: logsByWeek.get(lastLived.weekStartDate) ?? [],
        adherencePct: lastLived.adherencePct,
      }
    : undefined

  return {
    referenceDate,
    executedSessions: getExecutedSessions(sessions, referenceDate).filter(s => s.type === 'squash' || s.type === 'running').slice(0, 12),
    capturedAt: options?.now ?? Date.now(),
    executedStrengthSessions: getExecutedSessions(sessions, referenceDate).filter((s) => s.type === 'strength').slice(0, 5),
    ...(signalRows ? { signalRows } : {}),
    lookbackWeeks,
    hasHistory: preWeeks.length > 0,
    weeks: preWeeks,
    structureWeeks: structureWeekStarts.length,
    weeklyStructure: summarizeWeeklyStructure(structureSessions),
    livedPlanWeeks,
    summary: buildSummary(preWeeks),
  }
}

function renderWeeklyStructure(context: PlanBuilderRecentContext): string {
  if (!context.weeklyStructure || context.weeklyStructure.length === 0) return ''
  const dayLines = context.weeklyStructure.map((day) => {
    const sports = day.sports
      .map((sport) => {
        const reps = sport.count > 1 ? ` ×${sport.count}` : ''
        const duration = sport.typicalDurationMin ? ` ~${sport.typicalDurationMin}min` : ''
        return `${sport.sport}${reps}${duration}`
      })
      .join(', ')
    return `- ${WEEKDAY_LABELS[day.weekday - 1]}: ${sports}`
  })
  return [
    `Esqueleto semanal de tu último bloque real (${context.structureWeeks} sem · referencia de estructura, no copiar literal):`,
    ...dayLines,
    'Usa esta distribución por días como base de la estructura cuando el contexto lo permita; ajusta deportes, volumen e intensidad según fase, evento y fatiga.',
  ].join('\n')
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
    renderWeeklyStructure(context),
    'Uso del historial: calibra el arranque del plan con estos datos, pero respeta evento, fase, días disponibles y deportes permitidos.',
  ].filter(Boolean).join('\n')
}
