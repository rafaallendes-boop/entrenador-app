import type { CoachAction, CoachActionType, CoachExerciseProposal, CoachSessionProposal, CyclingDetails, GeneratedProtocol, MobilityDetails, RunningIntervalStructure, RunningType, SessionType, SquashDetails, SquashDrill, SquashDrillExecutionMode, SquashSessionBlock, SquashSessionBlockKind, SquashSessionKind, SquashSessionMode, SquashSubtype, SquashTrainingFocus, TimeBlock, WarmupSet } from '../../types'
import type { AIRawResponse, CoachNormalizedResponse, CreateWeekNormalizationDiagnostic } from './types'
import {
  findSquashDrillByName,
  isSquashMatchDrill,
  orderSquashBlocksForSession,
  orderSquashDrillsForSession,
  toSquashDrill,
} from '../training/drillLibrary'
import { normalizeStrengthSessionExercises } from '../training/strengthSessionStructure'
import { normalizeMobilityDetails } from '../training/mobilitySessionLibrary'

const ACTIONS_BLOCK_RE = /<actions>([\s\S]*?)<\/actions>/i
const ACTIONS_START_RE = /<actions>/i
const INTERNAL_SESSION_REF_RE = /\s*\[([a-z0-9_-]{6,12})\]/gi

const VALID_ACTION_TYPES = new Set<CoachActionType>([
  'skip_session',
  'change_rpe',
  'shorten_session',
  'lengthen_session',
  'move_session',
  'replace_session_type',
  'insert_recovery',
  'add_session',
  'create_week',
  'delete_session',
  'update_session',
])

const VALID_SESSION_TYPES = new Set(['squash', 'running', 'cycling', 'strength', 'mobility', 'recovery', 'nutrition'])
const VALID_TIME_BLOCKS = new Set<TimeBlock>(['AM', 'PM'])
const VALID_SQUASH_SUBTYPES = new Set<SquashSubtype>(['control', 'training', 'match', 'competitive', 'light'])
const VALID_RUNNING_TYPES = new Set<RunningType>(['z2', 'tempo', 'intervals', 'long'])
const VALID_SQUASH_SESSION_MODES = new Set<SquashSessionMode>(['drill_session', 'practice_match', 'competition_match'])
const VALID_SQUASH_SESSION_KINDS = new Set<SquashSessionKind>(['technical', 'control', 'shadows', 'match', 'mixed'])
const VALID_SQUASH_BLOCK_KINDS = new Set<SquashSessionBlockKind>(['technical', 'control', 'shadows', 'match'])
const VALID_SQUASH_EXECUTION_MODES = new Set<SquashDrillExecutionMode>(['solo', 'partner', 'either', 'match'])
const VALID_SQUASH_TRAINING_FOCUS = new Set(['technical', 'tactical', 'physical', 'conditioned_games'])
const VALID_MOBILITY_CONTEXTS = new Set(['post_run', 'post_cycling', 'post_squash', 'post_strength', 'pre_training_activation', 'recovery', 'full_body', 'sport_specific'])
const DEFAULT_SESSION_DURATION_MIN: Partial<Record<CoachSessionProposal['sessionType'], number>> = {
  squash: 60,
  running: 45,
  strength: 60,
  mobility: 30,
  cycling: 60,
  recovery: 30,
}

export type SessionProposalDraftDateField = 'date' | 'targetDate'

export type NormalizeSessionProposalDraftResult =
  | { session: CoachSessionProposal; repairs: string[] }
  | { droppedReason: string }

export function normalizeSessionProposalDraft(
  value: unknown,
  options: { dateField?: SessionProposalDraftDateField; reason?: string } = {},
): NormalizeSessionProposalDraftResult {
  if (!value || typeof value !== 'object') return { droppedReason: 'not-object' }

  const dateField = options.dateField ?? 'date'
  const record = value as Record<string, unknown>
  const rawDate = record[dateField]
  if (!isValidDate(rawDate)) {
    return { droppedReason: typeof rawDate === 'string' ? `invalid-${dateField}` : `missing-${dateField}` }
  }
  const sessionType = normalizeSessionTypeDraft(record.sessionType)
  if (!sessionType) {
    return { droppedReason: record.sessionType == null ? 'missing-sessionType' : 'invalid-sessionType' }
  }
  if (typeof record.title !== 'string' || !record.title.trim()) {
    return { droppedReason: 'missing-title' }
  }

  const repairs: string[] = []
  if (record.sessionType !== sessionType) repairs.push('sessionType')
  const title = record.title.trim()
  const defaultDurationMin = DEFAULT_SESSION_DURATION_MIN[sessionType]
  const durationMin = typeof record.durationMin === 'number' && record.durationMin >= 5
    ? record.durationMin
    : record.durationMin == null && defaultDurationMin != null
      ? defaultDurationMin
      : undefined
  if (durationMin == null) return { droppedReason: 'invalid-durationMin' }
  if (record.durationMin == null) repairs.push('durationMin')

  const timeBlock = isTimeBlock(record.timeBlock) ? record.timeBlock : record.timeBlock == null ? 'PM' : undefined
  if (timeBlock == null) return { droppedReason: 'invalid-timeBlock' }
  if (record.timeBlock == null) repairs.push('timeBlock')

  const objective = typeof record.objective === 'string' && record.objective.trim()
    ? record.objective.trim()
    : options.reason?.trim() || title
  if (typeof record.objective !== 'string' || !record.objective.trim()) repairs.push('objective')

  const session: CoachSessionProposal = {
    date: rawDate,
    timeBlock,
    sessionType,
    title,
    durationMin,
    objective,
  }

  if (isRpe(record.rpe)) session.rpe = record.rpe
  const inferredSubtype = inferSquashSubtype(record.sessionType)
  if (isSquashSubtype(record.subtype)) session.subtype = record.subtype
  else if (sessionType === 'squash' && inferredSubtype) {
    session.subtype = inferredSubtype
    repairs.push('subtype')
  }
  if (isRunningType(record.runningType)) session.runningType = record.runningType
  if (typeof record.targetPaceMin === 'string') session.targetPaceMin = record.targetPaceMin
  if (typeof record.targetPaceMax === 'string') session.targetPaceMax = record.targetPaceMax
  if (typeof record.targetHrMin === 'number') session.targetHrMin = record.targetHrMin
  if (typeof record.targetHrMax === 'number') session.targetHrMax = record.targetHrMax
  if (isRunningIntervalStructure(record.intervalStructure)) session.intervalStructure = record.intervalStructure
  if (Array.isArray(record.exercises)) {
    const exercises = record.exercises
      .map(validateExerciseProposal)
      .filter((item): item is CoachExerciseProposal => item != null)
    session.exercises = sessionType === 'strength'
      ? normalizeStrengthSessionExercises(exercises, { durationMin })
      : exercises
  }
  if (isGeneratedProtocol(record.warmup)) session.warmup = record.warmup
  if (isGeneratedProtocol(record.cooldown)) session.cooldown = record.cooldown
  if (isCyclingDetails(record.cyclingDetails)) session.cyclingDetails = record.cyclingDetails
  if (isMobilityDetails(record.mobilityDetails)) session.mobilityDetails = normalizeMobilityDetails(record.mobilityDetails)

  if (sessionType === 'squash') {
    const squashDetails = normalizeSquashDetailsDraft(record.squashDetails)
    if (squashDetails) {
      session.squashDetails = squashDetails.details
      repairs.push(...squashDetails.repairs)
    } else {
      // squashDetails ausente o irreparable: degradar a un detalle mínimo en vez de
      // descartar la sesión completa; repairWeek la densifica después.
      repairs.push('squashDetails')
      session.squashDetails = {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: title, durationMin }],
      }
    }
  }

  return { session, repairs }
}

export function normalizeResponse(raw: AIRawResponse): CoachNormalizedResponse {
  const requestClass = raw.requestClass ?? 'chat_general'
  let message = raw.text.replace(
    /```[a-z]*\n?(<actions>[\s\S]*?<\/actions>)\n?```/gi,
    '$1',
  )
  message = unwrapJsonCodeFence(message)
  message = message.replace(/```[a-z]*\n?\s*\n?```/g, '')

  let actions: CoachAction[] | undefined
  let actionParseFailed = false
  let hadActionsMarkup = false
  let likelyTruncated = raw.truncated === true || isMaxTokenFinishReason(raw.finishReason)
  let invalidActionCount = 0
  let createWeekDiagnostics: CreateWeekNormalizationDiagnostic[] = []
  const extraction = extractActionsText(message)
  if (extraction) {
    hadActionsMarkup = true
    const parseResult = parseActionsBlock(extraction.actionsText)
    actions = parseResult.actions
    actionParseFailed = parseResult.parseFailed
    likelyTruncated = extraction.openOnly || parseResult.likelyTruncated
    invalidActionCount = parseResult.invalidActionCount
    createWeekDiagnostics = parseResult.createWeekDiagnostics
    message = extraction.messageWithoutActions
  } else {
    const inlineJson = extractInlineActionsJson(message)
    if (inlineJson) {
      const parseResult = parseActionsBlock(inlineJson.actionsText)
      actions = parseResult.actions
      actionParseFailed = parseResult.parseFailed
      likelyTruncated = parseResult.likelyTruncated
      invalidActionCount = parseResult.invalidActionCount
      createWeekDiagnostics = parseResult.createWeekDiagnostics
      if (parseResult.actions.length > 0) {
        message = inlineJson.messageWithoutActions
      }
    } else {
      const wholeJson = extractWholeResponseActionsJson(message, requestClass)
      if (wholeJson) {
        const parseResult = parseActionsBlock(wholeJson.actionsText)
        actions = parseResult.actions
        actionParseFailed = parseResult.parseFailed
        likelyTruncated = parseResult.likelyTruncated
        invalidActionCount = parseResult.invalidActionCount
        createWeekDiagnostics = parseResult.createWeekDiagnostics
        if (parseResult.actions.length > 0 || parseResult.parseFailed) {
          message = wholeJson.messageWithoutActions
        }
      }
    }
  }

  if (requestClass === 'chat_action' && actions?.length) {
    const nextActions = actions.filter((action) => action.type !== 'create_week')
    invalidActionCount += actions.length - nextActions.length
    if (actions.length > 0 && nextActions.length === 0) {
      actionParseFailed = true
      likelyTruncated = true
    }
    actions = nextActions
  }

  message = sanitizeVisibleCoachMessage(message.replace(/\n{3,}/g, '\n\n'))

  if (requestClass === 'chat_action' && actions?.length && !message) {
    message = 'Te propongo este cambio:'
  }

  const outcome = classifyOutcome({
    hadActionsMarkup,
    actionParseFailed,
    likelyTruncated,
    actionsCount: actions?.length ?? 0,
    messageLength: message.length,
  })
  const warnings = collectNormalizationWarnings(actions)

  return {
    message,
    actions: actions && actions.length > 0 ? actions : undefined,
    provider: raw.provider,
    model: raw.model,
    raw: raw.raw,
    timestamp: Date.now(),
    durationMs: raw.durationMs,
    traceId: raw.traceId ?? 'legacy-trace',
    generationId: raw.generationId,
    requestClass,
    retryUsed: raw.retryUsed,
    fallbackUsed: raw.fallbackUsed,
    finishReason: raw.finishReason,
    promptTokens: raw.promptTokens,
    completionTokens: raw.completionTokens,
    reasoningTokens: raw.reasoningTokens,
    cacheCreationInputTokens: raw.cacheCreationInputTokens,
    cacheReadInputTokens: raw.cacheReadInputTokens,
    serviceTier: raw.serviceTier,
    reasoningEffort: raw.reasoningEffort,
    serverDurationMs: raw.serverDurationMs,
    authDurationMs: raw.authDurationMs,
    meta: {
      hadActionsMarkup,
      actionParseFailed,
      likelyTruncated,
      invalidActionCount,
      createWeekDiagnostics,
      outcome,
      warnings,
      errorClass: raw.errorClass,
    },
  }
}

function sanitizeVisibleCoachMessage(message: string): string {
  return message
    .replace(INTERNAL_SESSION_REF_RE, (match, token: string) => {
      return /\d|[_-]/.test(token) ? '' : match
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

function isMaxTokenFinishReason(finishReason: string | undefined): boolean {
  if (!finishReason) return false
  const normalized = finishReason.toLowerCase()
  return normalized === 'max_tokens' ||
    normalized === 'max_output_tokens' ||
    normalized === 'length' ||
    normalized.includes('max_token')
}

function classifyOutcome(input: {
  hadActionsMarkup: boolean
  actionParseFailed: boolean
  likelyTruncated: boolean
  actionsCount: number
  messageLength: number
}): 'ok' | 'truncated_mid' | 'truncated_early' | 'parse_invalid' | 'schema_invalid' {
  // Cleanly parsed text with usable content (text and/or actions).
  if (!input.actionParseFailed && !input.likelyTruncated) {
    return 'ok'
  }

  // Truncation takes precedence over parse_invalid when the actions block
  // opened: a JSON parse failure inside an unclosed/cut block is almost
  // always caused by the cut itself, not a malformed schema.
  if (input.hadActionsMarkup && input.likelyTruncated) {
    if (input.actionsCount > 0) return 'truncated_mid'
    return 'truncated_early'
  }

  // Markup did not open (or did open and closed) but JSON failed to parse.
  if (input.actionParseFailed && !input.hadActionsMarkup) {
    return 'schema_invalid'
  }
  if (input.actionParseFailed) {
    return 'parse_invalid'
  }

  // Truncated text without actions markup is still readable text.
  if (input.likelyTruncated && input.messageLength > 0) {
    return 'ok'
  }

  return 'ok'
}

function parseActionsBlock(jsonText: string): {
  actions: CoachAction[]
  parseFailed: boolean
  likelyTruncated: boolean
  invalidActionCount: number
  createWeekDiagnostics: CreateWeekNormalizationDiagnostic[]
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText.trim())
  } catch {
    const recoveredCreateWeek = recoverPartialCreateWeekActions(jsonText)
    if (recoveredCreateWeek) return recoveredCreateWeek

    const fixedJson = extractJsonArray(jsonText)
    if (!fixedJson) {
      return {
        actions: [],
        parseFailed: true,
        likelyTruncated: isLikelyTruncatedJson(jsonText),
        invalidActionCount: 0,
        createWeekDiagnostics: [],
      }
    }
    try {
      parsed = JSON.parse(fixedJson)
    } catch {
      return {
        actions: [],
        parseFailed: true,
        likelyTruncated: isLikelyTruncatedJson(jsonText),
        invalidActionCount: 0,
        createWeekDiagnostics: [],
      }
    }
  }

  const actionCandidates = unwrapActionCandidates(parsed)
  if (!actionCandidates) {
    return {
      actions: [],
      parseFailed: true,
      likelyTruncated: isLikelyTruncatedJson(jsonText),
      invalidActionCount: 0,
      createWeekDiagnostics: [],
    }
  }

  const createWeekDiagnostics: CreateWeekNormalizationDiagnostic[] = []
  const actions = actionCandidates.reduce<CoachAction[]>((acc, item) => {
    const result = validateAction(item)
    if (result.action) acc.push(result.action)
    if (result.createWeekDiagnostic) createWeekDiagnostics.push(result.createWeekDiagnostic)
    return acc
  }, [])
  const invalidActionCount = actionCandidates.length - actions.length
  const droppedCreateWeekSessions = createWeekDiagnostics.some((diagnostic) => diagnostic.droppedSessions > 0)

  return {
    actions,
    parseFailed: actions.length === 0 && actionCandidates.length > 0,
    likelyTruncated: invalidActionCount > 0 || droppedCreateWeekSessions || isLikelyTruncatedJson(jsonText),
    invalidActionCount,
    createWeekDiagnostics,
  }
}

function recoverPartialCreateWeekActions(jsonText: string): {
  actions: CoachAction[]
  parseFailed: boolean
  likelyTruncated: boolean
  invalidActionCount: number
  createWeekDiagnostics: CreateWeekNormalizationDiagnostic[]
} | null {
  if (!/"type"\s*:\s*"create_week"/.test(jsonText)) return null
  if (!/"sessions"\s*:/.test(jsonText)) return null

  const sessionCandidates = extractCompleteObjectsFromArrayProperty(jsonText, 'sessions')
  if (sessionCandidates.length === 0) return null

  const rawSessions = sessionCandidates
    .map((candidate) => {
      try {
        return JSON.parse(candidate) as unknown
      } catch {
        return null
      }
    })
    .filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object' && !Array.isArray(candidate))

  if (rawSessions.length === 0) return null

  const recoveredAction = {
    type: 'create_week',
    reason: extractJsonStringProperty(jsonText, 'reason') ?? 'Semana recuperada desde respuesta parcial.',
    targetDate: extractJsonStringProperty(jsonText, 'targetDate'),
    weekObjectives: extractStringArrayProperty(jsonText, 'weekObjectives'),
    sessions: rawSessions,
  }

  const result = validateAction(recoveredAction)
  const actions = result.action ? [result.action] : []
  const diagnostics = result.createWeekDiagnostic ? [result.createWeekDiagnostic] : []
  return {
    actions,
    parseFailed: actions.length === 0,
    likelyTruncated: true,
    invalidActionCount: actions.length > 0 ? 0 : rawSessions.length,
    createWeekDiagnostics: diagnostics,
  }
}

function unwrapActionCandidates(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.actions)) return record.actions

    if (typeof record.type === 'string' && VALID_ACTION_TYPES.has(record.type as CoachActionType)) {
      return [record]
    }

    // Fallback: model may use "action" as discriminator instead of "type"
    if (typeof record.action === 'string' && VALID_ACTION_TYPES.has(record.action as CoachActionType)) {
      return [record]
    }

    const wrappedActions = unwrapNamedActionPayloads(record)
    if (wrappedActions.length > 0) return wrappedActions
  }

  return null
}

function unwrapNamedActionPayloads(record: Record<string, unknown>): unknown[] {
  const actions: unknown[] = []
  for (const actionType of VALID_ACTION_TYPES) {
    const payload = record[actionType]
    if (Array.isArray(payload)) {
      for (const item of payload) {
        if (item && typeof item === 'object') {
          actions.push({ ...(item as Record<string, unknown>), type: actionType })
        }
      }
      continue
    }
    if (payload && typeof payload === 'object') {
      actions.push({ ...(payload as Record<string, unknown>), type: actionType })
    }
  }
  return actions
}

function validateAction(obj: unknown): {
  action: CoachAction | null
  createWeekDiagnostic?: CreateWeekNormalizationDiagnostic
} {
  if (!obj || typeof obj !== 'object') return { action: null }
  const record = obj as Record<string, unknown>

  // Resolve type discriminator from "type" (canonical) or "action" (fallback for model drift)
  const type = typeof record.type === 'string' && VALID_ACTION_TYPES.has(record.type as CoachActionType)
    ? record.type as CoachActionType
    : typeof record.action === 'string' && VALID_ACTION_TYPES.has(record.action as CoachActionType)
      ? record.action as CoachActionType
      : null
  if (!type) return { action: null }
  if (typeof record.reason !== 'string' || !record.reason.trim()) return { action: null }
  const base = {
    type,
    reason: record.reason.trim(),
  } satisfies Pick<CoachAction, 'type' | 'reason'>
  const sessionId = getSessionId(record)

  switch (type) {
    case 'skip_session':
    case 'delete_session':
      return { action: sessionId ? { ...base, sessionId } : null }

    case 'replace_session_type':
      return {
        action: sessionId && isSessionType(record.newType)
          ? { ...base, sessionId, newType: record.newType }
          : null,
      }

    case 'change_rpe':
      return {
        action: sessionId && isRpe(record.newRpe)
          ? { ...base, sessionId, newRpe: record.newRpe }
          : null,
      }

    case 'shorten_session':
    case 'lengthen_session':
      return {
        action: sessionId && typeof record.newDurationMin === 'number' && record.newDurationMin >= 5
          ? { ...base, sessionId, newDurationMin: record.newDurationMin }
          : null,
      }

    case 'move_session':
      return {
        action: sessionId && isValidDate(record.targetDate)
          ? { ...base, sessionId, targetDate: record.targetDate }
          : null,
      }

    case 'insert_recovery':
      return {
        action: isValidDate(record.targetDate)
          ? { ...base, targetDate: record.targetDate }
          : null,
      }

    case 'add_session': {
      const result = normalizeSessionProposalDraft(record, { dateField: 'targetDate', reason: base.reason })
      if ('droppedReason' in result) {
        warnDroppedAddSession(mapAddSessionDropReason(result.droppedReason), record)
        return { action: null }
      }
      if (result.repairs.length > 0) warnRepairedAddSession(result.repairs, record)

      const action: CoachAction = {
        ...base,
        ...sessionProposalToActionFields(result.session),
      }
      return { action }
    }

    case 'create_week': {
      if (!Array.isArray(record.sessions) || record.sessions.length === 0) return { action: null }
      const rawSessions = record.sessions.length
      const repairedSessions: Array<{ index: number; repairs: string[] }> = []
      const droppedSessionReasons: Array<{ index: number; reason: string }> = []
      const sessions = record.sessions.reduce<CoachSessionProposal[]>((acc, item, index) => {
        const result = validateSessionProposal(item, base.reason)
        if ('session' in result) {
          acc.push(result.session)
          if (result.repairs.length > 0) repairedSessions.push({ index, repairs: result.repairs })
        } else {
          droppedSessionReasons.push({ index, reason: result.droppedReason })
        }
        return acc
      }, [])
      const createWeekDiagnostic: CreateWeekNormalizationDiagnostic = {
        targetDate: isValidDate(record.targetDate) ? record.targetDate : undefined,
        rawSessions,
        validSessions: sessions.length,
        droppedSessions: rawSessions - sessions.length,
        repairedSessions: repairedSessions.length > 0 ? repairedSessions : undefined,
        droppedSessionReasons: droppedSessionReasons.length > 0 ? droppedSessionReasons : undefined,
      }
      if (sessions.length === 0) return { action: null, createWeekDiagnostic }

      const action: CoachAction = {
        ...base,
        sessions,
      }
      if (isValidDate(record.targetDate)) {
        action.targetDate = record.targetDate
      }
      if (Array.isArray(record.weekObjectives)) {
        action.weekObjectives = record.weekObjectives.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
      return { action, createWeekDiagnostic }
    }

    case 'update_session': {
      if (!sessionId) return { action: null }
      const action: CoachAction = {
        ...base,
        sessionId,
      }
      if (typeof record.newTitle === 'string' && record.newTitle.trim()) action.newTitle = record.newTitle.trim()
      if (typeof record.newObjective === 'string' && record.newObjective.trim()) action.newObjective = record.newObjective.trim()
      if (isRpe(record.newRpe)) action.newRpe = record.newRpe
      if (typeof record.newDurationMin === 'number' && record.newDurationMin >= 5) action.newDurationMin = record.newDurationMin
      if (isSessionType(record.newType)) action.newType = record.newType
      if (isSquashSubtype(record.subtype)) action.subtype = record.subtype
      if (isRunningType(record.runningType)) action.runningType = record.runningType
      if (typeof record.targetPaceMin === 'string') action.targetPaceMin = record.targetPaceMin
      if (typeof record.targetPaceMax === 'string') action.targetPaceMax = record.targetPaceMax
      if (typeof record.targetHrMin === 'number') action.targetHrMin = record.targetHrMin
      if (typeof record.targetHrMax === 'number') action.targetHrMax = record.targetHrMax
      if (isRunningIntervalStructure(record.intervalStructure)) action.intervalStructure = record.intervalStructure
      if (Array.isArray(record.exercises)) {
        const exercises = record.exercises
          .map(validateExerciseProposal)
          .filter((item): item is CoachExerciseProposal => item != null)
        action.exercises = action.newType === 'strength'
          ? normalizeStrengthSessionExercises(exercises, { durationMin: action.newDurationMin })
          : exercises
      }
      if (isGeneratedProtocol(record.warmup)) action.warmup = record.warmup
      if (isGeneratedProtocol(record.cooldown)) action.cooldown = record.cooldown
      if (isCyclingDetails(record.cyclingDetails)) action.cyclingDetails = record.cyclingDetails
      if (isMobilityDetails(record.mobilityDetails)) action.mobilityDetails = normalizeMobilityDetails(record.mobilityDetails)
      const squashDetails = normalizeSquashDetailsDraft(record.squashDetails)
      if (squashDetails) action.squashDetails = squashDetails.details

      return { action: hasAnyUpdateField(action) ? action : null }
    }
  }
}

function sessionProposalToActionFields(session: CoachSessionProposal): Partial<CoachAction> {
  return {
    targetDate: session.date,
    sessionType: session.sessionType,
    title: session.title,
    durationMin: session.durationMin,
    timeBlock: session.timeBlock,
    objective: session.objective,
    rpe: session.rpe,
    subtype: session.subtype,
    runningType: session.runningType,
    targetPaceMin: session.targetPaceMin,
    targetPaceMax: session.targetPaceMax,
    targetHrMin: session.targetHrMin,
    targetHrMax: session.targetHrMax,
    intervalStructure: session.intervalStructure,
    cyclingDetails: session.cyclingDetails,
    exercises: session.exercises,
    mobilityDetails: session.mobilityDetails,
    squashDetails: session.squashDetails,
    warmup: session.warmup,
    cooldown: session.cooldown,
  }
}

function getSessionId(record: Record<string, unknown>): string | undefined {
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) return record.sessionId.trim()
  if (typeof record.session_id === 'string' && record.session_id.trim()) return record.session_id.trim()
  return undefined
}

function validateSessionProposal(value: unknown, reason?: string): NormalizeSessionProposalDraftResult {
  return normalizeSessionProposalDraft(value, { dateField: 'date', reason })
}

function validateExerciseProposal(value: unknown): CoachExerciseProposal | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || !record.name.trim()) return null
  if (typeof record.sets !== 'number' || record.sets < 1) return null
  if (typeof record.reps !== 'number' && typeof record.reps !== 'string') return null

  const exercise: CoachExerciseProposal = {
    name: record.name.trim(),
    sets: record.sets,
    reps: record.reps,
  }
  if (typeof record.weight === 'number') exercise.weight = record.weight
  if (typeof record.notes === 'string') exercise.notes = record.notes
  if (typeof record.group === 'string') exercise.group = record.group as CoachExerciseProposal['group']
  if (typeof record.mobilityFocus === 'string') exercise.mobilityFocus = record.mobilityFocus as CoachExerciseProposal['mobilityFocus']
  if (typeof record.targetPercent1RM === 'number' && record.targetPercent1RM > 0 && record.targetPercent1RM <= 100) {
    exercise.targetPercent1RM = record.targetPercent1RM
  }
  if (typeof record.targetRpe === 'number' && record.targetRpe >= 1 && record.targetRpe <= 10) {
    exercise.targetRpe = record.targetRpe
  }
  if (Array.isArray(record.warmupSets)) {
    const warmups = record.warmupSets
      .map((raw) => validateWarmupSet(raw))
      .filter((set): set is WarmupSet => set != null)
    if (warmups.length > 0) exercise.warmupSets = warmups
  }
  return exercise
}

function validateWarmupSet(value: unknown): WarmupSet | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.reps !== 'number' && typeof record.reps !== 'string') return null
  const set: WarmupSet = { reps: record.reps as number | string }
  if (typeof record.weight === 'number' && record.weight > 0) set.weight = record.weight
  if (typeof record.percent1RM === 'number' && record.percent1RM > 0 && record.percent1RM <= 100) set.percent1RM = record.percent1RM
  return set
}

function hasAnyUpdateField(action: CoachAction): boolean {
  return (
    action.newTitle != null ||
    action.newObjective != null ||
    action.newRpe != null ||
    action.newDurationMin != null ||
    action.newType != null ||
    action.subtype != null ||
    action.runningType != null ||
    action.targetPaceMin != null ||
    action.targetPaceMax != null ||
    action.targetHrMin != null ||
    action.targetHrMax != null ||
    action.intervalStructure != null ||
    action.exercises != null ||
    action.warmup != null ||
    action.cooldown != null ||
    action.cyclingDetails != null ||
    action.mobilityDetails != null ||
    action.squashDetails != null
  )
}

function collectNormalizationWarnings(actions: CoachAction[] | undefined): string[] | undefined {
  if (!actions?.length) return undefined

  const warnings = actions.flatMap((action) => {
    if (action.type === 'create_week') {
      return (action.sessions ?? []).flatMap(getStrengthDensityWarnings)
    }
    return getStrengthDensityWarnings(action)
  })

  return warnings.length > 0 ? [...new Set(warnings)] : undefined
}

function getStrengthDensityWarnings(item: {
  sessionType?: CoachSessionProposal['sessionType']
  newType?: CoachSessionProposal['sessionType']
  durationMin?: number
  newDurationMin?: number
  exercises?: CoachExerciseProposal[]
}): string[] {
  const sessionType = item.sessionType ?? item.newType
  if (sessionType !== 'strength') return []

  const durationMin = item.durationMin ?? item.newDurationMin
  if (durationMin == null || durationMin < 50 || durationMin > 60) return []

  const exerciseCount = item.exercises?.length ?? 0
  const minExpected = getMinimumStrengthExerciseCount(durationMin)
  if (exerciseCount === 0) return []  // empty exercises will be filled by repair; not a density issue
  if (exerciseCount >= minExpected) return []

  return [`low_density:strength:${durationMin}min:${exerciseCount}/${minExpected}`]
}

function getMinimumStrengthExerciseCount(durationMin: number): number {
  if (durationMin <= 30) return 3
  if (durationMin <= 44) return 4
  if (durationMin <= 54) return 4
  if (durationMin <= 69) return 5
  return 6
}

function isGeneratedProtocol(value: unknown): value is GeneratedProtocol {
  if (value == null) return false
  if (typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.title === 'string' &&
    typeof record.durationMin === 'number' &&
    typeof record.note === 'string' &&
    typeof record.tone === 'string' &&
    Array.isArray(record.steps) &&
    (record.source === 'base' || record.source === 'adapted')
  )
}

function isRunningIntervalStructure(value: unknown): value is RunningIntervalStructure {
  if (value == null) return false
  if (typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.blocks)
}

function isCyclingDetails(value: unknown): value is CyclingDetails {
  if (value == null) return false
  if (typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.sessionCategory === 'string' && typeof record.targetStructure === 'string'
}

function isMobilityDetails(value: unknown): value is MobilityDetails {
  if (value == null) return false
  if (typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.focusAreas) &&
    typeof record.targetStructure === 'string' &&
    typeof record.context === 'string' &&
    VALID_MOBILITY_CONTEXTS.has(record.context)
  )
}

const SQUASH_TRAINING_FOCUS_SYNONYMS: Record<string, SquashTrainingFocus> = {
  control: 'technical',
  precision: 'technical',
  technique: 'technical',
  shadows: 'physical',
  ghosting: 'physical',
  movement: 'physical',
  conditioning: 'physical',
  fitness: 'physical',
  match: 'conditioned_games',
  match_play: 'conditioned_games',
  matchplay: 'conditioned_games',
  competitive: 'conditioned_games',
  game: 'conditioned_games',
  games: 'conditioned_games',
  pressure: 'tactical',
  strategy: 'tactical',
  strategic: 'tactical',
}

function coerceSquashTrainingFocus(value: unknown): { focus: SquashTrainingFocus; repaired: boolean } {
  if (typeof value === 'string') {
    if (VALID_SQUASH_TRAINING_FOCUS.has(value)) {
      return { focus: value as SquashTrainingFocus, repaired: false }
    }
    const synonym = SQUASH_TRAINING_FOCUS_SYNONYMS[value.trim().toLowerCase()]
    if (synonym) return { focus: synonym, repaired: true }
  }
  return { focus: 'technical', repaired: true }
}

function coerceSquashSessionMode(
  value: unknown,
  sessionKind: SquashSessionKind | undefined,
): { mode: SquashSessionMode | undefined; repaired: boolean } {
  if (value == null) return { mode: undefined, repaired: false }
  if (typeof value === 'string' && VALID_SQUASH_SESSION_MODES.has(value as SquashSessionMode)) {
    return { mode: value as SquashSessionMode, repaired: false }
  }
  // Valor inventado por el modelo: degradar a un modo coherente en vez de descartar la sesión.
  return { mode: sessionKind === 'match' ? 'practice_match' : 'drill_session', repaired: true }
}

function normalizeSquashDetailsDraft(value: unknown): { details: SquashDetails; repairs: string[] } | null {
  if (value == null) return null
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const repairs: string[] = []

  const { focus, repaired: focusRepaired } = coerceSquashTrainingFocus(record.trainingFocus)
  if (focusRepaired) repairs.push('squashDetails.trainingFocus')

  const sessionKind =
    typeof record.sessionKind === 'string' && VALID_SQUASH_SESSION_KINDS.has(record.sessionKind as SquashSessionKind)
      ? (record.sessionKind as SquashSessionKind)
      : undefined
  if (record.sessionKind != null && !sessionKind) repairs.push('squashDetails.sessionKind')

  const { mode, repaired: modeRepaired } = coerceSquashSessionMode(record.sessionMode, sessionKind)
  if (modeRepaired) repairs.push('squashDetails.sessionMode')

  const drills = normalizeSquashDrillsDraft(record.drills)
  const blocks = record.blocks == null ? undefined : (normalizeSquashBlocksDraft(record.blocks) ?? undefined)
  if (record.blocks != null && !blocks) repairs.push('squashDetails.blocks')

  const finalDrills = drills ?? (blocks ? blocks.flatMap((block) => block.drills) : null)
  if (!finalDrills || finalDrills.length === 0) return null
  if (!drills && blocks) repairs.push('squashDetails.drills')

  const dedicatedMatchContent = blocks?.length
    ? blocks.every((block) => block.kind === 'match')
    : finalDrills.every((drill) => {
        const definition = findSquashDrillByName(drill.name)
        return definition ? isSquashMatchDrill(definition) : /\b(match|partido)\b/i.test(drill.name)
      })
  const canonicalMatch = mode !== 'drill_session' && dedicatedMatchContent
    ? findSquashDrillByName('Partido de entrenamiento al mejor de 5 juegos')
    : undefined
  const normalizedDrills = canonicalMatch
    ? [toSquashDrill(canonicalMatch)]
    : orderSquashDrillsForSession(finalDrills)
  const normalizedBlocks = canonicalMatch
    ? [{ kind: 'match' as const, drills: normalizedDrills }]
    : blocks
  if (
    canonicalMatch &&
    (finalDrills.length !== 1 || findSquashDrillByName(finalDrills[0].name)?.id !== canonicalMatch.id)
  ) {
    repairs.push('squashDetails.matchFormat')
  }

  const details: SquashDetails = {
    trainingFocus: focus,
    drills: normalizedDrills,
  }
  if (mode) details.sessionMode = mode
  if (canonicalMatch) details.sessionKind = 'match'
  else if (sessionKind) details.sessionKind = sessionKind
  if (normalizedBlocks) details.blocks = normalizedBlocks
  return { details, repairs }
}

function normalizeSquashDrillsDraft(value: unknown): SquashDrill[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const drills = value.map(normalizeSquashDrillDraft)
  if (drills.some((drill) => drill == null)) return null
  return drills as SquashDrill[]
}

function normalizeSquashDrillDraft(value: unknown): SquashDrill | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || !record.name.trim()) return null
  if (record.durationMin != null && typeof record.durationMin !== 'number') return null
  if (record.notes != null && typeof record.notes !== 'string') return null
  const drill: SquashDrill = { name: record.name.trim() }
  if (typeof record.durationMin === 'number') drill.durationMin = record.durationMin
  if (typeof record.notes === 'string') drill.notes = record.notes
  if (typeof record.executionMode === 'string' && VALID_SQUASH_EXECUTION_MODES.has(record.executionMode as SquashDrillExecutionMode)) {
    drill.executionMode = record.executionMode as SquashDrillExecutionMode
  }
  return drill
}

function normalizeSquashBlocksDraft(value: unknown): SquashSessionBlock[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const blocks = value.map((item) => {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    if (typeof record.kind !== 'string' || !VALID_SQUASH_BLOCK_KINDS.has(record.kind as SquashSessionBlockKind)) return null
    if (record.durationMin != null && typeof record.durationMin !== 'number') return null
    const drills = normalizeSquashDrillsDraft(record.drills)
    if (!drills) return null
    const block: SquashSessionBlock = {
      kind: record.kind as SquashSessionBlockKind,
      drills: orderSquashDrillsForSession(drills),
    }
    if (typeof record.durationMin === 'number') block.durationMin = record.durationMin
    return block
  })
  if (blocks.some((block) => block == null)) return null
  return orderSquashBlocksForSession(blocks as SquashSessionBlock[])
}

function isSessionType(value: unknown): value is CoachSessionProposal['sessionType'] {
  return typeof value === 'string' && VALID_SESSION_TYPES.has(value)
}

function normalizeSessionTypeDraft(value: unknown): SessionType | undefined {
  if (isSessionType(value)) return value
  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined

  if (/\bsquash\b/.test(normalized)) return 'squash'
  if (/\brunning\b|\brun\b|\bcorrer\b/.test(normalized)) return 'running'
  if (/\bcycling\b|\bbike\b|\bbicicleta\b|\bciclismo\b/.test(normalized)) return 'cycling'
  if (/\bstrength\b|\bfuerza\b|\bgym\b|\bpesas\b/.test(normalized)) return 'strength'
  if (/\bmobility\b|\bmovilidad\b/.test(normalized)) return 'mobility'
  if (/\brecovery\b|\brecuperaci[oó]n\b/.test(normalized)) return 'recovery'
  if (/\bnutrition\b|\bnutrici[oó]n\b/.test(normalized)) return 'nutrition'

  return undefined
}

function isTimeBlock(value: unknown): value is TimeBlock {
  return typeof value === 'string' && VALID_TIME_BLOCKS.has(value as TimeBlock)
}

function isSquashSubtype(value: unknown): value is SquashSubtype {
  return typeof value === 'string' && VALID_SQUASH_SUBTYPES.has(value as SquashSubtype)
}

function inferSquashSubtype(value: unknown): SquashSubtype | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('control')) return 'control'
  if (normalized.includes('match') || normalized.includes('partido')) return 'match'
  if (normalized.includes('competitive') || normalized.includes('competitivo')) return 'competitive'
  if (normalized.includes('light') || normalized.includes('suave')) return 'light'
  if (normalized.includes('training') || normalized.includes('drill') || normalized.includes('tecnica') || normalized.includes('técnica')) return 'training'
  return undefined
}

function isRunningType(value: unknown): value is RunningType {
  return typeof value === 'string' && VALID_RUNNING_TYPES.has(value as RunningType)
}

function isRpe(value: unknown): value is number {
  return typeof value === 'number' && value >= 1 && value <= 10
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

function unwrapJsonCodeFence(message: string): string {
  const trimmed = message.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (match?.[1]) return match[1].trim()
  return trimmed.replace(/^```(?:json)?\s*/i, '')
}

function extractActionsText(message: string): { actionsText: string; messageWithoutActions: string; openOnly: boolean } | null {
  const fullMatch = message.match(ACTIONS_BLOCK_RE)
  if (fullMatch) {
    return {
      actionsText: fullMatch[1],
      messageWithoutActions: message.replace(/<actions>[\s\S]*?<\/actions>/gi, '').trim(),
      openOnly: false,
    }
  }

  const startMatch = ACTIONS_START_RE.exec(message)
  if (!startMatch) return null

  const actionsText = message.slice(startMatch.index + startMatch[0].length).trim()
  const messageWithoutActions = message.slice(0, startMatch.index).trim()
  return {
    actionsText,
    messageWithoutActions,
    openOnly: true,
  }
}

function isLikelyTruncatedJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const openBrackets = (trimmed.match(/\[/g) ?? []).length
  const closeBrackets = (trimmed.match(/\]/g) ?? []).length
  const openBraces = (trimmed.match(/\{/g) ?? []).length
  const closeBraces = (trimmed.match(/\}/g) ?? []).length

  return (
    openBrackets !== closeBrackets ||
    openBraces !== closeBraces ||
    /[:,{[]\s*$/.test(trimmed)
  )
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start, end + 1)
}

function extractCompleteObjectsFromArrayProperty(text: string, propertyName: string): string[] {
  const keyMatch = new RegExp(`"${escapeRegex(propertyName)}"\\s*:`).exec(text)
  if (!keyMatch) return []

  const arrayStart = text.indexOf('[', keyMatch.index + keyMatch[0].length)
  if (arrayStart === -1) return []

  const objects: string[] = []
  let inString = false
  let escaped = false
  let depth = 0
  let objectStart = -1

  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') {
      if (depth === 0) objectStart = index
      depth += 1
      continue
    }
    if (char === '}') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && objectStart !== -1) {
        objects.push(text.slice(objectStart, index + 1))
        objectStart = -1
      }
      continue
    }
    if (char === ']' && depth === 0) break
  }

  return objects
}

function extractJsonStringProperty(text: string, propertyName: string): string | undefined {
  const match = new RegExp(`"${escapeRegex(propertyName)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(text)
  if (!match?.[1]) return undefined
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
}

function extractStringArrayProperty(text: string, propertyName: string): string[] | undefined {
  const keyMatch = new RegExp(`"${escapeRegex(propertyName)}"\\s*:`).exec(text)
  if (!keyMatch) return undefined
  const arrayStart = text.indexOf('[', keyMatch.index + keyMatch[0].length)
  if (arrayStart === -1) return undefined

  const arrayText = extractBalancedJsonValue(text, arrayStart)
  if (!arrayText) return undefined
  try {
    const parsed = JSON.parse(arrayText) as unknown
    if (!Array.isArray(parsed)) return undefined
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return undefined
  }
}

function extractBalancedJsonValue(text: string, start: number): string | null {
  const opener = text[start]
  const closer = opener === '[' ? ']' : opener === '{' ? '}' : null
  if (!closer) return null

  let inString = false
  let escaped = false
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === opener) depth += 1
    if (char === closer) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mapAddSessionDropReason(reason: string): string {
  if (
    reason === 'missing-targetDate' ||
    reason === 'invalid-targetDate' ||
    reason === 'missing-sessionType' ||
    reason === 'invalid-sessionType' ||
    reason === 'missing-title' ||
    reason === 'not-object'
  ) {
    return 'missing-core-fields'
  }
  if (reason === 'invalid-durationMin' || reason === 'invalid-timeBlock') {
    return 'invalid-duration-or-time-block'
  }
  if (reason === 'invalid-squashDetails') {
    return 'missing-squash-details'
  }
  return reason
}

function warnDroppedAddSession(reason: string, record: Record<string, unknown>): void {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return
  console.warn('[responseNormalizer] add_session dropped', {
    reason,
    sessionType: record.sessionType,
    targetDate: record.targetDate,
    timeBlock: record.timeBlock,
    durationMin: record.durationMin,
    hasSquashDetails: record.squashDetails != null,
  })
}

function warnRepairedAddSession(repairs: string[], record: Record<string, unknown>): void {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return
  console.warn('[responseNormalizer] add_session repaired', {
    repairs,
    sessionType: record.sessionType,
    targetDate: record.targetDate,
    timeBlock: record.timeBlock,
    durationMin: record.durationMin,
    hasSquashDetails: record.squashDetails != null,
  })
}

function extractInlineActionsJson(message: string): { actionsText: string; messageWithoutActions: string } | null {
  const jsonArray = extractJsonArray(message)
  if (jsonArray) {
    // Must start with an object literal — avoids capturing numeric/string arrays like "[Z2, Z3]"
    if (jsonArray.trimStart().startsWith('[{') && /"type"\s*:/.test(jsonArray)) {
      return {
        actionsText: jsonArray,
        messageWithoutActions: message.replace(jsonArray, '').trim(),
      }
    }
  }

  const jsonObject = extractInlineActionObject(message)
  if (!jsonObject) return null
  return {
    actionsText: jsonObject,
    messageWithoutActions: message.replace(jsonObject, '').trim(),
  }
}

function extractWholeResponseActionsJson(message: string, requestClass: string): { actionsText: string; messageWithoutActions: string } | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  if (
    requestClass !== 'week_creator' &&
    !/"type"\s*:/.test(trimmed) &&
    !/"actions"\s*:/.test(trimmed) &&
    !VALID_ACTION_TYPES_VALUES_RE.test(trimmed)
  ) {
    return null
  }

  return {
    actionsText: trimmed,
    messageWithoutActions: message.replace(trimmed, '').trim(),
  }
}

function extractInlineActionObject(message: string): string | null {
  const start = message.indexOf('{')
  const end = message.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null

  const candidate = message.slice(start, end + 1)
  if (
    !/"type"\s*:/.test(candidate) &&
    !/"actions"\s*:/.test(candidate) &&
    !VALID_ACTION_TYPES_VALUES_RE.test(candidate)
  ) {
    return null
  }

  try {
    const parsed = JSON.parse(candidate) as unknown
    return unwrapActionCandidates(parsed) ? candidate : null
  } catch {
    return null
  }
}

const VALID_ACTION_TYPES_VALUES_RE = /"(?:skip_session|change_rpe|shorten_session|lengthen_session|move_session|replace_session_type|insert_recovery|add_session|create_week|delete_session|update_session)"\s*:/
