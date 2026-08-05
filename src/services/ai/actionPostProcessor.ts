import type { ChatContext, CoachAction, CoachExerciseProposal, Session, SessionType, StrengthProfile, TimeBlock } from '../../types'
import { currentWeekStartISO, todayISO } from '../../utils/date'
import { resolveStrengthExercise } from '../training/exerciseLibrary'
import {
  getStrengthExerciseKey,
  toStrengthProposalForEnhancement,
} from '../training/strengthExerciseProposal'
import { getTargetExerciseDensity, selectStrengthSession, type StrengthContext, type StrengthPhase, type StrengthSportProfile } from '../training/strengthSelector'
import { enhanceStrengthSessionExercises, resolveStrengthExerciseBlock } from '../training/strengthSessionStructure'
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
const WEEKDAY_REFERENCE_PATTERN = /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/
const SESSION_TARGET_PATTERN = /\b(sesion|sesiones|entreno|entrenamiento|fuerza|pesas|gym|gimnasio|strength|running|correr|corrida|trote|squash|cycling|ciclismo|bici|bicicleta|movilidad|mobility|recovery|recuperacion)\b/
const CREATE_SESSION_INTENT_PATTERN = /\b(crea(?:r|me)?|crear|genera(?:r|me)?|generar|haz(?:me)?|hacer|arma(?:me)?|programa(?:me)?|agenda(?:me)?|agrega(?:me)?|agregar|pon(?:me)?|poner|dame|entrega(?:me)?|realiza(?:r)?|deja|incorpora)\b/
const ACTION_VERB_PATTERN = /\b(ajusta(?:r|me)?|cambia(?:r|me)?|modifica(?:r|me)?|mueve(?:me)?|mover|pasa(?:r|me)?|reprograma(?:r|me)?|reordena(?:r|me)?|actualiza(?:r|me)?|quit(?:a|ar|ame)|borra(?:r|me)?|elimina(?:r|me)?|saca(?:r|me)?|pon(?:er|me)?|agrega(?:r|me)?|reemplaza(?:r|me)?|reduce|baja|sube|incorpora|programa(?:me)?|agenda(?:me)?)\b/
const MOVE_SESSION_INTENT_PATTERN = /\b(mueve(?:me)?|mover|pasa(?:r|me)?|reprograma(?:r|me)?|reordena(?:r|me)?)\b/
const ZONE_2_PATTERN = /\b(z2|zona\s*2|zona\s+dos|aerobico|aerobica)\b/

export function postProcessCoachActions(
  response: CoachNormalizedResponse,
  context: ChatContext,
  userMessage: string,
): CoachNormalizedResponse {
  if (response.requestClass !== 'chat_action') return response

  const normalizedMessage = normalizeText(userMessage)
  const hasMultipleTemporalTargets = hasMultipleExplicitTemporalTargets(normalizedMessage)
  const inheritsRecentActionContext = shouldInheritRecentActionContext(normalizedMessage, context)
  const actionIntentText = inheritsRecentActionContext
    ? buildRecentActionIntentText(normalizedMessage, context)
    : normalizedMessage
  const requestedWeekStart = resolveRequestedWeekStart(actionIntentText, context)
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

  const alignedActions = sourceActions.map((action) => {
    const dateAligned = resolvedDate ? alignActionDate(action, resolvedDate) : action
    const weekAligned = alignmentWeekStart
      ? alignActionToRequestedWeek(dateAligned, alignmentWeekStart, restOffsets, occupiedSlots, { lockDate: Boolean(resolvedDate) })
      : dateAligned
    const requestAligned = alignSingleSessionSportToRequest(weekAligned, normalizedMessage, context)
    const runningAligned = completeRunningZone2Details(requestAligned, actionIntentText)
    const loadAligned = completeStrengthLoads(runningAligned, context)

    if (loadAligned.type === 'add_session' && adjustmentIntent && affectedSession) {
      return convertAddSessionToUpdateSession(loadAligned, affectedSession)
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
      sessionActionsWithId.includes(loadAligned.type) &&
      affectedSession &&
      !resolvesKnownSession(loadAligned.sessionId, sessions)
    ) {
      return { ...loadAligned, sessionId: affectedSession.id }
    }

    return loadAligned
  })
  const { actions, removedCollidingAddSessionCount } = removeCollidingAddSessionActions(alignedActions, sessions)
  const baseMessage = repairedReplacementAction
    ? buildRunningReplacementMessage(repairedReplacementAction)
    : response.actions?.length && !repairedMissingRequestedActions
      && !repairedRequestedMoves
      ? response.message
      : buildFallbackActionMessage(actions, response.message)
  const message = removedCollidingAddSessionCount > 0
    ? `${baseMessage}\n\nNo agregué ${removedCollidingAddSessionCount === 1 ? 'una sesión' : `${removedCollidingAddSessionCount} sesiones`} porque el bloque ya estaba ocupado.`
    : baseMessage

  return {
    ...response,
    actions,
    message,
    fallbackUsed: response.fallbackUsed || !response.actions?.length || Boolean(repairedReplacementAction) || repairedMissingRequestedActions || repairedRequestedMoves || removedCollidingAddSessionCount > 0,
    meta: response.actions?.length && !repairedReplacementAction && !repairedMissingRequestedActions && !repairedRequestedMoves && removedCollidingAddSessionCount === 0
      ? response.meta
      : {
          ...response.meta,
          hadActionsMarkup: response.meta?.hadActionsMarkup ?? false,
          actionParseFailed: false,
          likelyTruncated: false,
          warnings: [
            ...(response.meta?.warnings ?? []),
            repairedReplacementAction
              ? 'chat_action_delete_only_repaired_to_running_replacement'
              : repairedRequestedMoves
                ? 'chat_action_move_sessions_reconciled'
                : repairedMissingRequestedActions
                  ? 'chat_action_missing_requested_sessions_repaired'
                  : removedCollidingAddSessionCount > 0
                    ? 'chat_action_occupied_slot_actions_removed'
                    : 'chat_action_without_actions_repaired',
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
    && /\b(si|sí|ok|okay|dale|confirmo|correcto|hazlo|hacelo|aplicalo|aplica|realiza(?:r)?(?:\s+el)?\s+cambio|procede|adelante)\b/.test(normalizedMessage)
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
    const selection = selectStrengthSession(buildStrengthSelectionContextForAction(options.context, durationMin, objective))
    action.exercises = selection.exercises.map(toStrengthProposalForEnhancement)
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

function completeStrengthLoads(action: CoachAction, context: ChatContext): CoachAction {
  const profile = context.athleteProfile?.strengthProfile
  if ((action.type === 'add_session' || action.type === 'update_session') && action.exercises) {
    const shouldDensify = action.type === 'add_session'
      ? action.sessionType === 'strength'
      : action.newType === 'strength' || action.exercises.some((exercise) => resolveStrengthExercise(exercise)?.definition)
    return {
      ...action,
      exercises: shouldDensify
        ? enrichStrengthExercises(action.exercises, {
            durationMin: action.type === 'add_session' ? action.durationMin : action.newDurationMin,
            strengthProfile: profile,
            context,
            objective: action.type === 'add_session' ? action.objective : action.newObjective,
          })
        : action.exercises,
    }
  }

  if (action.type === 'create_week' && action.sessions) {
    return {
      ...action,
      sessions: action.sessions.map((session) => (
        session.sessionType === 'strength' && session.exercises
          ? {
              ...session,
              exercises: enrichStrengthExercises(session.exercises, {
                durationMin: session.durationMin,
                strengthProfile: profile,
                context,
                objective: session.objective,
              }),
            }
          : session
      )),
    }
  }

  return action
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
    const selection = selectStrengthSession(buildStrengthSelectionContextForAction(
      context,
      next.durationMin,
      next.objective,
    ))
    next.rpe = action.rpe ?? 7
    next.exercises = selection.exercises.map(toStrengthProposalForEnhancement)
  }

  return next
}

function enrichStrengthExercises(
  exercises: CoachExerciseProposal[],
  options: {
    durationMin?: number
    strengthProfile?: StrengthProfile
    context: ChatContext
    objective?: string
  },
): CoachExerciseProposal[] | undefined {
  const enhanced = enhanceStrengthSessionExercises(exercises, {
    durationMin: options.durationMin,
    strengthProfile: options.strengthProfile,
  })
  if (!enhanced || enhanced.length === 0) return enhanced

  const selectionContext = buildStrengthSelectionContextForAction(options.context, options.durationMin, options.objective)
  const density = getTargetExerciseDensity(selectionContext)
  if (enhanced.length >= density.target) return enhanced

  const existingKeys = new Set(enhanced.map(getStrengthExerciseKey))
  const additions: CoachExerciseProposal[] = []
  const candidates = selectStrengthSession(selectionContext).exercises
    .map(toStrengthProposalForEnhancement)
    .filter((exercise) => !existingKeys.has(getStrengthExerciseKey(exercise)))

  const minimumStrengthWork = getMinimumStrengthWorkCount(options.durationMin ?? 50)
  let strengthWorkCount = enhanced.filter(isStrengthWorkExercise).length

  for (const candidate of candidates) {
    if (enhanced.length + additions.length >= density.target) break
    if (!isStrengthWorkExercise(candidate)) continue
    additions.push(candidate)
    existingKeys.add(getStrengthExerciseKey(candidate))
    strengthWorkCount++
    if (strengthWorkCount >= minimumStrengthWork) break
  }

  for (const candidate of candidates) {
    if (enhanced.length + additions.length >= density.target) break
    const key = getStrengthExerciseKey(candidate)
    if (existingKeys.has(key)) continue
    additions.push(candidate)
    existingKeys.add(key)
  }

  if (additions.length === 0) return enhanced

  return enhanceStrengthSessionExercises([...enhanced, ...additions], {
    durationMin: options.durationMin,
    strengthProfile: options.strengthProfile,
  })
}

function buildStrengthSelectionContextForAction(
  context: ChatContext,
  durationMin?: number,
  objective?: string,
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
  }
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

function getMinimumStrengthWorkCount(durationMin: number): number {
  if (durationMin >= 70) return 5
  if (durationMin >= 55) return 4
  if (durationMin >= 45) return 3
  return 2
}

function isStrengthWorkExercise(exercise: CoachExerciseProposal): boolean {
  const block = resolveStrengthExerciseBlock(exercise)
  return block !== 'core' && block !== 'cardio' && block !== 'mobility'
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
  options: { lockDate?: boolean } = {},
): CoachAction {
  if (action.type !== 'add_session' && action.type !== 'move_session' && action.type !== 'insert_recovery') {
    return action
  }

  const targetDate = action.targetDate
  const timeBlock = action.type === 'add_session' ? action.timeBlock : undefined
  if (options.lockDate && targetDate && isDateInWeek(targetDate, requestedWeekStart)) {
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
  )
  if (!replacement) return action

  if (replacement.timeBlock) occupiedSlots.add(`${replacement.date}|${replacement.timeBlock}`)
  return action.type === 'add_session' && replacement.timeBlock
    ? { ...action, targetDate: replacement.date, timeBlock: replacement.timeBlock }
    : { ...action, targetDate: replacement.date }
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
    if (isDateInWeek(session.date, requestedWeekStart)) {
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
): { date: string; timeBlock?: TimeBlock } | undefined {
  const originalOffset = originalDate && isValidISODate(originalDate) ? getWeekdayOffset(originalDate) : undefined
  const candidateOffsets = [
    ...(originalOffset != null && !restOffsets.has(originalOffset) ? [originalOffset] : []),
    ...Array.from({ length: 7 }, (_, offset) => offset).filter((offset) => offset !== originalOffset && !restOffsets.has(offset)),
  ]
  const blockCandidates = preferredBlock ? [preferredBlock, preferredBlock === 'AM' ? 'PM' : 'AM'] as TimeBlock[] : [undefined]

  for (const offset of candidateOffsets) {
    const date = addDaysToISO(requestedWeekStart, offset)
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
