import type { ChatContext, CoachAction, CoachExerciseProposal, CoachSessionProposal, Session, SessionType, SquashSessionBlockKind, TimeBlock } from '../../types'
import type { StrengthConstraint } from '../../types/strengthSafety'
import { currentWeekStartISO, todayISO } from '../../utils/date'
import { toStrengthProposalForEnhancement } from '../training/strengthExerciseProposal'
import { selectStrengthSession, type StrengthContext, type StrengthPhase, type StrengthSportProfile } from '../training/strengthSelector'
import { prepareStrengthSession, type BlockedReason, type RemovedExercise, type ReplacedExercise } from '../training/strengthSafetyFinalizer'
import { resolveStrengthSafetyConstraints } from '../training/strengthSafetyConstraints'
import { BLOCKED_STRENGTH_COPY } from '../training/strengthSafetyCopy'
import { detectSupersetIntent, shouldApplySupersetPolicy, type SupersetPolicyMode } from '../training/supersetPolicy'
import { findSquashDrillByName, normalizeSquashDrillKey, resolveSquashDrillKind } from '../training/drillLibrary'
import {
  hydrateSquashSession,
  isSquashDrillKindCompatible,
  projectSquashSubtype,
} from '../training/squashSessionHydrator'
import type { CoachNormalizedResponse } from './types'

const WEEKDAYS = [
  { offset: 0, labels: ['lunes'] },
  { offset: 1, labels: ['martes'] },
  { offset: 2, labels: ['miercoles'] },
  { offset: 3, labels: ['jueves'] },
  { offset: 4, labels: ['viernes'] },
  { offset: 5, labels: ['sabado'] },
  { offset: 6, labels: ['domingo'] },
] as const

const NEXT_WEEK_PATTERN = /\b(proxima\s+semana|siguiente\s+semana)\b/
const CURRENT_WEEK_PATTERN = /\b(esta\s+semana|semana\s+actual)\b/
const FREE_DAY_TARGET_PATTERN = /\b(?:dia|dias)\b.{0,32}\b(?:libre|libres|sin\s+entrenamiento)\b|\b(?:libre|libres)\b.{0,32}\b(?:dia|dias)\b/
const WEEKDAY_REFERENCE_PATTERN = /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/
const SESSION_TARGET_PATTERN = /\b(sesion|sesiones|entreno|entrenamiento|fuerza|pesas|gym|gimnasio|strength|running|correr|corrida|trote|squash|cycling|ciclismo|bici|bicicleta|movilidad|mobility|recovery|recuperacion)\b/
const CREATE_SESSION_INTENT_PATTERN = /\b(crea(?:r|me)?|crear|genera(?:r|me)?|generar|haz(?:me)?|hacer|arma(?:me)?|programa(?:me)?|agenda(?:me)?|agrega(?:me)?|agregar|pon(?:me)?|poner|dame|entrega(?:me)?|realiza(?:r)?|deja|incorpora)\b/
const ACTION_VERB_PATTERN = /\b(ajusta(?:r|me)?|cambia(?:r|me)?|modifica(?:r|me)?|mueve(?:me)?|mover|pasa(?:r|me)?|reprograma(?:r|me)?|reordena(?:r|me)?|actualiza(?:r|me)?|quit(?:a|ar|ame)|borra(?:r|me)?|elimina(?:r|me)?|saca(?:r|me)?|pon(?:er|me)?|agrega(?:r|me)?|reemplaza(?:r|me)?|reduce|baja|sube|incorpora|programa(?:me)?|agenda(?:me)?)\b/
const MOVE_SESSION_INTENT_PATTERN = /\b(mueve(?:me)?|mover|pasa(?:r|me)?|reprograma(?:r|me)?|reordena(?:r|me)?)\b/
const ZONE_2_PATTERN = /\b(z2|zona\s*2|zona\s+dos|aerobico|aerobica)\b/
// Reexportado para no romper los consumidores que ya lo importaban desde acá.
export { BLOCKED_STRENGTH_COPY }

export function postProcessCoachActions(
  response: CoachNormalizedResponse,
  context: ChatContext,
  userMessage: string,
): CoachNormalizedResponse {
  if (response.requestClass !== 'chat_action') return response

  const normalizedMessage = normalizeText(userMessage)
  const profile = context.athleteProfile
  const safetyConstraints = resolveStrengthSafetyConstraints({
    currentInjuries: profile?.recoveryProfile?.currentInjuries,
    restrictions: profile?.recoveryProfile?.restrictions,
    injuryNotes: profile?.planWizardConfig?.injuryNotes,
    userMessages: [
      ...(context.recentMessages ?? [])
        .filter((message) => message.role === 'user')
        .slice(-8)
        .map((message) => message.content),
      userMessage,
    ],
    trainingPriority: profile?.sportContext?.trainingPriority,
  })
  const userMessageConstraints = resolveStrengthSafetyConstraints({
    userMessages: [userMessage],
  })
  const hasMultipleTemporalTargets = hasMultipleExplicitTemporalTargets(normalizedMessage)
  const inheritsRecentActionContext = shouldInheritRecentActionContext(normalizedMessage, context)
  const actionIntentText = inheritsRecentActionContext
    ? buildRecentActionIntentText(normalizedMessage, context)
    : normalizedMessage
  const requestedWeekStart = resolveRequestedWeekStart(actionIntentText, context)
  const requiresEntireFreeDay = FREE_DAY_TARGET_PATTERN.test(actionIntentText)
  const restOffsets = resolveRestWeekdayOffsets(actionIntentText)
  const contextualFollowUpDate = inheritsRecentActionContext
    ? resolveRecentDateForRequestedSession(normalizedMessage, context, requestedWeekStart, restOffsets)
    : undefined
  const explicitSessionDayTargetCount =
    contextualFollowUpDate && !WEEKDAY_REFERENCE_PATTERN.test(normalizedMessage)
      ? 1
      : countActionableWeekdayTargets(actionIntentText, restOffsets)
  const candidateResolvedDate =
    resolveRelativeDate(normalizedMessage) ??
    resolveRelativeDate(actionIntentText) ??
    resolveWeekdayDate(normalizedMessage, context, requestedWeekStart, restOffsets) ??
    contextualFollowUpDate ??
    resolveWeekdayDate(actionIntentText, context, requestedWeekStart, restOffsets)
  const resolvedDate =
    explicitSessionDayTargetCount > 1 || hasMultipleTemporalTargets ? undefined : candidateResolvedDate
  const affectedSession =
    findAffectedSession(context, normalizedMessage, resolvedDate) ??
    findAffectedSession(context, actionIntentText, resolvedDate)
  const adjustmentIntent =
    isExistingSessionAdjustment(normalizedMessage) ||
    isExistingSessionAdjustment(actionIntentText) ||
    isActionConfirmationFollowUp(normalizedMessage)
  const sessions = getContextSessions(context)
  const alignmentWeekStart = requestedWeekStart ?? (resolvedDate ? getWeekStartISO(resolvedDate) : undefined)
  const occupiedSlots = buildOccupiedSlotSet(sessions, alignmentWeekStart)
  const requestedSessionActions =
    (isCreationConfirmationFollowUp(normalizedMessage) && inheritsRecentActionContext
      ? buildFallbackRequestedSessionActions(actionIntentText, context, requestedWeekStart, restOffsets)
      : undefined) ??
    buildFallbackRequestedSessionActions(normalizedMessage, context, requestedWeekStart, restOffsets) ??
    (inheritsRecentActionContext
      ? undefined
      : buildFallbackRequestedSessionActions(actionIntentText, context, requestedWeekStart, restOffsets))
  const requestedMoveActions =
    buildRequestedMoveSessionActions(normalizedMessage, context, requestedWeekStart) ??
    (inheritsRecentActionContext
      ? undefined
      : buildRequestedMoveSessionActions(actionIntentText, context, requestedWeekStart))
  const fallbackActions =
    requestedSessionActions ??
    buildFallbackSingleSessionActions(normalizedMessage, context, resolvedDate, { allowResolvedDateOnly: inheritsRecentActionContext }) ??
    (inheritsRecentActionContext
      ? undefined
      : buildFallbackSingleSessionActions(actionIntentText, context, resolvedDate))
  const runningReplacement = buildRunningZone2ReplacementAction(actionIntentText, affectedSession)
  const repairedReplacementAction = runningReplacement &&
    shouldForceRunningReplacement(response.actions ?? fallbackActions, affectedSession)
    ? runningReplacement
    : undefined
  const baseSourceActions: CoachAction[] | undefined = repairedReplacementAction
    ? [repairedReplacementAction]
    : (response.actions ?? fallbackActions)
  const moveReconciledActions = repairedReplacementAction
    ? baseSourceActions
    : reconcileRequestedMoveActions(baseSourceActions, requestedMoveActions)
  const sourceActions = repairedReplacementAction
    ? moveReconciledActions
    : mergeMissingRequestedSessionActions(moveReconciledActions, requestedSessionActions)
  const repairedRequestedMoves = Boolean(
    requestedMoveActions?.length &&
    !moveActionsMatch(baseSourceActions, requestedMoveActions),
  )
  const repairedMissingRequestedActions = Boolean(
    baseSourceActions &&
    sourceActions &&
    sourceActions.length > baseSourceActions.length,
  )
  if (!sourceActions?.length) return response

  const squashActionWarnings: SquashActionWarning[] = []
  let hydratedMissingStrengthExercises = false
  const alignedActions = sourceActions.map((action) => {
    const dateAligned = resolvedDate ? alignActionDate(action, resolvedDate) : action
    const weekAligned = alignmentWeekStart
      ? alignActionToRequestedWeek(dateAligned, alignmentWeekStart, restOffsets, occupiedSlots, {
          lockDate: Boolean(resolvedDate),
          requireEntireFreeDay: requiresEntireFreeDay,
        })
      : dateAligned
    const requestAligned = alignSingleSessionSportToRequest(weekAligned, normalizedMessage, context)
    const runningAligned = completeRunningZone2Details(requestAligned, actionIntentText)
    if (hasMissingStrengthExercises(runningAligned)) hydratedMissingStrengthExercises = true
    const loadAligned = completeStrengthLoads(
      runningAligned,
      context,
      actionIntentText,
      safetyConstraints,
    )
    const targetSession = loadAligned.type === 'update_session'
      ? findSessionByIdOrPrefix(loadAligned.sessionId, sessions) ?? affectedSession
      : affectedSession
    const squashAligned = completeSquashAction(
      loadAligned,
      context,
      targetSession,
      userMessage,
    )
    squashActionWarnings.push(...squashAligned.warnings)

    if (squashAligned.action.type === 'add_session' && adjustmentIntent && affectedSession) {
      return convertAddSessionToUpdateSession(squashAligned.action, affectedSession)
    }

    const sessionActionsWithId = [
      'update_session',
      'delete_session',
      'skip_session',
      'change_rpe',
      'shorten_session',
      'lengthen_session',
      'move_session',
      'replace_session_type'
    ]
    if (
      sessionActionsWithId.includes(squashAligned.action.type) &&
      affectedSession &&
      !resolvesKnownSession(squashAligned.action.sessionId, sessions)
    ) {
      return { ...squashAligned.action, sessionId: affectedSession.id }
    }

    return squashAligned.action
  })
  const safetyResult = finalizeStrengthActions(alignedActions, {
    context,
    sessions,
    actionIntentText,
    normalizedUserMessage: normalizedMessage,
    constraints: safetyConstraints,
    userMessageConstraints,
  })
  const { actions, removedCollidingAddSessionCount } = removeCollidingAddSessionActions(
    safetyResult.actions,
    sessions,
  )
  // Un bloqueo TOTAL es una respuesta segura sin propuesta y su copy es todo el
  // mensaje. Un bloqueo PARCIAL sí deja propuesta en pantalla: reemplazar el
  // mensaje ahí decía "no pude verificar…" junto a una tarjeta de acción viva.
  const fullyBlocked = safetyResult.blockedReasons.length > 0 && actions.length === 0
  const partiallyBlocked = safetyResult.blockedReasons.length > 0 && actions.length > 0
  const baseMessage = fullyBlocked
    ? BLOCKED_STRENGTH_COPY
    : repairedReplacementAction
    ? buildRunningReplacementMessage(repairedReplacementAction)
    : response.actions?.length && !repairedMissingRequestedActions
      && !repairedRequestedMoves
      ? response.message
      : buildFallbackActionMessage(actions, response.message)
  const messageWithSafetyNotice = partiallyBlocked
    ? `${baseMessage}\n\n${BLOCKED_STRENGTH_COPY}`
    : baseMessage
  const actionMessage = removedCollidingAddSessionCount > 0
    ? `${messageWithSafetyNotice}\n\nNo agregué ${removedCollidingAddSessionCount === 1 ? 'una sesión' : `${removedCollidingAddSessionCount} sesiones`} porque el bloque ya estaba ocupado.`
    : messageWithSafetyNotice
  const userFacingSquashWarnings = [...new Set(
    squashActionWarnings.filter((warning) => warning.userFacing).map((warning) => warning.message),
  )]
  const messageWithWarnings = userFacingSquashWarnings.length > 0
    ? `${actionMessage}\n\n${userFacingSquashWarnings.join('\n')}`
    : actionMessage
  const message = alignMessageWeekdayToActionDate(messageWithWarnings, actions)
  const correctedMessageWeekday = message !== messageWithWarnings

  return {
    ...response,
    actions,
    message,
    fallbackUsed: response.fallbackUsed || !response.actions?.length || Boolean(repairedReplacementAction) || repairedMissingRequestedActions || repairedRequestedMoves || removedCollidingAddSessionCount > 0 || hydratedMissingStrengthExercises || correctedMessageWeekday || safetyResult.blockedReasons.length > 0 || safetyResult.repaired,
    meta: response.actions?.length && !repairedReplacementAction && !repairedMissingRequestedActions && !repairedRequestedMoves && removedCollidingAddSessionCount === 0 && squashActionWarnings.length === 0 && !hydratedMissingStrengthExercises && !correctedMessageWeekday && safetyResult.blockedReasons.length === 0 && !safetyResult.repaired
      ? response.meta
      : {
          ...response.meta,
          hadActionsMarkup: response.meta?.hadActionsMarkup ?? false,
          actionParseFailed: false,
          likelyTruncated: false,
          warnings: [
            ...(response.meta?.warnings ?? []),
            ...(repairedReplacementAction
              ? ['chat_action_delete_only_repaired_to_running_replacement']
              : repairedRequestedMoves
                ? ['chat_action_move_sessions_reconciled']
                : repairedMissingRequestedActions
                  ? ['chat_action_missing_requested_sessions_repaired']
                  : removedCollidingAddSessionCount > 0
                    ? ['chat_action_occupied_slot_actions_removed']
                    : !response.actions?.length
                      ? ['chat_action_without_actions_repaired']
                      : []),
            ...(hydratedMissingStrengthExercises ? ['chat_action_missing_strength_exercises_hydrated'] : []),
            ...(correctedMessageWeekday ? ['chat_action_message_weekday_aligned'] : []),
            ...(fullyBlocked ? ['chat_action_strength_safety_blocked'] : []),
            ...(partiallyBlocked ? ['chat_action_strength_safety_partially_blocked'] : []),
            ...(safetyResult.repaired ? ['chat_action_strength_safety_repaired'] : []),
            ...squashActionWarnings.map((warning) => warning.code),
            ...(response.meta?.actionParseFailed || response.meta?.likelyTruncated
              ? ['chat_action_malformed_response_repaired']
              : []),
          ],
        },
  }
}

function buildRecentActionIntentText(normalizedMessage: string, context: ChatContext): string {
  const recent = context.recentMessages
    ?.slice(-8)
    .map(message => normalizeText(message.content))
    .join('\n') ?? ''
  return `${recent}\n${normalizedMessage}`.trim()
}

function isActionConfirmationFollowUp(normalizedMessage: string): boolean {
  return normalizedMessage.length <= 80
    && /\b(si|sí|ok|okay|dale|confirmo|correcto|hazlo|hacelo|crea(?:la|lo)?|aplicalo|aplica|realiza(?:r)?(?:\s+el)?\s+cambio|procede|adelante)\b/.test(normalizedMessage)
    && !/\b(porque|pero|aunque|opino|creo|pregunta|duda)\b/.test(normalizedMessage)
}

function isCreationConfirmationFollowUp(normalizedMessage: string): boolean {
  return normalizedMessage.length <= 80
    && /\b(crea(?:la|lo)?|hazlo|hacelo)\b/.test(normalizedMessage)
    && !/\b(porque|pero|aunque|opino|creo|pregunta|duda)\b/.test(normalizedMessage)
}

function shouldInheritRecentActionContext(normalizedMessage: string, context: ChatContext): boolean {
  if (isActionConfirmationFollowUp(normalizedMessage)) return true
  if (normalizedMessage.length > 140) return false
  if (!ACTION_VERB_PATTERN.test(normalizedMessage)) return false
  if (!SESSION_TARGET_PATTERN.test(normalizedMessage)) return false
  if (NEXT_WEEK_PATTERN.test(normalizedMessage) || CURRENT_WEEK_PATTERN.test(normalizedMessage)) return false
  if (/\b(hoy|manana)\b/.test(normalizedMessage)) return false
  return hasRecentTemporalActionDiscussion(context)
}

function hasRecentTemporalActionDiscussion(context: ChatContext): boolean {
  const recent = context.recentMessages?.slice(-8) ?? []
  if (recent.length === 0) return false
  const text = normalizeText(recent.map(message => message.content).join('\n'))
  return (
    (NEXT_WEEK_PATTERN.test(text) || CURRENT_WEEK_PATTERN.test(text) || WEEKDAY_REFERENCE_PATTERN.test(text)) &&
    (SESSION_TARGET_PATTERN.test(text) || ACTION_VERB_PATTERN.test(text))
  )
}

function resolveRecentDateForRequestedSession(
  normalizedMessage: string,
  context: ChatContext,
  requestedWeekStart: string | undefined,
  restOffsets: Set<number>,
): string | undefined {
  const requestedSessionType = inferRequestedSessionType(normalizedMessage)
  if (!requestedSessionType) return undefined

  const recent = context.recentMessages?.slice(-8).reverse() ?? []
  for (const message of recent) {
    const text = normalizeText(message.content)
    const clauses = extractActionableWeekdaySessionClauses(text, context, requestedWeekStart, restOffsets)
    const matchingClause = clauses.find(clause => clause.sessionType === requestedSessionType)
    if (matchingClause) return matchingClause.targetDate
  }

  return undefined
}

function buildRunningZone2ReplacementAction(
  intentText: string,
  affectedSession: Session | undefined,
): CoachAction | undefined {
  if (!affectedSession) return undefined
  if (!/\b(running|correr|corrida|trote)\b/.test(intentText)) return undefined
  if (!/\b(z2|zona\s*2|zona\s+dos|aerobico|aerobica|aerobica)\b/.test(intentText)) return undefined

  const durationMin = inferRequestedDuration(intentText, 'running')
  return {
    type: 'update_session',
    sessionId: affectedSession.id,
    reason: 'Reemplazar la sesion existente por una corrida Z2 de baja carga, segun confirmacion del usuario.',
    newType: 'running',
    newTitle: 'Running Z2 suave',
    newObjective: 'Mantener movimiento aerobico suave y favorecer recuperacion sin sumar fatiga alta.',
    newDurationMin: durationMin,
    newRpe: 4,
    runningType: 'z2',
    targetHrMin: 62,
    targetHrMax: 72,
    intervalStructure: buildRunningZone2IntervalStructure(durationMin),
  }
}

function shouldForceRunningReplacement(
  actions: CoachAction[] | undefined,
  affectedSession: Session | undefined,
): boolean {
  if (!affectedSession) return false
  if (!actions || actions.length === 0) return true
  if (actions.some(isRunningChangeAction)) return false
  return actions.every(action => isDeleteOrSkipForSession(action, affectedSession))
}

function isRunningChangeAction(action: CoachAction): boolean {
  if (action.type === 'add_session') return action.sessionType === 'running' || action.runningType === 'z2'
  if (action.type === 'update_session') return action.newType === 'running' || action.runningType === 'z2'
  if (action.type === 'replace_session_type') return action.newType === 'running'
  return false
}

function isDeleteOrSkipForSession(action: CoachAction, session: Session): boolean {
  if (action.type !== 'delete_session' && action.type !== 'skip_session') return false
  if (!action.sessionId || action.sessionId === 'ID_DE_8_CHARS') return true
  return action.sessionId === session.id || session.id.startsWith(action.sessionId)
}

function buildRunningReplacementMessage(action: CoachAction): string {
  const duration = action.type === 'update_session' ? action.newDurationMin : undefined
  return `Perfecto. Te dejo el cambio como reemplazo de la sesion existente por un Running Z2 suave${duration ? ` de ${duration}min` : ''}, para que puedas revisarlo y aplicarlo.`
}

interface RequestedSessionClause {
  targetDate: string
  sessionType: SessionType
  clause: string
  weekdayOffset: number
}

interface RequestedMoveClause {
  sessionType: SessionType
  sourceDate: string
  targetDate: string
}

function buildRequestedMoveSessionActions(
  normalizedMessage: string,
  context: ChatContext,
  requestedWeekStart: string | undefined,
): CoachAction[] | undefined {
  if (!MOVE_SESSION_INTENT_PATTERN.test(normalizedMessage)) return undefined

  const clauses = extractRequestedMoveClauses(normalizedMessage, context, requestedWeekStart)
  if (clauses.length === 0) return undefined
  const sessions = getContextSessions(context)
  const actions: CoachAction[] = []

  for (const clause of clauses) {
    const candidates = sessions.filter((session) =>
      session.date === clause.sourceDate &&
      session.type === clause.sessionType &&
      session.status !== 'skipped',
    )
    if (candidates.length !== 1) return undefined
    actions.push({
      type: 'move_session',
      sessionId: candidates[0].id,
      targetDate: clause.targetDate,
      reason: `Mover la sesión de ${clause.sessionType} al día solicitado por el usuario.`,
    })
  }

  return actions
}

function extractRequestedMoveClauses(
  normalizedMessage: string,
  context: ChatContext,
  requestedWeekStart: string | undefined,
): RequestedMoveClause[] {
  const sport =
    '(fuerza|pesas|gym|gimnasio|strength|running|correr|corrida|trote|squash|cycling|ciclismo|bici|bicicleta|movilidad|mobility|recovery|recuperacion)'
  const weekday = '(lunes|martes|miercoles|jueves|viernes|sabado|domingo)'
  const pattern = new RegExp(
    `\\b${sport}\\b\\s+(?:del?|desde)\\s+(?:el\\s+)?${weekday}\\b\\s+(?:para|al|a|hacia)\\s+(?:el\\s+)?${weekday}\\b`,
    'g',
  )
  const clauses: RequestedMoveClause[] = []
  let match = pattern.exec(normalizedMessage)

  while (match) {
    const sessionType = inferRequestedSessionType(match[1])
    const sourceOffset = getWeekdayOffsetForLabel(match[2])
    const targetOffset = getWeekdayOffsetForLabel(match[3])
    if (sessionType && sourceOffset != null && targetOffset != null) {
      clauses.push({
        sessionType,
        sourceDate: resolveWeekdayOffsetDate(sourceOffset, context, requestedWeekStart),
        targetDate: resolveWeekdayOffsetDate(targetOffset, context, requestedWeekStart),
      })
    }
    match = pattern.exec(normalizedMessage)
  }

  return clauses
}

function reconcileRequestedMoveActions(
  sourceActions: CoachAction[] | undefined,
  requestedMoveActions: CoachAction[] | undefined,
): CoachAction[] | undefined {
  if (!requestedMoveActions?.length) return sourceActions
  if (!sourceActions?.length) return requestedMoveActions
  return [
    ...sourceActions.filter((action) => action.type !== 'move_session'),
    ...requestedMoveActions,
  ]
}

function moveActionsMatch(
  sourceActions: CoachAction[] | undefined,
  requestedMoveActions: CoachAction[],
): boolean {
  const sourceMoves = sourceActions?.filter((action) => action.type === 'move_session') ?? []
  if (sourceMoves.length !== requestedMoveActions.length) return false
  return requestedMoveActions.every((requested) =>
    sourceMoves.some((source) =>
      source.sessionId === requested.sessionId &&
      source.targetDate === requested.targetDate,
    ),
  )
}

function buildFallbackRequestedSessionActions(
  normalizedMessage: string,
  context: ChatContext,
  requestedWeekStart: string | undefined,
  restOffsets: Set<number>,
): CoachAction[] | undefined {
  if (!CREATE_SESSION_INTENT_PATTERN.test(normalizedMessage)) return undefined

  const clauses = extractActionableWeekdaySessionClauses(normalizedMessage, context, requestedWeekStart, restOffsets)
  if (clauses.length === 0) return undefined

  return clauses.map((clause) => buildFallbackAddSessionAction({
    sessionType: clause.sessionType,
    normalizedMessage,
    clauseText: clause.clause,
    targetDate: clause.targetDate,
    context,
    reason: 'Se reparo una solicitud con multiples dias/deportes para crear una accion por cada sesion pedida.',
  }))
}

function mergeMissingRequestedSessionActions(
  sourceActions: CoachAction[] | undefined,
  requestedActions: CoachAction[] | undefined,
): CoachAction[] | undefined {
  if (!requestedActions?.length) return sourceActions
  if (!sourceActions?.length) return requestedActions

  const requestedTypeCounts = requestedActions.reduce<Record<string, number>>((counts, action) => {
    const key = action.sessionType ?? 'unknown'
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
  const merged = [...sourceActions]

  for (const requested of requestedActions) {
    if (!sourceActions.some(action => matchesRequestedSessionAction(action, requested, requestedTypeCounts))) {
      merged.push(requested)
    }
  }

  return merged
}

function matchesRequestedSessionAction(
  action: CoachAction,
  requested: CoachAction,
  requestedTypeCounts: Record<string, number>,
): boolean {
  if (action.type !== 'add_session' || requested.type !== 'add_session') return false
  if (!action.sessionType || action.sessionType !== requested.sessionType) return false

  if (action.targetDate && requested.targetDate) {
    return getWeekdayOffset(action.targetDate) === getWeekdayOffset(requested.targetDate)
  }

  const typeCount = requestedTypeCounts[requested.sessionType] ?? 0
  if (typeCount === 1) return true

  return false
}

function countActionableWeekdayTargets(
  normalizedMessage: string,
  restOffsets: Set<number>,
): number {
  return extractActionableWeekdaySessionClauses(
    normalizedMessage,
    { recentSessions: [], plannedSessions: [], historicalSessions: [] },
    undefined,
    restOffsets,
  ).length
}

function hasMultipleExplicitTemporalTargets(normalizedMessage: string): boolean {
  const targetDates = new Set<string>()
  const today = todayISO()

  if (/\bhoy\b/.test(normalizedMessage)) targetDates.add(today)
  if (/\bmanana\b/.test(normalizedMessage)) targetDates.add(addDaysToISO(today, 1))

  for (const weekday of collectWeekdayMatches(normalizedMessage)) {
    const todayOffset = getWeekdayOffset(today)
    const daysUntilWeekday = (weekday.offset - todayOffset + 7) % 7
    targetDates.add(addDaysToISO(today, daysUntilWeekday))
  }

  return targetDates.size > 1
}

function extractActionableWeekdaySessionClauses(
  normalizedMessage: string,
  context: ChatContext,
  requestedWeekStart: string | undefined,
  restOffsets: Set<number>,
): RequestedSessionClause[] {
  const matches = collectWeekdayMatches(normalizedMessage)
  if (matches.length === 0) return []

  const clauses: RequestedSessionClause[] = []
  const seen = new Set<string>()

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    if (restOffsets.has(match.offset)) continue

    const previousEnd = index > 0 ? matches[index - 1].end : 0
    const nextStart = index < matches.length - 1 ? matches[index + 1].index : normalizedMessage.length
    const clauseStart = findClauseStart(normalizedMessage, match.index, previousEnd)
    const clauseEnd = findClauseEnd(normalizedMessage, match.end, nextStart)
    const clause = normalizedMessage.slice(clauseStart, clauseEnd).trim()
    if (!clause || hasRestWeekdayReference(clause, match.label)) continue
    if (!CREATE_SESSION_INTENT_PATTERN.test(clause)) continue

    const sessionType = inferRequestedSessionTypeFromClause(clause, match.index - clauseStart)
    if (!sessionType) continue

    const key = `${match.offset}|${sessionType}`
    if (seen.has(key)) continue
    seen.add(key)

    clauses.push({
      targetDate: resolveWeekdayOffsetDate(match.offset, context, requestedWeekStart),
      sessionType,
      clause,
      weekdayOffset: match.offset,
    })
  }

  return clauses
}

function collectWeekdayMatches(normalizedMessage: string): Array<{ label: string; offset: number; index: number; end: number }> {
  const matches: Array<{ label: string; offset: number; index: number; end: number }> = []
  for (const day of WEEKDAYS) {
    for (const label of day.labels) {
      const pattern = new RegExp(`\\b${label}\\b`, 'g')
      let match = pattern.exec(normalizedMessage)
      while (match) {
        matches.push({
          label,
          offset: day.offset,
          index: match.index,
          end: match.index + label.length,
        })
        match = pattern.exec(normalizedMessage)
      }
    }
  }
  return matches.sort((a, b) => a.index - b.index)
}

function findClauseStart(text: string, weekdayIndex: number, previousWeekdayEnd: number): number {
  const boundary = Math.max(
    text.lastIndexOf(',', weekdayIndex - 1),
    text.lastIndexOf(';', weekdayIndex - 1),
    text.lastIndexOf('.', weekdayIndex - 1),
    text.lastIndexOf('\n', weekdayIndex - 1),
  )
  const clauseStart = Math.max(previousWeekdayEnd, boundary + 1)
  const prefix = text.slice(clauseStart, weekdayIndex)
  // A connector such as "pesas y para viernes" starts a new day request. Do
  // not let the sport from the previous day leak into the next one.
  const coordinatedDayLead = /(?:^|\s)y\s+(?:para\s+)?(?:el\s+|la\s+)?$/.exec(prefix)
  return coordinatedDayLead ? clauseStart + coordinatedDayLead.index : clauseStart
}

function findClauseEnd(text: string, weekdayEnd: number, nextWeekdayStart: number): number {
  const candidates = [nextWeekdayStart]
  for (const delimiter of [',', ';', '.', '\n']) {
    const index = text.indexOf(delimiter, weekdayEnd)
    if (index !== -1) candidates.push(index)
  }
  return Math.min(...candidates)
}

function inferRequestedSessionTypeFromClause(clause: string, weekdayIndex: number): SessionType | undefined {
  const candidates = collectSessionTypeMentions(clause)
  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => {
    const distance = Math.abs(a.index - weekdayIndex) - Math.abs(b.index - weekdayIndex)
    if (distance !== 0) return distance
    return a.index - b.index
  })

  return candidates[0].sessionType
}

function collectSessionTypeMentions(clause: string): Array<{ sessionType: SessionType; index: number }> {
  const specs: Array<{ sessionType: SessionType; pattern: RegExp }> = [
    { sessionType: 'strength', pattern: /\b(fuerza|pesas|gym|gimnasio|strength)\b/g },
    { sessionType: 'running', pattern: /\b(running|correr|corrida|trote)\b/g },
    { sessionType: 'squash', pattern: /\bsquash\b/g },
    { sessionType: 'cycling', pattern: /\b(cycling|ciclismo|bici|bicicleta)\b/g },
    { sessionType: 'mobility', pattern: /\b(movilidad|mobility)\b/g },
    { sessionType: 'recovery', pattern: /\b(recovery|recuperacion)\b/g },
  ]
  const mentions: Array<{ sessionType: SessionType; index: number }> = []

  for (const spec of specs) {
    let match = spec.pattern.exec(clause)
    while (match) {
      mentions.push({ sessionType: spec.sessionType, index: match.index })
      match = spec.pattern.exec(clause)
    }
  }

  return mentions
}

function buildFallbackAddSessionAction(options: {
  sessionType: SessionType
  normalizedMessage: string
  clauseText?: string
  targetDate: string
  context: ChatContext
  reason: string
}): CoachAction {
  const intentText = `${options.clauseText ?? ''}\n${options.normalizedMessage}`.trim()
  const durationMin = inferRequestedDuration(intentText, options.sessionType)
  const objective = buildFallbackObjective(options.sessionType, intentText)
  const action: CoachAction = {
    type: 'add_session',
    reason: options.reason,
    targetDate: options.targetDate,
    timeBlock: resolveTimeBlock(options.clauseText ?? '') ?? resolveTimeBlock(options.normalizedMessage) ?? 'PM',
    sessionType: options.sessionType,
    title: buildFallbackTitle(options.sessionType),
    durationMin,
    rpe: options.sessionType === 'strength' ? 7 : undefined,
    objective,
  }

  if (options.sessionType === 'strength') {
    // El finalizador vuelve a resolver las restricciones con autoridad antes de
    // emitir la acción. Este productor temprano decide explícitamente `[]`.
    action.exercises = selectStrengthProposalsForAction(options.context, durationMin, objective, [])
  }

  return completeRunningZone2Details(action, intentText)
}

function buildFallbackSingleSessionActions(
  normalizedMessage: string,
  context: ChatContext,
  resolvedDate: string | undefined,
  options: { allowResolvedDateOnly?: boolean } = {},
): CoachAction[] | undefined {
  if (!isClearSingleSessionCreationRequest(normalizedMessage, options)) return undefined
  const sessionType = inferRequestedSessionType(normalizedMessage)
  if (!sessionType || !resolvedDate) return undefined

  return [buildFallbackAddSessionAction({
    sessionType,
    normalizedMessage,
    targetDate: resolvedDate,
    context,
    reason: 'El modelo respondio en texto; se creo una accion estructurada desde la solicitud puntual.',
  })]
}

function isClearSingleSessionCreationRequest(
  normalizedMessage: string,
  options: { allowResolvedDateOnly?: boolean } = {},
): boolean {
  const hasCreateIntent = CREATE_SESSION_INTENT_PATTERN.test(normalizedMessage)
  const hasSessionTarget = SESSION_TARGET_PATTERN.test(normalizedMessage)
  const hasDay = WEEKDAY_REFERENCE_PATTERN.test(normalizedMessage)
  const hasRelativeDate = /\b(hoy|manana)\b/.test(normalizedMessage)
  const actionableWeekdayCount = countActionableWeekdayTargets(normalizedMessage, resolveRestWeekdayOffsets(normalizedMessage))
  const hasMultipleTemporalTargets = hasMultipleExplicitTemporalTargets(normalizedMessage)
  const broadWeekTarget = /\b(microciclo|plan completo|planificar semana)\b/.test(normalizedMessage)
  const explicitWeekCreation = /\b(crea(?:r|me)?|crear|genera(?:r|me)?|generar|haz(?:me)?|hacer|arma(?:me)?)\b.{0,24}\bsemana\b/.test(normalizedMessage)
  return hasCreateIntent
    && hasSessionTarget
    && (hasRelativeDate || actionableWeekdayCount === 1 || (Boolean(options.allowResolvedDateOnly) && !hasDay))
    && !hasMultipleTemporalTargets
    && !broadWeekTarget
    && !explicitWeekCreation
}

function inferRequestedSessionType(normalizedMessage: string): SessionType | undefined {
  if (/\b(fuerza|pesas|gym|gimnasio|strength)\b/.test(normalizedMessage)) return 'strength'
  if (/\b(squash)\b/.test(normalizedMessage)) return 'squash'
  if (/\b(running|correr|corrida|trote)\b/.test(normalizedMessage)) return 'running'
  if (/\b(cycling|ciclismo|bici|bicicleta)\b/.test(normalizedMessage)) return 'cycling'
  if (/\b(movilidad|mobility)\b/.test(normalizedMessage)) return 'mobility'
  if (/\b(recovery|recuperacion|descarga)\b/.test(normalizedMessage)) return 'recovery'
  return undefined
}

function inferRequestedDuration(normalizedMessage: string, sessionType: SessionType): number {
  const explicit = normalizedMessage.match(/\b(\d{2,3})\s*(?:min|mins|minutos)\b/)
  if (explicit) return Number(explicit[1])
  if (sessionType === 'strength') return 60
  if (sessionType === 'squash') return 60
  if (sessionType === 'running') return 45
  if (sessionType === 'cycling') return 60
  if (sessionType === 'mobility') return 30
  return 25
}

function buildFallbackTitle(sessionType: SessionType): string {
  switch (sessionType) {
    case 'strength': return 'Fuerza estructurada'
    case 'squash': return 'Squash técnico'
    case 'running': return 'Running suave'
    case 'cycling': return 'Ciclismo base'
    case 'mobility': return 'Movilidad'
    case 'recovery': return 'Recuperación activa'
    default: return 'Sesión'
  }
}

function buildFallbackObjective(sessionType: SessionType, normalizedMessage: string): string {
  if (sessionType === 'strength') {
    return normalizedMessage.includes('squash')
      ? 'Desarrollar fuerza útil para squash con zona media, fuerza principal y transferencia controlada.'
      : 'Desarrollar fuerza general con zona media, patrones principales y accesorios seguros.'
  }
  if (sessionType === 'squash') return 'Mejorar control técnico y ritmo de juego con carga manejable.'
  if (sessionType === 'running') return 'Sumar base aeróbica con esfuerzo controlado.'
  if (sessionType === 'cycling') return 'Sumar trabajo aeróbico de bajo impacto.'
  if (sessionType === 'mobility') return 'Mejorar rango de movimiento y soltar zonas cargadas.'
  return 'Favorecer recuperación y continuidad sin sumar fatiga relevante.'
}

function completeRunningZone2Details(action: CoachAction, intentText: string): CoachAction {
  if (!ZONE_2_PATTERN.test(intentText)) return action

  if (action.type === 'add_session' && action.sessionType === 'running') {
    const durationMin = action.durationMin ?? inferRequestedDuration(intentText, 'running')
    return {
      ...action,
      title: /z2|zona\s*2/i.test(action.title ?? '') ? action.title : 'Running Z2 suave',
      objective: action.objective ?? 'Sumar base aerobica con esfuerzo conversacional y baja carga.',
      durationMin,
      rpe: action.rpe ?? 4,
      runningType: 'z2',
      targetHrMin: action.targetHrMin ?? 62,
      targetHrMax: action.targetHrMax ?? 72,
      intervalStructure: action.intervalStructure ?? buildRunningZone2IntervalStructure(durationMin),
    }
  }

  if (action.type === 'update_session' && (action.newType === 'running' || action.runningType === 'z2')) {
    const durationMin = action.newDurationMin ?? inferRequestedDuration(intentText, 'running')
    return {
      ...action,
      newType: action.newType ?? 'running',
      newTitle: action.newTitle ?? 'Running Z2 suave',
      newObjective: action.newObjective ?? 'Sumar base aerobica con esfuerzo conversacional y baja carga.',
      newDurationMin: durationMin,
      newRpe: action.newRpe ?? 4,
      runningType: 'z2',
      targetHrMin: action.targetHrMin ?? 62,
      targetHrMax: action.targetHrMax ?? 72,
      intervalStructure: action.intervalStructure ?? buildRunningZone2IntervalStructure(durationMin),
    }
  }

  return action
}

function buildRunningZone2IntervalStructure(durationMin: number): NonNullable<CoachAction['intervalStructure']> {
  return {
    blocks: [
      { label: 'Calentamiento caminata', durationMin: 5, notes: 'Activar articulaciones antes de correr.' },
      { label: 'Trote Z2 continuo', durationMin: Math.max(15, durationMin - 10), notes: 'Ritmo conversacional; mantener 62-72% FCmax.' },
      { label: 'Vuelta a la calma caminata', durationMin: 5, notes: 'Cerrar suave.' },
    ],
  }
}

function buildFallbackActionMessage(actions: CoachAction[], originalMessage: string): string {
  const addSessionCount = actions.filter(action => action.type === 'add_session').length
  if (addSessionCount > 1) {
    return `Te prepare ${addSessionCount} sesiones como acciones para que puedas revisarlas y aplicarlas.${originalMessage ? `\n\n${originalMessage}` : ''}`
  }
  if (addSessionCount === 1) {
    return `Te prepare la sesion como accion para que puedas revisarla y aplicarla.${originalMessage ? `\n\n${originalMessage}` : ''}`
  }
  return originalMessage || 'Te propongo este cambio:'
}

/**
 * The provider can pair a valid ISO date with the wrong weekday in prose
 * (for example, "jueves 4 de septiembre" for 2026-09-04). The structured
 * action is the source of truth, so keep the user-facing sentence in sync
 * before the message is persisted in chat.
 */
function alignMessageWeekdayToActionDate(message: string, actions: CoachAction[]): string {
  const datedActions = actions.filter((action) => (
    (action.type === 'add_session' || action.type === 'move_session' || action.type === 'insert_recovery') &&
    action.targetDate &&
    isValidISODate(action.targetDate)
  ))
  if (datedActions.length !== 1) return message

  const targetDate = datedActions[0].targetDate!
  const targetWeekday = WEEKDAYS[getWeekdayOffset(targetDate)]?.labels[0]
  if (!targetWeekday) return message

  const weekdayPattern = /\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/gi
  const matches = [...message.matchAll(weekdayPattern)]
  if (matches.length === 0) return message

  const targetDay = Number(targetDate.slice(8, 10))
  const targetDayPattern = new RegExp(`\\b0?${targetDay}\\b`)
  const candidates = matches.filter((match) => {
    const index = match.index ?? 0
    return targetDayPattern.test(message.slice(index, index + 48))
  })
  const matchesToReplace = candidates.length > 0
    ? candidates
    : matches.length === 1 ? matches : []
  if (matchesToReplace.length === 0) return message

  const replacementIndexes = new Set(matchesToReplace.map((match) => match.index ?? -1))
  return message.replace(weekdayPattern, (weekday, _group, offset: number) => {
    if (!replacementIndexes.has(offset)) return weekday
    const canonical = weekday[0] === weekday[0].toUpperCase()
      ? `${targetWeekday[0].toUpperCase()}${targetWeekday.slice(1)}`
      : targetWeekday
    return normalizeText(weekday) === targetWeekday ? weekday : canonical
  })
}

interface SquashActionWarning {
  code: string
  message: string
  /** Sólo los avisos accionables llegan al chat; los códigos de fallback quedan en telemetría. */
  userFacing?: boolean
}

function completeSquashAction(
  action: CoachAction,
  context: ChatContext,
  currentSession: Session | undefined,
  userMessage: string,
): { action: CoachAction; warnings: SquashActionWarning[] } {
  const isAdd = action.type === 'add_session'
  const isUpdate = action.type === 'update_session'
  if (action.type === 'create_week') {
    return completeSquashCreateWeek(action, context, userMessage)
  }
  if (!isAdd && !isUpdate) return { action, warnings: [] }

  const nextType = isAdd ? action.sessionType : action.newType ?? currentSession?.type
  if (nextType !== 'squash') return { action, warnings: [] }

  const touchesSquash = isAdd || action.newType === 'squash'
    || action.squashKind != null || action.squashDetails != null || action.subtype != null
  if (!touchesSquash) return { action, warnings: [] }

  const warnings: SquashActionWarning[] = []
  const kindResolution = resolveSquashActionKind(action, currentSession)
  const requestedKind = kindResolution.kind
  if (kindResolution.warning) warnings.push(kindResolution.warning)

  // Un `update_session` que no trae modalidad ni contenido nuevo, y que resuelve
  // a la modalidad ya persistida, no tiene nada que rehidratar: recomponer el
  // contenido acá borraría los drills que el atleta ya tenía planificados.
  if (
    isUpdate
    && action.squashKind == null
    && action.squashDetails == null
    && currentSession?.squashDetails != null
    && requestedKind === currentSession.squashDetails.sessionKind
  ) {
    return { action, warnings: [] }
  }

  const explicitDetails = action.squashDetails
  if (explicitDetails?.drills?.length) {
    const compatibility = inspectSquashDrillCompatibility(explicitDetails.drills, requestedKind)
    const explicitlyRequested = userExplicitlyRequestedSquashDrill(explicitDetails.drills, userMessage)

    if (compatibility.incompatibleNames.length === 0 && (compatibility.knownCount > 0 || explicitlyRequested)) {
      return {
        action: {
          ...action,
          squashKind: requestedKind,
          subtype: projectSquashSubtype(requestedKind, action.subtype === 'competitive'),
          squashDetails: {
            ...explicitDetails,
            sessionKind: requestedKind,
            sessionMode: requestedKind === 'match'
              ? action.subtype === 'competitive' ? 'competition_match' : 'practice_match'
              : 'drill_session',
          },
        },
        warnings,
      }
    }

    if (compatibility.incompatibleNames.length > 0 && explicitlyRequested) {
      warnings.push({
        code: 'squash_explicit_drill_incompatible_preserved',
        message: `Advertencia: conservé ${formatDrillNames(compatibility.incompatibleNames)} porque lo pediste explícitamente, pero no corresponde a la modalidad ${requestedKind}. Revísalo antes de aplicar.`,
        userFacing: true,
      })
      // La modalidad sólo persiste por `squashDetails.sessionKind`: ningún
      // consumidor del store lee `action.squashKind`. Estamparla sólo en la
      // acción guardaría la sesión bajo otra modalidad que la anunciada.
      return {
        action: {
          ...action,
          squashKind: requestedKind,
          squashDetails: { ...explicitDetails, sessionKind: requestedKind },
        },
        warnings,
      }
    }

    if (compatibility.incompatibleNames.length > 0) {
      warnings.push({
        code: 'squash_provider_drill_conflict_rehydrated',
        message: `Alineé la sesión a modalidad ${requestedKind}: los drills propuestos no eran compatibles con esa modalidad.`,
        userFacing: true,
      })
    }
  }

  const phase = resolveSquashActionPhase(context)
  const sessions = getContextSessions(context)
  const durationMin = isAdd
    ? action.durationMin ?? 60
    : action.newDurationMin ?? currentSession?.durationMin ?? 60
  const objective = isAdd
    ? action.objective ?? action.title ?? ''
    : action.newObjective ?? currentSession?.objective ?? currentSession?.title ?? ''
  const result = hydrateSquashSession({
    kind: requestedKind,
    durationMin,
    phase,
    fatigueLevel: resolveSquashActionFatigue(context),
    goal: objective,
    recentDrills: sessions.flatMap((session) => session.squashDetails?.drills.map((drill) => drill.name) ?? []),
    competitionSoon: phase === 'taper',
    competitiveLevel: resolveSquashActionCompetitiveLevel(context),
    partnerAvailability: context.athleteProfile?.planWizardConfig?.partnerAvailability ?? 'either',
    historicalSessions: sessions,
    competitive: action.subtype === 'competitive',
  })

  for (const warning of result.warnings) {
    warnings.push({
      code: `squash_hydration_${warning.code}`,
      message: warning.message,
    })
  }

  const resolvedKind = result.details.sessionKind === 'mixed'
    ? requestedKind
    : result.details.sessionKind
  return {
    action: {
      ...action,
      squashKind: resolvedKind,
      subtype: result.subtype,
      squashDetails: result.details,
    },
    warnings,
  }
}

/**
 * `create_week` comparte el borde compacto de `squashKind` con las acciones de
 * sesión, pero no pasa por el materializador de éstas: sin esto una sesión que
 * declara modalidad y omite detalles llega a la validación del store sin
 * `squashDetails` y hace fallar la semana entera.
 */
function completeSquashCreateWeek(
  action: CoachAction,
  context: ChatContext,
  userMessage: string,
): { action: CoachAction; warnings: SquashActionWarning[] } {
  if (!action.sessions?.length) return { action, warnings: [] }

  const warnings: SquashActionWarning[] = []
  const phase = resolveSquashActionPhase(context)
  const contextSessions = getContextSessions(context)
  const recentDrills = contextSessions.flatMap(
    (candidate) => candidate.squashDetails?.drills?.map((drill) => drill.name) ?? [],
  )
  const sessions = action.sessions.map((session) => {
    if (session.sessionType !== 'squash') return session

    const detailedKind = session.squashDetails?.sessionKind !== 'mixed'
      ? session.squashDetails?.sessionKind
      : undefined
    const subtypeKind = squashKindFromSubtype(session.subtype)
    const kind = session.squashKind ?? detailedKind ?? subtypeKind ?? 'technical'
    if (!session.squashKind) {
      warnings.push({
        code: detailedKind
          ? 'squash_kind_fallback_details'
          : subtypeKind
            ? 'squash_kind_fallback_subtype'
            : 'squash_kind_fallback_engine_default',
        message: detailedKind
          ? `La sesión "${session.title}" no declaró squashKind; conservé ${detailedKind} desde sus detalles.`
          : subtypeKind
            ? `La sesión "${session.title}" no declaró squashKind; usé ${subtypeKind} desde subtype.`
            : `La sesión "${session.title}" no declaró modalidad; se usó technical como fallback de compatibilidad.`,
      })
    }

    const explicitDetails = session.squashDetails
    if (explicitDetails?.drills?.length) {
      const compatibility = inspectSquashDrillCompatibility(explicitDetails.drills, kind)
      const explicitlyRequested = userExplicitlyRequestedSquashDrill(explicitDetails.drills, userMessage)
      const preserve = compatibility.incompatibleNames.length === 0
        ? compatibility.knownCount > 0 || explicitlyRequested
        : explicitlyRequested

      if (preserve) {
        if (compatibility.incompatibleNames.length > 0) {
          warnings.push({
            code: 'squash_explicit_drill_incompatible_preserved',
            message: `Advertencia: conservé ${formatDrillNames(compatibility.incompatibleNames)} porque lo pediste explícitamente, pero no corresponde a la modalidad ${kind}. Revísalo antes de aplicar.`,
            userFacing: true,
          })
        }
        const details = {
          ...explicitDetails,
          sessionKind: kind,
          sessionMode: kind === 'match'
            ? session.subtype === 'competitive' ? 'competition_match' as const : 'practice_match' as const
            : 'drill_session' as const,
        }
        recentDrills.push(...details.drills.map((drill) => drill.name))
        return {
          ...session,
          squashKind: kind,
          subtype: projectSquashSubtype(kind, session.subtype === 'competitive'),
          squashDetails: details,
        }
      }

      warnings.push({
        code: compatibility.incompatibleNames.length > 0
          ? 'squash_provider_drill_conflict_rehydrated'
          : 'squash_provider_drill_unresolved_rehydrated',
        message: compatibility.incompatibleNames.length > 0
          ? `Alineé la sesión "${session.title}" a modalidad ${kind}: los drills propuestos no eran compatibles.`
          : `Alineé la sesión "${session.title}" a modalidad ${kind}: los drills propuestos no se resolvieron en el catálogo.`,
        userFacing: compatibility.incompatibleNames.length > 0,
      })
    }

    const result = hydrateSquashSession({
      kind,
      durationMin: session.durationMin ?? 60,
      phase,
      fatigueLevel: resolveSquashActionFatigue(context),
      goal: session.objective ?? session.title ?? '',
      recentDrills,
      competitionSoon: phase === 'taper',
      competitiveLevel: resolveSquashActionCompetitiveLevel(context),
      partnerAvailability: context.athleteProfile?.planWizardConfig?.partnerAvailability ?? 'either',
      historicalSessions: contextSessions,
      competitive: session.subtype === 'competitive',
    })
    for (const warning of result.warnings) {
      warnings.push({ code: `squash_hydration_${warning.code}`, message: warning.message })
    }
    recentDrills.push(...result.details.drills.map((drill) => drill.name))
    return {
      ...session,
      squashKind: result.details.sessionKind === 'mixed' ? kind : result.details.sessionKind,
      subtype: result.subtype,
      squashDetails: result.details,
    }
  })

  return { action: { ...action, sessions }, warnings }
}

function resolveSquashActionKind(
  action: CoachAction,
  currentSession: Session | undefined,
): { kind: SquashSessionBlockKind; warning?: SquashActionWarning } {
  if (action.squashKind) return { kind: action.squashKind }

  const detailedKind = action.squashDetails?.sessionKind
  if (detailedKind && detailedKind !== 'mixed') {
    return {
      kind: detailedKind,
      warning: {
        code: 'squash_kind_fallback_details',
        message: `La acción no declaró squashKind; conservé la modalidad estructural ${detailedKind} de sus detalles.`,
      },
    }
  }

  const currentKind = currentSession?.squashDetails?.sessionKind
  const persistedKind = currentKind && currentKind !== 'mixed' ? currentKind : undefined
  const subtypeKind = squashKindFromSubtype(action.subtype)

  // `subtype` es una proyección con pérdida: `technical` y `shadows` colapsan
  // ambos en `training`. Por eso sólo puede decidir cuando contradice la
  // modalidad persistida; si apenas la repite, no aporta información nueva y
  // la sesión guardada es la evidencia más fuerte.
  if (subtypeKind && (!persistedKind || subtypeKind !== squashKindFromSubtype(projectSquashSubtype(persistedKind)))) {
    return {
      kind: subtypeKind,
      warning: {
        code: 'squash_kind_fallback_subtype',
        message: `La acción no declaró squashKind; usé la modalidad heredada ${subtypeKind} de subtype.`,
      },
    }
  }

  if (persistedKind) return { kind: persistedKind }

  return {
    kind: 'technical',
    warning: {
      code: 'squash_kind_fallback_engine_default',
      message: 'La acción de squash no declaró modalidad; se usó technical como fallback de compatibilidad.',
    },
  }
}

function squashKindFromSubtype(subtype: CoachAction['subtype']): SquashSessionBlockKind | undefined {
  if (subtype === 'control') return 'control'
  if (subtype === 'match' || subtype === 'competitive') return 'match'
  if (subtype === 'training') return 'technical'
  return undefined
}

function inspectSquashDrillCompatibility(
  drills: NonNullable<CoachAction['squashDetails']>['drills'],
  requestedKind: SquashSessionBlockKind,
): { knownCount: number; incompatibleNames: string[] } {
  let knownCount = 0
  const incompatibleNames: string[] = []
  for (const drill of drills) {
    const definition = findSquashDrillByName(drill.name)
    if (!definition) continue
    knownCount++
    const kind = resolveSquashDrillKind(definition)
    if (!isSquashDrillKindCompatible(requestedKind, kind)) incompatibleNames.push(drill.name)
  }
  return { knownCount, incompatibleNames }
}

function userExplicitlyRequestedSquashDrill(
  drills: NonNullable<CoachAction['squashDetails']>['drills'],
  userMessage: string,
): boolean {
  const normalizedMessage = normalizeText(userMessage)
  const fuzzy = findSquashDrillByName(userMessage)
  return drills.some((drill) => {
    const definition = findSquashDrillByName(drill.name)
    if (definition && fuzzy?.id === definition.id) return true

    const names = [drill.name, definition?.name, ...(definition?.aliases ?? [])].filter(
      (value): value is string => Boolean(value),
    )
    return names.some((name) => {
      const normalizedName = normalizeText(name)
      if (normalizedName.length >= 5 && normalizedMessage.includes(normalizedName)) return true
      const tokens = normalizeSquashDrillKey(name).split('_').filter((token) => token.length >= 5)
      return tokens.length > 0
        && tokens.filter((token) => normalizedMessage.includes(token)).length >= Math.min(2, tokens.length)
    })
  })
}

function formatDrillNames(names: string[]): string {
  if (names.length === 1) return `“${names[0]}”`
  return names.map((name) => `“${name}”`).join(', ')
}

function resolveSquashActionPhase(context: ChatContext): 'base' | 'build' | 'peak' | 'taper' {
  const phase = context.athleteProfile?.macroPlan?.currentPhase
  if (phase === 'build' || phase === 'peak' || phase === 'taper') return phase
  if (phase === 'race') return 'taper'
  return 'base'
}

function resolveSquashActionFatigue(context: ChatContext): number {
  const fatigue = context.athleteProfile?.planWizardConfig?.currentFatigue
  if (fatigue === 'overloaded') return 9
  if (fatigue === 'loaded') return 7
  if (fatigue === 'normal') return 5
  return 2
}

function resolveSquashActionCompetitiveLevel(context: ChatContext) {
  const profile = context.athleteProfile
  const event = profile?.goalEvents?.find((candidate) => candidate.id === profile.planWizardConfig?.goalEventId)
    ?? profile?.goalEvents?.find((candidate) => candidate.priority === 'primary')
  return event?.competitiveLevel
}

interface FinalizeStrengthActionsOptions {
  context: ChatContext
  sessions: Session[]
  actionIntentText: string
  normalizedUserMessage: string
  constraints: readonly StrengthConstraint[]
  userMessageConstraints: readonly StrengthConstraint[]
}

interface FinalizeStrengthActionsResult {
  actions: CoachAction[]
  blockedReasons: BlockedReason[]
  repaired: boolean
  removed: RemovedExercise[]
  replaced: ReplacedExercise[]
}

/**
 * Último paso que puede modificar ejercicios de fuerza en el chat. Una acción
 * create_week es atómica: si falla una de sus sesiones, se descarta completa.
 */
function finalizeStrengthActions(
  actions: CoachAction[],
  options: FinalizeStrengthActionsOptions,
): FinalizeStrengthActionsResult {
  const next: CoachAction[] = []
  const blockedReasons: BlockedReason[] = []
  const removed: RemovedExercise[] = []
  const replaced: ReplacedExercise[] = []

  const recordResult = (result: { removed: RemovedExercise[]; replaced: ReplacedExercise[] }) => {
    removed.push(...result.removed)
    replaced.push(...result.replaced)
  }

  for (const action of actions) {
    if (action.type === 'add_session' && action.sessionType === 'strength') {
      const selectionContext = buildStrengthSelectionContextForAction(
        options.context,
        action.durationMin,
        action.objective,
        options.constraints,
      )
      const result = prepareStrengthSession(action, {
        constraints: options.constraints,
        userMessageConstraints: options.userMessageConstraints,
        userMessage: options.normalizedUserMessage,
        selectionContext,
        structureOptions: {
          durationMin: action.durationMin,
          strengthProfile: options.context.athleteProfile?.strengthProfile,
        },
        supersetMode: resolveSupersetMode(
          options.context,
          options.actionIntentText,
          action.durationMin,
        ),
        sealLocation: 'root',
      })
      if (result.status === 'blocked') {
        blockedReasons.push(result.reason)
        continue
      }
      recordResult(result)
      next.push(result.session)
      continue
    }

    if (action.type === 'update_session') {
      const base = findSessionByIdOrPrefix(action.sessionId, options.sessions)
      if (!base) {
        next.push(action)
        continue
      }
      const prospective = materializeProspectiveSession(base, action)
      if (prospective.sessionType !== 'strength') {
        next.push(action)
        continue
      }
      const selectionContext = buildStrengthSelectionContextForAction(
        options.context,
        prospective.durationMin,
        prospective.objective,
        options.constraints,
      )
      const result = prepareStrengthSession(prospective, {
        constraints: options.constraints,
        userMessageConstraints: options.userMessageConstraints,
        userMessage: options.normalizedUserMessage,
        selectionContext,
        structureOptions: {
          durationMin: prospective.durationMin,
          strengthProfile: options.context.athleteProfile?.strengthProfile,
        },
        supersetMode: resolveSupersetMode(
          options.context,
          options.actionIntentText,
          prospective.durationMin,
        ),
        sealLocation: 'root',
      })
      if (result.status === 'blocked') {
        blockedReasons.push(result.reason)
        continue
      }
      recordResult(result)
      const prepared = result.session as CoachSessionProposal & Pick<CoachAction, 'strengthSafetyFinalization'>
      next.push({
        ...action,
        exercises: prepared.exercises,
        strengthSafetyFinalization: prepared.strengthSafetyFinalization,
        baseUpdatedAt: base.updatedAt,
      })
      continue
    }

    if (action.type === 'create_week' && action.sessions) {
      const preparedSessions: CoachSessionProposal[] = []
      let blocked = false
      for (const session of action.sessions) {
        if (session.sessionType !== 'strength') {
          preparedSessions.push(session)
          continue
        }
        const selectionContext = buildStrengthSelectionContextForAction(
          options.context,
          session.durationMin,
          session.objective,
          options.constraints,
        )
        const result = prepareStrengthSession(session, {
          constraints: options.constraints,
          userMessageConstraints: options.userMessageConstraints,
          userMessage: options.normalizedUserMessage,
          selectionContext,
          structureOptions: {
            durationMin: session.durationMin,
            strengthProfile: options.context.athleteProfile?.strengthProfile,
          },
          supersetMode: resolveSupersetMode(
            options.context,
            options.actionIntentText,
            session.durationMin,
          ),
          sealLocation: 'metadata',
        })
        if (result.status === 'blocked') {
          blockedReasons.push(result.reason)
          blocked = true
          break
        }
        recordResult(result)
        preparedSessions.push(result.session)
      }
      if (!blocked) next.push({ ...action, sessions: preparedSessions })
      continue
    }

    next.push(action)
  }

  return {
    actions: next,
    blockedReasons,
    repaired: removed.length > 0 || replaced.length > 0,
    removed,
    replaced,
  }
}

/** Materializa el patch de update sobre su base antes de verificar fuerza. */
export function materializeProspectiveSession(
  base: Session,
  action: CoachAction,
): CoachSessionProposal {
  if (action.type !== 'update_session') {
    throw new Error('materializeProspectiveSession requiere update_session')
  }
  const changesType = action.newType != null && action.newType !== base.type
  const inheritedExercises = changesType
    ? []
    : base.exercises?.map((exercise) => {
        const proposal = { ...exercise } as Partial<typeof exercise>
        delete proposal.id
        delete proposal.completed
        return proposal as CoachExerciseProposal
      })

  return {
    date: base.date,
    timeBlock: base.timeBlock,
    sessionType: action.newType ?? base.type,
    title: action.newTitle ?? base.title,
    durationMin: action.newDurationMin ?? base.durationMin,
    objective: action.newObjective ?? base.objective,
    rpe: action.newRpe ?? base.rpe,
    subtype: action.subtype ?? base.subtype,
    exercises: action.exercises ?? inheritedExercises,
    mobilityDetails: action.mobilityDetails ?? base.mobilityDetails,
    squashDetails: action.squashDetails ?? base.squashDetails,
    warmup: action.warmup ?? base.warmup,
    cooldown: action.cooldown ?? base.cooldown,
    metadata: base.metadata,
  }
}

function completeStrengthLoads(
  action: CoachAction,
  context: ChatContext,
  actionIntentText: string,
  safetyConstraints: readonly StrengthConstraint[],
): CoachAction {
  if (action.type === 'add_session' && action.sessionType === 'strength') {
    const objective = action.objective ?? buildFallbackObjective('strength', actionIntentText)
    const sourceExercises = action.exercises?.length
      ? action.exercises
      : selectStrengthProposalsForAction(
          context,
          action.durationMin,
          `${objective} ${actionIntentText}`,
          safetyConstraints,
        )
    return {
      ...action,
      objective,
      exercises: sourceExercises,
    }
  }

  // `update_session` es un patch. Se materializa y finaliza contra la sesión
  // base completa en `finalizeStrengthActions`, incluso si no trae exercises.
  if (action.type === 'update_session') return action

  if (action.type === 'create_week' && action.sessions) {
    return {
      ...action,
      sessions: action.sessions.map((session) => {
        if (session.sessionType !== 'strength') return session
        const objective = session.objective ?? buildFallbackObjective('strength', actionIntentText)
        const sourceExercises = session.exercises?.length
          ? session.exercises
          : selectStrengthProposalsForAction(
              context,
              session.durationMin,
              `${objective} ${actionIntentText}`,
              safetyConstraints,
            )
        return {
          ...session,
          objective,
          exercises: sourceExercises,
        }
      }),
    }
  }

  return action
}

function hasMissingStrengthExercises(action: CoachAction): boolean {
  if (action.type === 'add_session') {
    return action.sessionType === 'strength' && !action.exercises?.length
  }
  if (action.type === 'create_week') {
    return action.sessions?.some((session) => (
      session.sessionType === 'strength' && !session.exercises?.length
    )) ?? false
  }
  return false
}

function resolveSupersetMode(
  context: ChatContext,
  actionIntentText: string,
  sessionDurationMin?: number,
): SupersetPolicyMode {
  const phase = context.athleteProfile?.macroPlan?.currentPhase
  const primarySport = context.athleteProfile?.sportContext?.primarySport
  return shouldApplySupersetPolicy({
    phase: mapActionStrengthPhase(phase),
    sportProfile: deriveActionStrengthSportProfile(primarySport),
    sessionDurationMin,
    intent: detectSupersetIntent(actionIntentText),
  })
}

function alignSingleSessionSportToRequest(
  action: CoachAction,
  normalizedMessage: string,
  context: ChatContext,
): CoachAction {
  if (action.type !== 'add_session') return action
  if (!isClearSingleSessionCreationRequest(normalizedMessage)) return action

  const requestedSessionType = inferRequestedSessionType(normalizedMessage)
  if (!requestedSessionType || action.sessionType === requestedSessionType) return action

  const next: CoachAction = {
    ...action,
    sessionType: requestedSessionType,
    title: buildFallbackTitle(requestedSessionType),
    durationMin: action.durationMin ?? inferRequestedDuration(normalizedMessage, requestedSessionType),
    objective: buildFallbackObjective(requestedSessionType, normalizedMessage),
    subtype: undefined,
    runningType: undefined,
    targetPaceMin: undefined,
    targetPaceMax: undefined,
    targetHrMin: undefined,
    targetHrMax: undefined,
    intervalStructure: undefined,
    cyclingDetails: undefined,
    mobilityDetails: undefined,
    squashDetails: undefined,
    exercises: undefined,
  }

  if (requestedSessionType === 'strength') {
    next.rpe = action.rpe ?? 7
    next.exercises = selectStrengthProposalsForAction(
      context,
      next.durationMin,
      next.objective,
      [],
    )
  }

  return next
}

function buildStrengthSelectionContextForAction(
  context: ChatContext,
  durationMin: number | undefined,
  objective: string | undefined,
  safetyConstraints: readonly StrengthConstraint[],
): StrengthContext {
  const primarySport = context.athleteProfile?.sportContext?.primarySport
  return {
    fatigueLevel: 5,
    phase: mapActionStrengthPhase(context.athleteProfile?.macroPlan?.currentPhase),
    recentExercises: [],
    goal: objective ?? context.athleteProfile?.mainGoal ?? 'sesion de fuerza util y estructurada',
    sportProfile: deriveActionStrengthSportProfile(primarySport),
    primarySport,
    experienceLevel: 'intermediate',
    sessionDurationMin: durationMin ?? 60,
    safetyConstraints,
  }
}

function selectStrengthProposalsForAction(
  context: ChatContext,
  durationMin: number | undefined,
  objective: string | undefined,
  safetyConstraints: readonly StrengthConstraint[],
): CoachExerciseProposal[] {
  return selectStrengthSession(
    buildStrengthSelectionContextForAction(context, durationMin, objective, safetyConstraints),
  ).exercises.map(toStrengthProposalForEnhancement)
}

function mapActionStrengthPhase(phase: string | undefined): StrengthPhase {
  if (phase === 'build' || phase === 'peak' || phase === 'taper' || phase === 'transition') return phase
  if (phase === 'race') return 'taper'
  return 'base'
}

function deriveActionStrengthSportProfile(primarySport: string | undefined): StrengthSportProfile {
  if (primarySport === 'strength') return 'strength_primary'
  if (primarySport) return 'sport_support'
  return 'hybrid'
}


function alignActionDate(action: CoachAction, targetDate: string): CoachAction {
  if (action.type === 'add_session' || action.type === 'move_session' || action.type === 'insert_recovery') {
    return { ...action, targetDate }
  }

  return action
}

function convertAddSessionToUpdateSession(action: CoachAction, session: Session): CoachAction {
  const next: CoachAction = {
    type: 'update_session',
    sessionId: session.id,
    reason: action.reason,
  }

  if (action.title) next.newTitle = action.title
  if (action.objective) next.newObjective = action.objective
  if (action.durationMin != null) next.newDurationMin = action.durationMin
  if (action.rpe != null) next.newRpe = action.rpe
  if (action.sessionType && action.sessionType !== session.type) next.newType = action.sessionType
  if (action.subtype) next.subtype = action.subtype
  if (action.squashKind) next.squashKind = action.squashKind
  if (action.runningType) next.runningType = action.runningType
  if (action.targetPaceMin) next.targetPaceMin = action.targetPaceMin
  if (action.targetPaceMax) next.targetPaceMax = action.targetPaceMax
  if (action.targetHrMin != null) next.targetHrMin = action.targetHrMin
  if (action.targetHrMax != null) next.targetHrMax = action.targetHrMax
  if (action.intervalStructure) next.intervalStructure = action.intervalStructure
  if (action.cyclingDetails) next.cyclingDetails = action.cyclingDetails
  if (action.mobilityDetails) next.mobilityDetails = action.mobilityDetails
  if (action.squashDetails) next.squashDetails = action.squashDetails
  if (action.exercises) next.exercises = action.exercises
  if (action.warmup) next.warmup = action.warmup
  if (action.cooldown) next.cooldown = action.cooldown

  return next
}

function alignActionToRequestedWeek(
  action: CoachAction,
  requestedWeekStart: string,
  restOffsets: Set<number>,
  occupiedSlots: Set<string>,
  options: { lockDate?: boolean; requireEntireFreeDay?: boolean } = {},
): CoachAction {
  if (action.type !== 'add_session' && action.type !== 'move_session' && action.type !== 'insert_recovery') {
    return action
  }

  const targetDate = action.targetDate
  const timeBlock = action.type === 'add_session' ? action.timeBlock : undefined
  const targetDateIsEntirelyFree = targetDate
    ? isEntireDayFree(targetDate, occupiedSlots)
    : false
  if (
    options.lockDate &&
    targetDate &&
    isDateInWeek(targetDate, requestedWeekStart) &&
    (!options.requireEntireFreeDay || targetDateIsEntirelyFree)
  ) {
    if (timeBlock && occupiedSlots.has(`${targetDate}|${timeBlock}`)) {
      const replacementBlock = findAvailableTimeBlockForDate(targetDate, timeBlock, occupiedSlots)
      if (replacementBlock) {
        occupiedSlots.add(`${targetDate}|${replacementBlock}`)
        return { ...action, timeBlock: replacementBlock }
      }
    } else if (timeBlock) {
      occupiedSlots.add(`${targetDate}|${timeBlock}`)
    }
    return action
  }

  if (
    targetDate &&
    isDateInWeek(targetDate, requestedWeekStart) &&
    !restOffsets.has(getWeekdayOffset(targetDate)) &&
    (!options.requireEntireFreeDay || targetDateIsEntirelyFree) &&
    (!timeBlock || !occupiedSlots.has(`${targetDate}|${timeBlock}`))
  ) {
    if (timeBlock) occupiedSlots.add(`${targetDate}|${timeBlock}`)
    return action
  }

  const replacement = findAvailableDateInRequestedWeek(
    requestedWeekStart,
    targetDate,
    timeBlock,
    restOffsets,
    occupiedSlots,
    { requireEntireFreeDay: options.requireEntireFreeDay },
  )
  if (!replacement) return action

  if (replacement.timeBlock) occupiedSlots.add(`${replacement.date}|${replacement.timeBlock}`)
  return action.type === 'add_session' && replacement.timeBlock
    ? { ...action, targetDate: replacement.date, timeBlock: replacement.timeBlock }
    : { ...action, targetDate: replacement.date }
}

function isEntireDayFree(date: string, occupiedSlots: Set<string>): boolean {
  return !occupiedSlots.has(`${date}|AM`) && !occupiedSlots.has(`${date}|PM`)
}

function resolveWeekdayDate(
  normalizedMessage: string,
  context: ChatContext,
  requestedWeekStart: string | undefined,
  restOffsets: Set<number>,
): string | undefined {
  const match = WEEKDAYS.find((day) =>
    !restOffsets.has(day.offset) &&
    day.labels.some((label) => normalizedMessage.includes(label)),
  )
  if (!match) return undefined
  return resolveWeekdayOffsetDate(match.offset, context, requestedWeekStart)
}

function resolveWeekdayOffsetDate(
  weekdayOffset: number,
  context: ChatContext,
  requestedWeekStart: string | undefined,
): string {
  const weekStart = requestedWeekStart ?? context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO()
  const candidate = addDaysToISO(weekStart, weekdayOffset)
  if (requestedWeekStart) return candidate

  const today = todayISO()
  // An unqualified weekday always means its next occurrence. This matters most
  // on weekends: on Sunday, "el martes" is two days ahead, not five days ago.
  if (isDateInWeek(today, weekStart) && candidate < today) {
    return addDaysToISO(candidate, 7)
  }
  return candidate
}

function getWeekdayOffsetForLabel(label: string): number | undefined {
  return WEEKDAYS.find((weekday) => weekday.labels.some((item) => item === label))?.offset
}

function resolveRelativeDate(normalizedMessage: string): string | undefined {
  if (/\bhoy\b/.test(normalizedMessage)) return todayISO()
  if (/\bmanana\b/.test(normalizedMessage)) return addDaysToISO(todayISO(), 1)
  return undefined
}

function findAvailableTimeBlockForDate(
  date: string,
  preferredBlock: TimeBlock,
  occupiedSlots: Set<string>,
): TimeBlock | undefined {
  const fallbackBlock = preferredBlock === 'AM' ? 'PM' : 'AM'
  return occupiedSlots.has(`${date}|${fallbackBlock}`) ? undefined : fallbackBlock
}

function resolveRequestedWeekStart(normalizedMessage: string, context: ChatContext): string | undefined {
  const baseWeekStart = context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO()
  if (NEXT_WEEK_PATTERN.test(normalizedMessage)) return addDaysToISO(baseWeekStart, 7)
  if (CURRENT_WEEK_PATTERN.test(normalizedMessage)) return baseWeekStart
  return undefined
}

function resolveRestWeekdayOffsets(normalizedMessage: string): Set<number> {
  const offsets = new Set<number>()
  for (const day of WEEKDAYS) {
    if (day.labels.some((label) => hasRestWeekdayReference(normalizedMessage, label))) {
      offsets.add(day.offset)
    }
  }
  return offsets
}

function hasRestWeekdayReference(normalizedMessage: string, weekdayLabel: string): boolean {
  let index = normalizedMessage.indexOf(weekdayLabel)
  while (index !== -1) {
    const windowStart = Math.max(0, index - 32)
    const windowEnd = Math.min(normalizedMessage.length, index + weekdayLabel.length + 40)
    const windowText = normalizedMessage.slice(windowStart, windowEnd)
    if (/\b(descanso|descansar|libre|off|sin\s+entren|no\s+entren|no\s+poner|no\s+agregar|dejar(?:lo)?\s+libre)\b/.test(windowText)) {
      return true
    }
    index = normalizedMessage.indexOf(weekdayLabel, index + weekdayLabel.length)
  }
  return false
}

function buildOccupiedSlotSet(sessions: Session[], requestedWeekStart: string | undefined): Set<string> {
  const occupied = new Set<string>()
  if (!requestedWeekStart) return occupied
  for (const session of sessions) {
    if (session.status !== 'skipped' && isDateInWeek(session.date, requestedWeekStart)) {
      occupied.add(`${session.date}|${session.timeBlock}`)
    }
  }
  return occupied
}

function removeCollidingAddSessionActions(
  actions: CoachAction[],
  sessions: Session[],
): { actions: CoachAction[]; removedCollidingAddSessionCount: number } {
  const occupiedSlots = new Set(
    sessions
      .filter((session) => session.status !== 'skipped')
      .map((session) => `${session.date}|${session.timeBlock}`),
  )
  const safeActions: CoachAction[] = []
  let removedCollidingAddSessionCount = 0

  for (const action of actions) {
    if (action.type !== 'add_session' || !action.targetDate || !action.timeBlock) {
      safeActions.push(action)
      continue
    }

    const slotKey = `${action.targetDate}|${action.timeBlock}`
    if (occupiedSlots.has(slotKey)) {
      removedCollidingAddSessionCount += 1
      continue
    }

    occupiedSlots.add(slotKey)
    safeActions.push(action)
  }

  return { actions: safeActions, removedCollidingAddSessionCount }
}

function findAvailableDateInRequestedWeek(
  requestedWeekStart: string,
  originalDate: string | undefined,
  preferredBlock: TimeBlock | undefined,
  restOffsets: Set<number>,
  occupiedSlots: Set<string>,
  options: { requireEntireFreeDay?: boolean } = {},
): { date: string; timeBlock?: TimeBlock } | undefined {
  const originalOffset = originalDate && isValidISODate(originalDate) ? getWeekdayOffset(originalDate) : undefined
  const candidateOffsets = [
    ...(originalOffset != null && !restOffsets.has(originalOffset) ? [originalOffset] : []),
    ...Array.from({ length: 7 }, (_, offset) => offset).filter((offset) => offset !== originalOffset && !restOffsets.has(offset)),
  ]
  const blockCandidates = preferredBlock ? [preferredBlock, preferredBlock === 'AM' ? 'PM' : 'AM'] as TimeBlock[] : [undefined]

  for (const offset of candidateOffsets) {
    const date = addDaysToISO(requestedWeekStart, offset)
    if (options.requireEntireFreeDay && !isEntireDayFree(date, occupiedSlots)) continue
    for (const block of blockCandidates) {
      if (!block || !occupiedSlots.has(`${date}|${block}`)) {
        return { date, timeBlock: block }
      }
    }
  }

  return undefined
}

function isDateInWeek(date: string, weekStart: string): boolean {
  if (!isValidISODate(date)) return false
  return date >= weekStart && date <= addDaysToISO(weekStart, 6)
}

function getWeekdayOffset(date: string): number {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return (weekday + 6) % 7
}

function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

function findAffectedSession(
  context: ChatContext,
  normalizedMessage: string,
  resolvedDate: string | undefined,
): Session | undefined {
  const sessions = getContextSessions(context)
  const byId = sessions.find((session) => normalizedMessage.includes(session.id.slice(0, 8).toLowerCase()))
  if (byId) return byId

  if (!resolvedDate) return undefined
  const timeBlock = resolveTimeBlock(normalizedMessage)
  const candidates = sessions.filter((session) => {
    if (session.date !== resolvedDate) return false
    if (timeBlock && session.timeBlock !== timeBlock) return false
    return session.status !== 'skipped'
  })

  return candidates.length === 1 ? candidates[0] : undefined
}

function getContextSessions(context: ChatContext): Session[] {
  const merged = new Map<string, Session>()
  for (const session of context.recentSessions ?? []) merged.set(session.id, session)
  for (const session of context.plannedSessions ?? []) merged.set(session.id, session)
  for (const session of context.historicalSessions ?? []) merged.set(session.id, session)
  return [...merged.values()]
}

function findSessionByIdOrPrefix(sessionIdOrPrefix: string | undefined, sessions: Session[]): Session | undefined {
  if (!sessionIdOrPrefix || sessionIdOrPrefix === 'ID_DE_8_CHARS') return undefined
  const exact = sessions.find((session) => session.id === sessionIdOrPrefix)
  if (exact) return exact
  const matches = sessions.filter((session) => session.id.startsWith(sessionIdOrPrefix))
  return matches.length === 1 ? matches[0] : undefined
}

function resolvesKnownSession(sessionIdOrPrefix: string | undefined, sessions: Session[]): boolean {
  if (!sessionIdOrPrefix) return false
  if (sessionIdOrPrefix === 'ID_DE_8_CHARS') return false
  if (sessions.some((session) => session.id === sessionIdOrPrefix)) return true
  return sessions.filter((session) => session.id.startsWith(sessionIdOrPrefix)).length === 1
}

function resolveTimeBlock(normalizedMessage: string): TimeBlock | undefined {
  if (/\bpm\b/.test(normalizedMessage) || normalizedMessage.includes(' tarde')) return 'PM'
  if (/\bam\b/.test(normalizedMessage) || /\b(por|en)\s+la\s+manana\b/.test(normalizedMessage)) return 'AM'
  return undefined
}

function isExistingSessionAdjustment(normalizedMessage: string): boolean {
  return /\b(ajusta|ajustar|ajustame|cambia|cambiar|cambiame|modifica|modificar|actualiza|actualizar|reemplaza|reemplazar|edita|editar|baja|sube|mejora|hazla|hacerla)\b/.test(normalizedMessage)
}

function addDaysToISO(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function getWeekStartISO(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const offset = (date.getDay() + 6) % 7
  return addDaysToISO(isoDate, -offset)
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\ba\s*hoy\b/g, 'hoy')
    .replace(/\bahoy\b/g, 'hoy')
    .replace(/\bmanan[ao]\b/g, 'manana')
}
