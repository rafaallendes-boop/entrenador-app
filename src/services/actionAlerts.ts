import type { DayLog, MacroWeekCoherenceSummary, Session, WeekSummary } from '../types'
import type { DisciplineAcwr, LoadAnalytics, SportKey } from './loadAnalytics'

export type ActionAlertSeverity = 'high' | 'medium' | 'low'
export type ActionAlertTarget = 'chat' | 'week' | 'checkin'

export interface ActionableAlert {
  id: string
  severity: ActionAlertSeverity
  title: string
  body: string
  recommendation: string
  ctaLabel: string
  target: ActionAlertTarget
}

export interface ActionAlertsInput {
  sessions: Session[]
  currentWeekSummary?: WeekSummary | null
  todayDayLog?: DayLog
  macroWeekCoherence?: MacroWeekCoherenceSummary | null
  loadAnalytics?: LoadAnalytics | null
  today?: string
}

const SPORT_LABELS: Record<SportKey, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
}

const SEVERITY_WEIGHT: Record<ActionAlertSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

const ALERT_PRIORITY: Record<string, number> = {
  'macro-week-coherence-warning': 1,
  'acwr-risk-running': 2,
  'acwr-risk-squash': 2,
  'acwr-risk-strength': 2,
  'recovery-checkin-strain': 3,
  'recovery-checkin-missing': 4,
  'weekly-adherence-drop': 5,
}

export function buildActionAlerts(input: ActionAlertsInput): ActionableAlert[] {
  const alerts: ActionableAlert[] = []
  const today = input.today ?? todayISODate()

  const coherenceAlert = buildCoherenceAlert(input.macroWeekCoherence)
  if (coherenceAlert) alerts.push(coherenceAlert)

  const acwrAlerts = buildAcwrAlerts(input.loadAnalytics)
  alerts.push(...acwrAlerts)

  const recoveryAlert = buildRecoveryAlert(input.sessions, today, input.todayDayLog)
  if (recoveryAlert) alerts.push(recoveryAlert)

  const adherenceAlert = buildAdherenceAlert(input.currentWeekSummary)
  if (adherenceAlert) alerts.push(adherenceAlert)

  return dedupeAlerts(alerts).sort(compareAlerts)
}

function buildCoherenceAlert(
  coherence: MacroWeekCoherenceSummary | null | undefined,
): ActionableAlert | null {
  if (!coherence || coherence.coherenceStatus !== 'warning' || coherence.coherenceIssues.length === 0) {
    return null
  }

  return {
    id: 'macro-week-coherence-warning',
    severity: 'high',
    title: 'Tu semana no calza con el bloque actual',
    body: coherence.coherenceIssues[0],
    recommendation: `Ajusta la distribucion de la semana para respetar la regla del bloque: ${coherence.weeklyRule}`,
    ctaLabel: 'Revisar semana',
    target: 'week',
  }
}

function buildAcwrAlerts(loadAnalytics: LoadAnalytics | null | undefined): ActionableAlert[] {
  if (!loadAnalytics) return []

  const alerts: ActionableAlert[] = []
  const riskySports = Object.values(loadAnalytics.acwrByDiscipline).filter((item) => item.status === 'risk')
  const undertrainedSports = Object.values(loadAnalytics.acwrByDiscipline).filter((item) => item.status === 'undertrained')

  if (riskySports.length > 0) {
    const leadRisk = riskySports.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0]
    alerts.push({
      id: `acwr-risk-${leadRisk.sport}`,
      severity: 'high',
      title: `Carga en riesgo en ${SPORT_LABELS[leadRisk.sport]}`,
      body: describeAcwrRisk(leadRisk),
      recommendation: 'Pide al coach un ajuste de carga o baja una sesion accesoria antes de acumular fatiga innecesaria.',
      ctaLabel: 'Pedir ajuste',
      target: 'chat',
    })
  }

  if (riskySports.length === 0 && undertrainedSports.length > 0) {
    const leadDetrain = undertrainedSports.sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1))[0]
    alerts.push({
      id: `acwr-undertrained-${leadDetrain.sport}`,
      severity: 'low',
      title: `${SPORT_LABELS[leadDetrain.sport]} quedo corto esta semana`,
      body: describeAcwrUndertrained(leadDetrain),
      recommendation: 'Si el bloque pide progresion, agrega una sesion util o recupera una calidad perdida.',
      ctaLabel: 'Ver semana',
      target: 'week',
    })
  }

  return alerts
}

function buildRecoveryAlert(
  sessions: Session[],
  today: string,
  todayDayLog?: DayLog,
): ActionableAlert | null {
  const todayCompleted = sessions.filter((session) => session.date === today && session.status === 'completed')
  if (todayCompleted.length === 0) return null

  const pendingFeedbackCount = todayCompleted.filter((session) => !session.sessionFeedback).length
  const missingCheckIn =
    todayDayLog == null ||
    todayDayLog.energyLevel == null ||
    todayDayLog.sleepQuality == null ||
    todayDayLog.rpeActual == null

  const strainedSession = todayCompleted.some((session) => {
    const feedback = session.sessionFeedback
    return feedback != null && (feedback.rating <= 2 || feedback.energyDuringSession <= 2)
  })

  if (!missingCheckIn && pendingFeedbackCount === 0 && !strainedSession) return null

  if (strainedSession) {
    return {
      id: 'recovery-checkin-strain',
      severity: 'medium',
      title: 'Hoy hubo una sesion pesada',
      body: 'Marcaste sensaciones bajas dentro de la sesion y conviene cerrar el contexto del dia.',
      recommendation: 'Completa el check-in y deja una nota corta para que el coach ajuste mejor la siguiente carga.',
      ctaLabel: 'Completar check-in',
      target: 'checkin',
    }
  }

  if (pendingFeedbackCount > 0 || missingCheckIn) {
    return {
      id: 'recovery-checkin-missing',
      severity: 'medium',
      title: 'Te falta cerrar el dia',
      body: pendingFeedbackCount > 0
        ? `Hay ${pendingFeedbackCount} sesion${pendingFeedbackCount === 1 ? '' : 'es'} completada${pendingFeedbackCount === 1 ? '' : 's'} sin feedback.`
        : 'Aun faltan tus sensaciones del dia para calibrar la semana.',
      recommendation: 'Registra energia, sueno y feedback de sesion para que el coach no trabaje a ciegas.',
      ctaLabel: 'Abrir check-in',
      target: 'checkin',
    }
  }

  return null
}

function buildAdherenceAlert(summary: WeekSummary | null | undefined): ActionableAlert | null {
  if (!summary || summary.plannedSessions < 3 || summary.completedSessions >= summary.plannedSessions) {
    return null
  }

  const adherence = summary.adherencePct ?? Math.round((summary.completedSessions / summary.plannedSessions) * 100)
  if (adherence >= 60) return null

  return {
    id: 'weekly-adherence-drop',
    severity: 'medium',
    title: 'La adherencia de la semana viene baja',
    body: `Llevas ${summary.completedSessions}/${summary.plannedSessions} sesiones completadas (${adherence}%).`,
    recommendation: 'Recorta o reordena la semana antes de seguir acumulando sesiones que probablemente no haras.',
    ctaLabel: 'Ajustar semana',
    target: 'chat',
  }
}

function describeAcwrRisk(acwr: DisciplineAcwr): string {
  const ratio = acwr.ratio != null ? `ACWR ${acwr.ratio.toFixed(2)}` : 'Carga aguda muy por encima de la base'
  return `${ratio}. La carga reciente de ${SPORT_LABELS[acwr.sport]} esta subiendo demasiado rapido.`
}

function describeAcwrUndertrained(acwr: DisciplineAcwr): string {
  const ratio = acwr.ratio != null ? `ACWR ${acwr.ratio.toFixed(2)}` : 'La carga reciente quedo baja'
  return `${ratio}. La semana actual esta por debajo de lo que venias sosteniendo en ${SPORT_LABELS[acwr.sport]}.`
}

function dedupeAlerts(alerts: ActionableAlert[]): ActionableAlert[] {
  const byId = new Map<string, ActionableAlert>()
  for (const alert of alerts) {
    if (!byId.has(alert.id)) byId.set(alert.id, alert)
  }
  return [...byId.values()]
}

function compareAlerts(a: ActionableAlert, b: ActionableAlert): number {
  if (SEVERITY_WEIGHT[b.severity] !== SEVERITY_WEIGHT[a.severity]) {
    return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
  }

  const aPriority = ALERT_PRIORITY[a.id] ?? 99
  const bPriority = ALERT_PRIORITY[b.id] ?? 99
  if (aPriority !== bPriority) {
    return aPriority - bPriority
  }

  return a.title.localeCompare(b.title)
}

function todayISODate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
