import { addDays } from 'date-fns'
import type {
  CoachAction,
  MacroWeekCoherenceSummary,
  Session,
  SupportedSport,
  WeekSummary,
} from '../types'
import { toISO, fromISO, getWeekStart } from '../utils/date'
import { getSportLabel } from '../utils/sport'
import { buildActionAlerts, type ActionAlertsInput, type ActionableAlert } from './actionAlerts'
import { buildFallbackCyclingDetails, buildFallbackMobilityDetails } from './coachProposalMetadata'

export interface AutoAdjustmentDraft {
  alertId: string
  title: string
  message: string
  actions: CoachAction[]
}

type AdjustmentContext = ActionAlertsInput

export function buildAutoAdjustmentDraft(input: AdjustmentContext): AutoAdjustmentDraft | null {
  const alerts = buildActionAlerts(input)
  for (const alert of alerts) {
    const draft = buildDraftFromAlert(alert, input)
    if (draft) return draft
  }
  return null
}

function buildDraftFromAlert(
  alert: ActionableAlert,
  input: AdjustmentContext,
): AutoAdjustmentDraft | null {
  switch (alert.id) {
    case 'macro-week-coherence-warning':
      return buildCoherenceDraft(alert, input)
    case 'weekly-adherence-drop':
      return buildAdherenceDraft(alert, input)
    default:
      if (!alert.id.startsWith('acwr-risk-')) return null
      return buildLoadRiskDraft(alert, input)
  }
}

function buildCoherenceDraft(
  alert: ActionableAlert,
  input: AdjustmentContext,
): AutoAdjustmentDraft | null {
  const context = input.macroWeekCoherence
  if (!context) return null

  const supportCandidate = pickSupportReductionCandidate(input.sessions, context, input.today)
  if (!supportCandidate) return null

  const actions: CoachAction[] = []
  const moveTargetDate = findLaterMoveTarget(supportCandidate, input.sessions)
  if (moveTargetDate) {
    actions.push({
      type: 'move_session',
      sessionId: supportCandidate.id,
      targetDate: moveTargetDate,
      reason: `Mover ${supportCandidate.title} para despejar la distribucion del bloque y bajar interferencia accesoria.`,
    })
  }

  actions.push({
    type: 'update_session',
    sessionId: supportCandidate.id,
    newDurationMin: reduceDuration(supportCandidate.durationMin, 0.75),
    newRpe: reduceRpe(supportCandidate.rpe),
    cyclingDetails: supportCandidate.type === 'cycling' ? buildFallbackCyclingDetails(supportCandidate, supportCandidate) : undefined,
    mobilityDetails: supportCandidate.type === 'mobility' ? buildFallbackMobilityDetails(supportCandidate, supportCandidate) : undefined,
    reason: `Recortar ${supportCandidate.title} porque hoy el bloque pide menos carga accesoria y mas protagonismo del deporte principal.`,
  })

  const mobilityTargetDate = shouldAddMobilitySupport(context.currentPhase)
    ? findRecoveryInsertDate(supportCandidate, input.sessions)
    : null
  if (mobilityTargetDate) {
    actions.push(buildMobilitySupportAction({
      targetDate: mobilityTargetDate,
      reason: `Agregar movilidad contextual para sostener frescura y coherencia con la fase ${context.currentPhase}.`,
      sourceSession: supportCandidate,
      intentLabel: 'movilidad de soporte del bloque',
    }))
  }

  return {
    alertId: alert.id,
    title: 'Ajuste automatico por incoherencia semanal',
    message: `Detecte una incoherencia con el bloque actual. Prepare un ajuste rapido para bajar la carga accesoria${moveTargetDate ? ' y mover la misma sesion a un momento menos conflictivo' : ''}. Revisalo y aplicalo si te calza.`,
    actions,
  }
}

function buildLoadRiskDraft(
  alert: ActionableAlert,
  input: AdjustmentContext,
): AutoAdjustmentDraft | null {
  const sport = extractSportFromAlertId(alert.id)
  if (!sport) return null

  const candidate = pickLoadRiskCandidate(input.sessions, sport, input.today)
  if (!candidate) return null

  const actions: CoachAction[] = [
    {
      type: 'update_session',
      sessionId: candidate.id,
      newDurationMin: reduceDuration(candidate.durationMin, 0.7),
      newRpe: reduceRpe(candidate.rpe, 2),
      cyclingDetails: sport === 'cycling' ? buildFallbackCyclingDetails(candidate, candidate) : undefined,
      reason: `Reducir la proxima carga de ${getSportLabel(sport)} para bajar riesgo ACWR y evitar seguir subiendo demasiado rapido.`,
    },
  ]

  const recoveryTargetDate = findRecoveryInsertDate(candidate, input.sessions)
  if (recoveryTargetDate) {
    actions.push(
      sport === 'cycling'
        ? buildMobilitySupportAction({
            targetDate: recoveryTargetDate,
            reason: 'Insertar movilidad post-cycling para amortiguar la fatiga despues del ajuste de carga.',
            sourceSession: candidate,
            intentLabel: 'movilidad post-cycling',
          })
        : {
            type: 'insert_recovery',
            targetDate: recoveryTargetDate,
            reason: `Insertar recuperacion activa para amortiguar la fatiga despues del ajuste de carga en ${getSportLabel(sport)}.`,
          },
    )
  }

  return {
    alertId: alert.id,
    title: `Ajuste automatico por riesgo de carga en ${getSportLabel(sport)}`,
    message: `Detecte riesgo de carga en ${getSportLabel(sport)}. Prepare una version mas conservadora de la siguiente sesion${recoveryTargetDate ? ' y agregue una recuperacion de soporte' : ''} para bajar el riesgo sin romper la semana.`,
    actions,
  }
}

function buildAdherenceDraft(
  alert: ActionableAlert,
  input: AdjustmentContext,
): AutoAdjustmentDraft | null {
  const candidate = pickAdherenceCandidate(input.sessions, input.currentWeekSummary, input.today)
  if (!candidate) return null

  const actions: CoachAction[] = []
  const moveTargetDate = findLaterMoveTarget(candidate, input.sessions)
  if (moveTargetDate) {
    actions.push({
      type: 'move_session',
      sessionId: candidate.id,
      targetDate: moveTargetDate,
      reason: `Mover ${candidate.title} a un dia con menos friccion para que la semana sea mas realista de completar.`,
    })
  }
  actions.push({
    type: 'update_session',
    sessionId: candidate.id,
    newDurationMin: reduceDuration(candidate.durationMin, 0.7),
    newRpe: reduceRpe(candidate.rpe),
    cyclingDetails: candidate.type === 'cycling' ? buildFallbackCyclingDetails(candidate, candidate) : undefined,
    mobilityDetails: candidate.type === 'mobility' ? buildFallbackMobilityDetails(candidate, candidate) : undefined,
    reason: `Recortar ${candidate.title} para recuperar adherencia y evitar que la semana siga acumulando sesiones poco realistas.`,
  })

  return {
    alertId: alert.id,
    title: 'Ajuste automatico por baja adherencia',
    message: `La adherencia semanal viene baja. Prepare un ajuste mas realista sobre ${candidate.title}${moveTargetDate ? ' y movi la misma sesion a un slot menos cargado' : ''} para aumentar la probabilidad de completar la semana.`,
    actions,
  }
}

function pickSupportReductionCandidate(
  sessions: Session[],
  coherence: MacroWeekCoherenceSummary,
  today?: string,
): Session | null {
  const futurePlanned = getFuturePlannedSessions(sessions, today)
  const sorted = [...futurePlanned].sort((a, b) => supportPenalty(b, coherence) - supportPenalty(a, coherence))
  return sorted.find((session) => supportPenalty(session, coherence) > 0) ?? null
}

function pickLoadRiskCandidate(
  sessions: Session[],
  sport: 'running' | 'squash' | 'strength' | 'cycling',
  today?: string,
): Session | null {
  const futurePlanned = getFuturePlannedSessions(sessions, today)
    .filter((session) => session.type === sport)
    .sort((a, b) => candidateLoadScore(b) - candidateLoadScore(a))
  return futurePlanned[0] ?? null
}

function pickAdherenceCandidate(
  sessions: Session[],
  summary?: WeekSummary | null,
  today?: string,
): Session | null {
  if (!summary || summary.plannedSessions < 3) return null
  const futurePlanned = getFuturePlannedSessions(sessions, today)
  const sorted = [...futurePlanned].sort((a, b) => adherencePenalty(b) - adherencePenalty(a))
  return sorted[0] ?? null
}

function getFuturePlannedSessions(sessions: Session[], today?: string): Session[] {
  const reference = today ?? toISO(new Date())
  return sessions.filter((session) => session.status === 'planned' && session.date >= reference)
}

function supportPenalty(session: Session, coherence: MacroWeekCoherenceSummary): number {
  const sport = toSupportedSport(session)
  const role = sport ? coherence.targetDistributionBySport[sport] : undefined
  let penalty = 0
  if (role === 'excluded') penalty += 100
  if (role === 'support') penalty += 55
  if (session.type === 'strength') penalty += 10
  if (session.type === 'mobility') penalty -= 20
  penalty += candidateLoadScore(session)
  return penalty
}

function toSupportedSport(session: Session): SupportedSport | null {
  switch (session.type) {
    case 'squash':
    case 'running':
    case 'strength':
    case 'mobility':
    case 'cycling':
      return session.type
    default:
      return null
  }
}

function adherencePenalty(session: Session): number {
  let penalty = candidateLoadScore(session)
  if (session.type === 'mobility' || session.type === 'recovery') penalty -= 25
  if (session.type === 'strength' || session.type === 'cycling') penalty += 10
  return penalty
}

function candidateLoadScore(session: Session): number {
  return session.durationMin + ((session.rpe ?? 6) * 8)
}

function findLaterMoveTarget(session: Session, sessions: Session[]): string | null {
  const weekStart = session.weekStartDate ?? toISO(getWeekStart(fromISO(session.date)))
  const weekEnd = addDays(fromISO(weekStart), 6)
  let cursor = addDays(fromISO(session.date), 1)

  while (cursor <= weekEnd) {
    const dateISO = toISO(cursor)
    const collision = sessions.some((item) => item.date === dateISO && item.timeBlock === session.timeBlock)
    if (!collision) return dateISO
    cursor = addDays(cursor, 1)
  }

  return null
}

function findRecoveryInsertDate(session: Session, sessions: Session[]): string | null {
  const weekStart = session.weekStartDate ?? toISO(getWeekStart(fromISO(session.date)))
  const weekEnd = addDays(fromISO(weekStart), 6)
  let cursor = addDays(fromISO(session.date), 1)

  while (cursor <= weekEnd) {
    const dateISO = toISO(cursor)
    const hasRecovery = sessions.some((item) => item.date === dateISO && item.type === 'recovery')
    const sessionCount = sessions.filter((item) => item.date === dateISO).length
    if (!hasRecovery && sessionCount === 0) return dateISO
    cursor = addDays(cursor, 1)
  }

  return null
}

function reduceDuration(durationMin: number, factor: number): number {
  return Math.max(20, Math.round((durationMin * factor) / 5) * 5)
}

function reduceRpe(rpe?: number, delta = 1): number {
  return Math.max(3, (rpe ?? 6) - delta)
}

function shouldAddMobilitySupport(phase: MacroWeekCoherenceSummary['currentPhase']): boolean {
  return ['peak', 'taper', 'race', 'transition'].includes(phase)
}

function extractSportFromAlertId(alertId: string): 'running' | 'squash' | 'strength' | 'cycling' | null {
  if (alertId.endsWith('running')) return 'running'
  if (alertId.endsWith('squash')) return 'squash'
  if (alertId.endsWith('strength')) return 'strength'
  if (alertId.endsWith('cycling')) return 'cycling'
  return null
}

function buildMobilitySupportAction(input: {
  targetDate: string
  reason: string
  sourceSession?: Session
  intentLabel: string
}): CoachAction {
  const mobilityDetails = buildFallbackMobilityDetails({
    title: input.intentLabel,
    objective: input.reason,
    exercises: input.sourceSession?.exercises,
  }, input.sourceSession)

  return {
    type: 'add_session',
    targetDate: input.targetDate,
    timeBlock: 'PM',
    sessionType: 'mobility',
    title: resolveMobilityTitle(mobilityDetails.context),
    durationMin: mobilityDetails.context === 'pre_training_activation' ? 15 : 25,
    rpe: mobilityDetails.context === 'pre_training_activation' ? 3 : 4,
    objective: input.intentLabel,
    mobilityDetails,
    reason: input.reason,
  }
}

function resolveMobilityTitle(context: NonNullable<CoachAction['mobilityDetails']>['context']): string {
  switch (context) {
    case 'post_cycling':
      return 'Movilidad post-cycling'
    case 'post_run':
      return 'Movilidad post-running'
    case 'post_squash':
      return 'Movilidad post-squash'
    case 'post_strength':
      return 'Reset post-fuerza'
    case 'pre_training_activation':
      return 'Activacion articular'
    case 'recovery':
      return 'Movilidad de recuperacion'
    case 'full_body':
      return 'Movilidad full body'
    default:
      return 'Movilidad especifica'
  }
}
