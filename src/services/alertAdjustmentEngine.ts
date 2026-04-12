import { addDays } from 'date-fns'

import type {
  AthleteProfile,
  CoachAction,
  MacroWeekCoherenceSummary,
  Session,
  SquashDetails,
  SupportedSport,
  WeekSummary,
} from '../types'
import { toISO, fromISO, getWeekStart } from '../utils/date'
import { getSportLabel } from '../utils/sport'
import { buildActionAlerts, type ActionAlertsInput, type ActionableAlert } from './actionAlerts'
import { buildFallbackCyclingDetails, buildFallbackMobilityDetails } from './coachProposalMetadata'
import { buildSlotAdherenceProfile, getSlotAdherenceStats, type SlotAdherenceProfile } from './slotAdherence'
import { getPlanningPrimarySport } from './planningConstraints'

export interface AutoAdjustmentDraft {
  alertId: string
  title: string
  message: string
  actions: CoachAction[]
}

export interface AutoAdjustmentInput extends ActionAlertsInput {
  athleteProfile?: AthleteProfile | null
  historicalSessions?: Session[]
  slotAdherenceProfile?: SlotAdherenceProfile | null
  activeAlerts?: ActionableAlert[]
}

type DraftableSport = 'running' | 'squash' | 'strength' | 'cycling'

const AUTO_ADJUSTMENT_PRIORITY: Record<string, number> = {
  'acwr-risk-running': 0,
  'acwr-risk-squash': 0,
  'acwr-risk-strength': 0,
  'acwr-risk-cycling': 0,
  'macro-week-coherence-warning': 1,
  'recovery-checkin-strain': 2,
  'recovery-checkin-missing': 2,
  'weekly-adherence-drop': 3,
  'acwr-undertrained-running': 4,
  'acwr-undertrained-squash': 4,
  'acwr-undertrained-strength': 4,
  'acwr-undertrained-cycling': 4,
}

export function buildAutoAdjustmentDraft(input: AutoAdjustmentInput): AutoAdjustmentDraft | null {
  const alerts = [...(input.activeAlerts ?? buildActionAlerts(input))].sort(compareAdjustmentAlerts)
  const slotProfile = input.slotAdherenceProfile ?? buildSlotAdherenceProfile(input.historicalSessions ?? [], input.today ?? toISO(new Date()))

  for (const alert of alerts) {
    const draft = buildDraftFromAlert(alert, input, slotProfile, alerts)
    if (draft) return {
      ...draft,
      actions: draft.actions.slice(0, 3),
    }
  }

  return null
}

function compareAdjustmentAlerts(a: ActionableAlert, b: ActionableAlert): number {
  const aPriority = AUTO_ADJUSTMENT_PRIORITY[a.id] ?? 99
  const bPriority = AUTO_ADJUSTMENT_PRIORITY[b.id] ?? 99
  if (aPriority !== bPriority) return aPriority - bPriority
  return a.title.localeCompare(b.title)
}

function buildDraftFromAlert(
  alert: ActionableAlert,
  input: AutoAdjustmentInput,
  slotProfile: SlotAdherenceProfile,
  alerts: ActionableAlert[],
): AutoAdjustmentDraft | null {
  switch (alert.id) {
    case 'macro-week-coherence-warning':
      return buildCoherenceDraft(alert, input, slotProfile)
    case 'weekly-adherence-drop':
      return buildAdherenceDraft(alert, input, slotProfile)
    case 'recovery-checkin-strain':
    case 'recovery-checkin-missing':
      return buildRecoveryDraft(alert, input, slotProfile)
    default:
      if (alert.id.startsWith('acwr-risk-')) {
        return buildLoadRiskDraft(alert, input, slotProfile, alerts)
      }
      if (alert.id.startsWith('acwr-undertrained-')) {
        return buildUndertrainedDraft(alert, input, alerts)
      }
      return null
  }
}

function buildCoherenceDraft(
  alert: ActionableAlert,
  input: AutoAdjustmentInput,
  slotProfile: SlotAdherenceProfile,
): AutoAdjustmentDraft | null {
  const coherence = input.macroWeekCoherence
  if (!coherence) return null

  const supportCandidate = pickSupportReductionCandidate(input.sessions, coherence, input.today, slotProfile, input.athleteProfile)
  if (!supportCandidate) return null

  const actions: CoachAction[] = []
  const moveTargetDate = findBetterMoveTarget(supportCandidate, input.sessions, slotProfile)
  if (moveTargetDate) {
    actions.push({
      type: 'move_session',
      sessionId: supportCandidate.id,
      targetDate: moveTargetDate,
      reason: `Mover ${supportCandidate.title} a un slot mas cumplible y con menos interferencia para respetar mejor la regla del bloque.`,
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

  const mobilityTargetDate = shouldAddMobilitySupport(coherence.currentPhase)
    ? findRecoveryInsertDate(supportCandidate, input.sessions)
    : null
  if (mobilityTargetDate) {
    actions.push(buildMobilitySupportAction({
      targetDate: mobilityTargetDate,
      reason: `Agregar movilidad de soporte para sostener frescura y coherencia con la fase ${coherence.currentPhase}.`,
      sourceSession: supportCandidate,
      intentLabel: 'movilidad de soporte del bloque',
    }))
  }

  return {
    alertId: alert.id,
    title: 'Ajuste automatico por incoherencia semanal',
    message: `Detecte una incoherencia con el bloque actual. Prepare un ajuste rapido para bajar carga accesoria${moveTargetDate ? ' y moverla a un slot mas realista' : ''}.`,
    actions,
  }
}

function buildLoadRiskDraft(
  alert: ActionableAlert,
  input: AutoAdjustmentInput,
  slotProfile: SlotAdherenceProfile,
  alerts: ActionableAlert[],
): AutoAdjustmentDraft | null {
  const sport = extractSportFromAlertId(alert.id)
  if (!sport) return null

  const candidate = pickLoadRiskCandidate(input.sessions, sport, input.today, slotProfile, input.athleteProfile)
  if (!candidate) return null

  const actions: CoachAction[] = [
    {
      type: 'update_session',
      sessionId: candidate.id,
      newDurationMin: reduceDuration(candidate.durationMin, 0.7),
      newRpe: reduceRpe(candidate.rpe, 2),
      cyclingDetails: candidate.type === 'cycling' ? buildFallbackCyclingDetails(candidate, candidate) : undefined,
      mobilityDetails: candidate.type === 'mobility' ? buildFallbackMobilityDetails(candidate, candidate) : undefined,
      reason: `Reducir la proxima carga de ${candidate.title} para bajar riesgo ACWR sin desordenar la semana.`,
    },
  ]

  const moveTargetDate = shouldMoveForLoadRisk(candidate, slotProfile)
    ? findBetterMoveTarget(candidate, input.sessions, slotProfile)
    : null
  if (moveTargetDate) {
    actions.unshift({
      type: 'move_session',
      sessionId: candidate.id,
      targetDate: moveTargetDate,
      reason: `Mover ${candidate.title} a un slot mas cumplible para bajar friccion y evitar acumular fatiga en un dia ya cargado.`,
    })
  }

  const allowSupportInsert = !hasHighPriorityBlocker(alerts)
  const recoveryTargetDate = allowSupportInsert ? findRecoveryInsertDate(candidate, input.sessions) : null
  if (recoveryTargetDate) {
    actions.push(
      candidate.type === 'cycling'
        ? buildMobilitySupportAction({
            targetDate: recoveryTargetDate,
            reason: 'Insertar movilidad post-cycling para amortiguar la fatiga despues del ajuste de carga.',
            sourceSession: candidate,
            intentLabel: 'movilidad post-cycling',
          })
        : {
            type: 'insert_recovery',
            targetDate: recoveryTargetDate,
            reason: `Insertar recuperacion activa para amortiguar la fatiga despues del ajuste en ${getSportLabel(sport)}.`,
          },
    )
  }

  return {
    alertId: alert.id,
    title: `Ajuste automatico por riesgo de carga en ${getSportLabel(sport)}`,
    message: `Detecte riesgo de carga en ${getSportLabel(sport)}. Prepare una version mas conservadora de la siguiente sesion${moveTargetDate ? ' y la movi a un slot con mejor probabilidad de cumplimiento' : ''}${recoveryTargetDate ? ', ademas de una recuperacion de soporte' : ''}.`,
    actions,
  }
}

function buildAdherenceDraft(
  alert: ActionableAlert,
  input: AutoAdjustmentInput,
  slotProfile: SlotAdherenceProfile,
): AutoAdjustmentDraft | null {
  const candidate = pickAdherenceCandidate(input.sessions, input.currentWeekSummary, input.today, slotProfile, input.athleteProfile)
  if (!candidate) return null

  const actions: CoachAction[] = []
  const moveTargetDate = findBetterMoveTarget(candidate, input.sessions, slotProfile)
  if (moveTargetDate) {
    actions.push({
      type: 'move_session',
      sessionId: candidate.id,
      targetDate: moveTargetDate,
      reason: `Mover ${candidate.title} a un slot que historicamente completas mejor para subir la probabilidad real de adherencia.`,
    })
  }

  actions.push({
    type: 'update_session',
    sessionId: candidate.id,
    newDurationMin: reduceDuration(candidate.durationMin, 0.7),
    newRpe: reduceRpe(candidate.rpe),
    cyclingDetails: candidate.type === 'cycling' ? buildFallbackCyclingDetails(candidate, candidate) : undefined,
    mobilityDetails: candidate.type === 'mobility' ? buildFallbackMobilityDetails(candidate, candidate) : undefined,
    reason: `Simplificar ${candidate.title} para recuperar adherencia y evitar seguir acumulando sesiones poco realistas.`,
  })

  return {
    alertId: alert.id,
    title: 'Ajuste automatico por baja adherencia',
    message: `La adherencia semanal viene baja. Prepare un ajuste mas realista sobre ${candidate.title}${moveTargetDate ? ' y la movi a un dia con mejor historial de cumplimiento' : ''}.`,
    actions,
  }
}

function buildRecoveryDraft(
  alert: ActionableAlert,
  input: AutoAdjustmentInput,
  slotProfile: SlotAdherenceProfile,
): AutoAdjustmentDraft | null {
  const candidate = pickRecoveryCandidate(input.sessions, input.today, input.athleteProfile)
  if (!candidate) return null

  const actions: CoachAction[] = []
  const strained = alert.id === 'recovery-checkin-strain' || isRecoverySignalPoor(input)
  const moveTargetDate = strained ? findBetterMoveTarget(candidate, input.sessions, slotProfile) : null

  if (moveTargetDate) {
    actions.push({
      type: 'move_session',
      sessionId: candidate.id,
      targetDate: moveTargetDate,
      reason: `Mover ${candidate.title} para dejar mas aire entre la fatiga de hoy y la siguiente carga.`,
    })
  }

  actions.push({
    type: 'update_session',
    sessionId: candidate.id,
    newDurationMin: reduceDuration(candidate.durationMin, strained ? 0.65 : 0.75),
    newRpe: reduceRpe(candidate.rpe, strained ? 2 : 1),
    cyclingDetails: candidate.type === 'cycling' ? buildFallbackCyclingDetails(candidate, candidate) : undefined,
    mobilityDetails: candidate.type === 'mobility' ? buildFallbackMobilityDetails(candidate, candidate) : undefined,
    reason: strained
      ? `Bajar la siguiente carga porque las sensaciones de hoy no justifican mantener la intensidad original.`
      : `Recortar la siguiente carga hasta cerrar mejor el contexto de recuperacion del dia.`,
  })

  const recoveryTargetDate = strained ? findRecoveryInsertDate(candidate, input.sessions) : null
  if (recoveryTargetDate) {
    actions.push({
      type: 'insert_recovery',
      targetDate: recoveryTargetDate,
      reason: 'Insertar un bloque corto de recuperacion activa para amortiguar la carga mientras se normalizan las sensaciones.',
    })
  }

  return {
    alertId: alert.id,
    title: 'Ajuste automatico por recuperacion pendiente',
    message: strained
      ? `Detecte una señal de recuperacion pobre. Prepare un ajuste mas conservador para la siguiente carga${moveTargetDate ? ' y la movi a un momento con menos friccion' : ''}.`
      : 'Todavia falta cerrar bien el contexto del dia. Prepare un ajuste leve para no seguir cargando a ciegas.',
    actions,
  }
}

function buildUndertrainedDraft(
  alert: ActionableAlert,
  input: AutoAdjustmentInput,
  alerts: ActionableAlert[],
): AutoAdjustmentDraft | null {
  const sport = extractSportFromAlertId(alert.id)
  if (!sport || hasHighPriorityBlocker(alerts) || isRecoverySignalPoor(input)) return null

  const existingCandidate = pickUpcomingSportCandidate(input.sessions, sport, input.today)
  if (existingCandidate) {
    return {
      alertId: alert.id,
      title: `Ajuste automatico por carga baja en ${getSportLabel(sport)}`,
      message: `La carga de ${getSportLabel(sport)} quedo por debajo de tu base reciente. Prepare una progresion chica sobre la siguiente sesion util para no perder continuidad.`,
      actions: [{
        type: 'update_session',
        sessionId: existingCandidate.id,
        newDurationMin: increaseDuration(existingCandidate.durationMin, 1.15),
        newRpe: increaseRpe(existingCandidate.rpe),
        cyclingDetails: existingCandidate.type === 'cycling' ? buildFallbackCyclingDetails(existingCandidate, existingCandidate) : undefined,
        mobilityDetails: existingCandidate.type === 'mobility' ? buildFallbackMobilityDetails(existingCandidate, existingCandidate) : undefined,
        reason: `Subir un poco la proxima sesion de ${getSportLabel(sport)} para recuperar continuidad sin romper la semana.`,
      }],
    }
  }

  const addAction = buildUndertrainedSupportAction(sport, input)
  if (!addAction) return null

  return {
    alertId: alert.id,
    title: `Ajuste automatico por carga baja en ${getSportLabel(sport)}`,
    message: `La carga de ${getSportLabel(sport)} quedo corta esta semana. Agregue una sesion util y controlada para sostener continuidad sin disparar fatiga.`,
    actions: [addAction],
  }
}

function pickSupportReductionCandidate(
  sessions: Session[],
  coherence: MacroWeekCoherenceSummary,
  today: string | undefined,
  slotProfile: SlotAdherenceProfile,
  athleteProfile?: AthleteProfile | null,
): Session | null {
  const futurePlanned = getFuturePlannedSessions(sessions, today)
  const sorted = [...futurePlanned].sort((a, b) =>
    supportPenalty(b, coherence, slotProfile, athleteProfile) - supportPenalty(a, coherence, slotProfile, athleteProfile),
  )
  return sorted.find((session) => supportPenalty(session, coherence, slotProfile, athleteProfile) > 0) ?? null
}

function pickLoadRiskCandidate(
  sessions: Session[],
  sport: DraftableSport,
  today: string | undefined,
  slotProfile: SlotAdherenceProfile,
  athleteProfile?: AthleteProfile | null,
): Session | null {
  const futurePlanned = getFuturePlannedSessions(sessions, today)
    .filter((session) => session.type === sport)
    .sort((a, b) => loadRiskPenalty(b, slotProfile, athleteProfile) - loadRiskPenalty(a, slotProfile, athleteProfile))
  return futurePlanned[0] ?? null
}

function pickAdherenceCandidate(
  sessions: Session[],
  summary: WeekSummary | null | undefined,
  today: string | undefined,
  slotProfile: SlotAdherenceProfile,
  athleteProfile?: AthleteProfile | null,
): Session | null {
  if (!summary || summary.plannedSessions < 3) return null
  const futurePlanned = getFuturePlannedSessions(sessions, today)
  const sorted = [...futurePlanned].sort((a, b) =>
    adherencePenalty(b, slotProfile, athleteProfile) - adherencePenalty(a, slotProfile, athleteProfile),
  )
  return sorted[0] ?? null
}

function pickRecoveryCandidate(
  sessions: Session[],
  today: string | undefined,
  athleteProfile?: AthleteProfile | null,
): Session | null {
  const futurePlanned = getFuturePlannedSessions(sessions, today)
  const sorted = [...futurePlanned].sort((a, b) =>
    recoveryPenalty(b, athleteProfile) - recoveryPenalty(a, athleteProfile),
  )
  return sorted[0] ?? null
}

function pickUpcomingSportCandidate(
  sessions: Session[],
  sport: DraftableSport,
  today: string | undefined,
): Session | null {
  return getFuturePlannedSessions(sessions, today)
    .filter((session) => session.type === sport)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0] ?? null
}

function getFuturePlannedSessions(sessions: Session[], today?: string): Session[] {
  const reference = today ?? toISO(new Date())
  return sessions.filter((session) => session.status === 'planned' && session.date >= reference)
}

function supportPenalty(
  session: Session,
  coherence: MacroWeekCoherenceSummary,
  slotProfile: SlotAdherenceProfile,
  athleteProfile?: AthleteProfile | null,
): number {
  const sport = toSupportedSport(session)
  const role = sport ? coherence.targetDistributionBySport[sport] : undefined
  let penalty = candidateLoadScore(session)
  if (role === 'excluded') penalty += 120
  if (role === 'support') penalty += 60
  if (session.type === 'strength' || session.type === 'cycling') penalty += 12
  if (session.type === 'mobility') penalty -= 30
  penalty += slotRiskPenalty(session, slotProfile)
  penalty -= keySessionProtection(session, athleteProfile)
  return penalty
}

function adherencePenalty(
  session: Session,
  slotProfile: SlotAdherenceProfile,
  athleteProfile?: AthleteProfile | null,
): number {
  let penalty = candidateLoadScore(session)
  penalty += slotRiskPenalty(session, slotProfile) * 2
  if (session.type === 'mobility' || session.type === 'recovery') penalty -= 25
  if (session.type === 'strength' || session.type === 'cycling') penalty += 10
  penalty -= keySessionProtection(session, athleteProfile)
  return penalty
}

function loadRiskPenalty(
  session: Session,
  slotProfile: SlotAdherenceProfile,
  athleteProfile?: AthleteProfile | null,
): number {
  let penalty = candidateLoadScore(session)
  penalty += slotRiskPenalty(session, slotProfile)
  if (isLikelyKeySession(session, athleteProfile)) penalty -= 25
  return penalty
}

function recoveryPenalty(session: Session, athleteProfile?: AthleteProfile | null): number {
  let penalty = candidateLoadScore(session)
  if (session.type === 'strength' || session.type === 'cycling') penalty += 18
  if (session.type === 'mobility' || session.type === 'recovery') penalty -= 30
  if (session.date === toISO(addDays(fromISO(session.date), 0))) penalty += 0
  penalty -= keySessionProtection(session, athleteProfile)
  return penalty
}

function keySessionProtection(session: Session, athleteProfile?: AthleteProfile | null): number {
  const primarySport = getPlanningPrimarySport(athleteProfile)
  let protection = 0
  if (primarySport && session.type === primarySport) protection += 18
  if (isLikelyKeySession(session, athleteProfile)) protection += 20
  return protection
}

function slotRiskPenalty(session: Session, slotProfile: SlotAdherenceProfile): number {
  const stats = getSlotAdherenceStats(slotProfile, session.date, session.timeBlock)
  if (!stats || stats.plannedCount < 2) return 0
  return Math.max(0, 80 - stats.adherencePct) / 4
}

function isLikelyKeySession(session: Session, athleteProfile?: AthleteProfile | null): boolean {
  const primarySport = getPlanningPrimarySport(athleteProfile)
  const title = session.title.toLowerCase()

  if (session.type === 'squash') {
    if (session.subtype === 'match' || session.squashDetails?.sessionMode === 'competition_match') return true
  }
  if (session.type === 'running') {
    if (session.runningDetails?.runningType === 'tempo' || session.runningDetails?.runningType === 'intervals' || session.runningDetails?.runningType === 'long') return true
  }
  if (primarySport && session.type === primarySport && /(objetivo|competencia|match|series|tempo|principal|calidad)/.test(title)) {
    return true
  }

  return /(match|competencia|tempo|series|objetivo|principal|larga)/.test(title)
}

function candidateLoadScore(session: Session): number {
  return session.durationMin + ((session.rpe ?? 6) * 8)
}

function findBetterMoveTarget(
  session: Session,
  sessions: Session[],
  slotProfile: SlotAdherenceProfile,
): string | null {
  const weekStart = session.weekStartDate ?? toISO(getWeekStart(fromISO(session.date)))
  const weekEnd = addDays(fromISO(weekStart), 6)
  const currentDayLoad = sessions.filter((item) => item.date === session.date && item.id !== session.id).length
  let cursor = addDays(fromISO(session.date), 1)
  const candidates: Array<{ dateISO: string; adherencePct: number; dayLoad: number }> = []

  while (cursor <= weekEnd) {
    const dateISO = toISO(cursor)
    const collision = sessions.some((item) => item.id !== session.id && item.date === dateISO && item.timeBlock === session.timeBlock)
    const dayLoad = sessions.filter((item) => item.date === dateISO && item.id !== session.id).length
    if (!collision && dayLoad <= currentDayLoad) {
      candidates.push({
        dateISO,
        adherencePct: getSlotAdherenceStats(slotProfile, dateISO, session.timeBlock)?.adherencePct ?? 50,
        dayLoad,
      })
    }
    cursor = addDays(cursor, 1)
  }

  candidates.sort((a, b) =>
    b.adherencePct - a.adherencePct ||
    a.dayLoad - b.dayLoad ||
    a.dateISO.localeCompare(b.dateISO),
  )

  return candidates[0]?.dateISO ?? null
}

function findRecoveryInsertDate(session: Session, sessions: Session[]): string | null {
  const weekStart = session.weekStartDate ?? toISO(getWeekStart(fromISO(session.date)))
  const weekEnd = addDays(fromISO(weekStart), 6)
  let cursor = addDays(fromISO(session.date), 1)

  while (cursor <= weekEnd) {
    const dateISO = toISO(cursor)
    const hasRecovery = sessions.some((item) => item.date === dateISO && (item.type === 'recovery' || item.type === 'mobility'))
    const sessionCount = sessions.filter((item) => item.date === dateISO).length
    if (!hasRecovery && sessionCount <= 1) return dateISO
    cursor = addDays(cursor, 1)
  }

  return null
}

function reduceDuration(durationMin: number, factor: number): number {
  return Math.max(20, Math.round((durationMin * factor) / 5) * 5)
}

function increaseDuration(durationMin: number, factor: number): number {
  return Math.max(durationMin + 5, Math.round((durationMin * factor) / 5) * 5)
}

function reduceRpe(rpe?: number, delta = 1): number {
  return Math.max(3, (rpe ?? 6) - delta)
}

function increaseRpe(rpe?: number, delta = 1): number {
  return Math.min(8, (rpe ?? 5) + delta)
}

function shouldAddMobilitySupport(phase: MacroWeekCoherenceSummary['currentPhase']): boolean {
  return ['peak', 'taper', 'race', 'transition'].includes(phase)
}

function shouldMoveForLoadRisk(session: Session, slotProfile: SlotAdherenceProfile): boolean {
  const stats = getSlotAdherenceStats(slotProfile, session.date, session.timeBlock)
  return Boolean(stats && stats.plannedCount >= 2 && stats.adherencePct < 60)
}

function hasHighPriorityBlocker(alerts: ActionableAlert[]): boolean {
  return alerts.some((alert) =>
    alert.id === 'macro-week-coherence-warning' ||
    alert.id === 'recovery-checkin-strain' ||
    alert.id === 'recovery-checkin-missing',
  )
}

function isRecoverySignalPoor(input: AutoAdjustmentInput): boolean {
  const dayLog = input.todayDayLog
  if (!dayLog) return false
  return (
    (dayLog.energyLevel != null && dayLog.energyLevel <= 3) ||
    (dayLog.sleepQuality != null && dayLog.sleepQuality <= 2) ||
    (dayLog.rpeActual != null && dayLog.rpeActual >= 8) ||
    (dayLog.painLevel != null && dayLog.painLevel >= 6)
  )
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

function extractSportFromAlertId(alertId: string): DraftableSport | null {
  if (alertId.endsWith('running')) return 'running'
  if (alertId.endsWith('squash')) return 'squash'
  if (alertId.endsWith('strength')) return 'strength'
  if (alertId.endsWith('cycling')) return 'cycling'
  return null
}

function buildUndertrainedSupportAction(
  sport: DraftableSport,
  input: AutoAdjustmentInput,
): CoachAction | null {
  const targetDate = findUndertrainedInsertDate(input.sessions, input.today)
  if (!targetDate) return null

  switch (sport) {
    case 'running':
      return {
        type: 'add_session',
        targetDate,
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Rodaje Z2 de soporte',
        durationMin: 35,
        rpe: 5,
        objective: 'Recuperar continuidad aerobica sin fatiga alta.',
        reason: 'Agregar una dosis controlada de running para recuperar continuidad sin romper la semana.',
      }
    case 'strength':
      return {
        type: 'add_session',
        targetDate,
        timeBlock: 'PM',
        sessionType: 'strength',
        title: 'Fuerza soporte controlada',
        durationMin: 40,
        rpe: 5,
        objective: 'Recuperar estimulo de fuerza util con fatiga controlada.',
        reason: 'Agregar una sesion corta de fuerza para recuperar continuidad sin sobrecargar la semana.',
      }
    case 'cycling':
      return {
        type: 'add_session',
        targetDate,
        timeBlock: 'AM',
        sessionType: 'cycling',
        title: 'Cycling Z2 de soporte',
        rpe: 5,
        objective: 'Recuperar continuidad aerobica en bici sin elevar demasiado la carga.',
        cyclingDetails: buildFallbackCyclingDetails({
          title: 'Cycling Z2 de soporte',
          objective: 'Recuperar continuidad aerobica en bici sin elevar demasiado la carga.',
          runningType: 'z2',
        }),
        reason: 'Agregar una sesion de cycling util y controlada para recuperar continuidad.',
      }
    case 'squash':
      return {
        type: 'add_session',
        targetDate,
        timeBlock: 'PM',
        sessionType: 'squash',
        title: 'Squash tecnico de soporte',
        durationMin: 40,
        rpe: 5,
        subtype: 'training',
        squashDetails: buildUndertrainedSquashDetails(),
        objective: 'Recuperar continuidad de squash con bajo costo de fatiga.',
        reason: 'Agregar una sesion tecnica de squash para recuperar continuidad sin disparar la fatiga.',
      }
    default:
      return null
  }
}

function buildUndertrainedSquashDetails(): SquashDetails {
  return {
    trainingFocus: 'technical',
    sessionMode: 'drill_session',
    drills: [
      { name: 'Control de T y salida corta', durationMin: 12 },
      { name: 'Patrones de drive con ritmo controlado', durationMin: 15 },
      { name: 'Cierre tecnico sin fatiga', durationMin: 10 },
    ],
  }
}

function findUndertrainedInsertDate(sessions: Session[], today?: string): string | null {
  const reference = today ?? toISO(new Date())
  const future = getFuturePlannedSessions(sessions, reference)
  const anchor = future[0] ?? null
  if (!anchor) return null

  const weekStart = anchor.weekStartDate ?? toISO(getWeekStart(fromISO(anchor.date)))
  const weekEnd = addDays(fromISO(weekStart), 6)
  let cursor = fromISO(reference)

  while (cursor <= weekEnd) {
    const dateISO = toISO(cursor)
    const sessionCount = sessions.filter((item) => item.date === dateISO).length
    if (dateISO >= reference && sessionCount === 0) return dateISO
    cursor = addDays(cursor, 1)
  }

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
