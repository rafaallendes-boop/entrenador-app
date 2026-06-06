import type { SessionType } from '../../types'

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
  referenceDate: string
  lookbackWeeks: number
  hasHistory: boolean
  weeks: PlanBuilderRecentWeekContext[]
  structureWeeks: number
  weeklyStructure: PlanBuilderWeeklyStructureDay[]
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
