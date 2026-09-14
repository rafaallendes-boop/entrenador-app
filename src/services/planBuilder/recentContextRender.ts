import type { ExecutionSignals } from '../training/loadDirectivePolicy'
import type { DayLog, Session, SessionType } from '../../types'

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
  structureWeeks: number
  weeklyStructure: PlanBuilderWeeklyStructureDay[]
  /**
   * Semanas del propio plan que el atleta YA vivió. Sólo se puebla cuando se
   * pide el contexto con `asOfDate` (recalibración de un plan en curso). En la
   * generación inicial es `undefined`, porque ninguna semana del plan ocurrió
   * todavía.
   *
   * NOTA: esta interfaz está duplicada en `recentContextRender.ts` y
   * `recentContext.ts`. Mantener ambas en sincronía.
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

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

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

function renderLivedLines(context: PlanBuilderRecentContext): string[] {
  return (context.livedPlanWeeks ?? []).map((week) => {
    return [
      `- Semana ${week.weekStartDate}: ${week.completedSessions}/${week.plannedSessions} sesiones`,
      week.adherencePct != null ? `adh ${week.adherencePct}%` : '',
      week.avgManualActualRpe != null ? `RPE real ${week.avgManualActualRpe}` : '',
      week.latestManualEnergyLevel != null ? `energía ${week.latestManualEnergyLevel}` : '',
      week.painNotes.length > 0 ? `dolor: ${week.painNotes.join(' | ')}` : '',
    ].filter(Boolean).join(' · ')
  })
}

export function renderPlanBuilderRecentContext(context: PlanBuilderRecentContext | undefined): string {
  const hasLivedWeeks = (context?.livedPlanWeeks?.length ?? 0) > 0

  if (!context || (!context.hasHistory && !hasLivedWeeks)) {
    return [
      'Historial reciente:',
      '- Sin historial suficiente antes del inicio del plan. No inventes adherencia, fatiga ni cargas previas.',
      '- Usa el perfil, el wizard y las reglas de fase como fuente principal.',
    ].join('\n')
  }

  if (!context.hasHistory) {
    // Recalibración de un plan sin historial pre-plan (p.ej. un atleta nuevo):
    // no hay base sobre la que armar "Historial reciente real", pero sí hay
    // semanas del propio plan ya vividas. Mostrarlas en vez de descartarlas
    // silenciosamente tras el guard de arriba.
    return [
      'Historial reciente:',
      '- Sin historial suficiente antes del inicio del plan. No inventes adherencia, fatiga ni cargas previas basadas en el pasado.',
      'Semanas de ESTE plan que el atleta ya vivió (datos reales, no planificados):',
      ...renderLivedLines(context),
      'Uso del historial: calibra el ajuste con estos datos reales, pero respeta evento, fase, días disponibles y deportes permitidos.',
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

  const livedLines = renderLivedLines(context)

  return [
    ...header,
    weekLines.length > 0 ? 'Últimas semanas:' : '',
    ...weekLines,
    livedLines.length > 0 ? 'Semanas de ESTE plan que el atleta ya vivió (datos reales, no planificados):' : '',
    ...livedLines,
    renderWeeklyStructure(context),
    'Uso del historial: calibra el arranque del plan con estos datos, pero respeta evento, fase, días disponibles y deportes permitidos.',
  ].filter(Boolean).join('\n')
}

/**
 * Normaliza la última semana YA VIVIDA de este plan a señales de ejecución.
 *
 * Sólo mira `livedPlanWeeks`, no el historial pre-plan: el pre-plan ya calibra
 * el arranque a través de `summary.recommendation` y mezclarlo acá haría que
 * un mal mes anterior siguiera frenando la semana 9 del plan.
 *
 * No lee ningún campo de Whoop.
 */
export function executionSignalsFromLivedWeeks(
  recentContext: PlanBuilderRecentContext | undefined,
): ExecutionSignals | undefined {
  const lived = recentContext?.livedPlanWeeks
  if (!lived || lived.length === 0) return undefined
  const last = lived[lived.length - 1]
  return {
    // Sólo señales AUTOREPORTADAS: los campos `avgActualRpe`/`avgEnergy`/
    // `avgSleep` de la semana incluyen valores prellenados por Whoop y no
    // cumplen el contrato de `ExecutionSignals`.
    avgActualRpe: last.avgManualActualRpe,
    rpeSampleCount: last.manualRpeSampleCount,
    latestEnergyLevel: last.latestManualEnergyLevel,
    latestPainLevel: last.latestManualPainLevel,
    avgSleepHours: last.avgManualSleepHours,
    adherencePct: last.adherencePct,
  }
}
