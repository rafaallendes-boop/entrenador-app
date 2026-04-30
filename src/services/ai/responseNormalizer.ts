import type { CoachAction, CoachActionType, CoachExerciseProposal, CoachSessionProposal, CyclingDetails, GeneratedProtocol, MobilityDetails, RunningIntervalStructure, RunningType, SquashDetails, SquashDrill, SquashSessionBlock, SquashSessionBlockKind, SquashSessionKind, SquashSessionMode, SquashSubtype, SquashTrainingFocus, TimeBlock } from '../../types'
import type { AIRawResponse, CoachNormalizedResponse, CreateWeekNormalizationDiagnostic } from './types'
import { orderSquashBlocksForSession, orderSquashDrillsForSession } from '../training/drillLibrary'

const ACTIONS_BLOCK_RE = /<actions>([\s\S]*?)<\/actions>/i
const ACTIONS_START_RE = /<actions>/i

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
  if (!isSessionType(record.sessionType)) {
    return { droppedReason: record.sessionType == null ? 'missing-sessionType' : 'invalid-sessionType' }
  }
  if (typeof record.title !== 'string' || !record.title.trim()) {
    return { droppedReason: 'missing-title' }
  }

  const repairs: string[] = []
  const title = record.title.trim()
  const defaultDurationMin = DEFAULT_SESSION_DURATION_MIN[record.sessionType]
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
    sessionType: record.sessionType,
    title,
    durationMin,
    objective,
  }

  if (isRpe(record.rpe)) session.rpe = record.rpe
  if (isSquashSubtype(record.subtype)) session.subtype = record.subtype
  if (isRunningType(record.runningType)) session.runningType = record.runningType
  if (typeof record.targetPaceMin === 'string') session.targetPaceMin = record.targetPaceMin
  if (typeof record.targetPaceMax === 'string') session.targetPaceMax = record.targetPaceMax
  if (typeof record.targetHrMin === 'number') session.targetHrMin = record.targetHrMin
  if (typeof record.targetHrMax === 'number') session.targetHrMax = record.targetHrMax
  if (isRunningIntervalStructure(record.intervalStructure)) session.intervalStructure = record.intervalStructure
  if (Array.isArray(record.exercises)) {
    session.exercises = record.exercises
      .map(validateExerciseProposal)
      .filter((item): item is CoachExerciseProposal => item != null)
  }
  if (isGeneratedProtocol(record.warmup)) session.warmup = record.warmup
  if (isGeneratedProtocol(record.cooldown)) session.cooldown = record.cooldown
  if (isCyclingDetails(record.cyclingDetails)) session.cyclingDetails = record.cyclingDetails
  if (isMobilityDetails(record.mobilityDetails)) session.mobilityDetails = record.mobilityDetails

  if (record.sessionType === 'squash') {
    const squashDetails = normalizeSquashDetailsDraft(record.squashDetails)
    if (squashDetails) {
      session.squashDetails = squashDetails.details
      repairs.push(...squashDetails.repairs)
    } else if (record.squashDetails == null) {
      repairs.push('squashDetails')
      session.squashDetails = {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: title, durationMin }],
      }
    } else {
      return { droppedReason: 'invalid-squashDetails' }
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
  message = message.replace(/```[a-z]*\n?\s*\n?```/g, '')

  let actions: CoachAction[] | undefined
  let actionParseFailed = false
  let hadActionsMarkup = false
  let likelyTruncated = raw.truncated === true
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

  message = message.replace(/\n{3,}/g, '\n\n').trim()

  return {
    message,
    actions: actions && actions.length > 0 ? actions : undefined,
    provider: raw.provider,
    model: raw.model,
    raw: raw.raw,
    timestamp: Date.now(),
    durationMs: raw.durationMs,
    traceId: raw.traceId ?? 'legacy-trace',
    requestClass,
    retryUsed: raw.retryUsed,
    fallbackUsed: raw.fallbackUsed,
    meta: {
      hadActionsMarkup,
      actionParseFailed,
      likelyTruncated,
      invalidActionCount,
      createWeekDiagnostics,
    },
  }
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

  switch (type) {
    case 'skip_session':
    case 'delete_session':
      return { action: typeof record.sessionId === 'string' ? { ...base, sessionId: record.sessionId } : null }

    case 'replace_session_type':
      return {
        action: typeof record.sessionId === 'string' && isSessionType(record.newType)
          ? { ...base, sessionId: record.sessionId, newType: record.newType }
          : null,
      }

    case 'change_rpe':
      return {
        action: typeof record.sessionId === 'string' && isRpe(record.newRpe)
          ? { ...base, sessionId: record.sessionId, newRpe: record.newRpe }
          : null,
      }

    case 'shorten_session':
    case 'lengthen_session':
      return {
        action: typeof record.sessionId === 'string' && typeof record.newDurationMin === 'number' && record.newDurationMin >= 5
          ? { ...base, sessionId: record.sessionId, newDurationMin: record.newDurationMin }
          : null,
      }

    case 'move_session':
      return {
        action: typeof record.sessionId === 'string' && isValidDate(record.targetDate)
          ? { ...base, sessionId: record.sessionId, targetDate: record.targetDate }
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
      if (typeof record.sessionId !== 'string') return { action: null }
      const action: CoachAction = {
        ...base,
        sessionId: record.sessionId,
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
        action.exercises = record.exercises
          .map(validateExerciseProposal)
          .filter((item): item is CoachExerciseProposal => item != null)
      }
      if (isGeneratedProtocol(record.warmup)) action.warmup = record.warmup
      if (isGeneratedProtocol(record.cooldown)) action.cooldown = record.cooldown
      if (isCyclingDetails(record.cyclingDetails)) action.cyclingDetails = record.cyclingDetails
      if (isMobilityDetails(record.mobilityDetails)) action.mobilityDetails = record.mobilityDetails
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
  return exercise
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

function normalizeSquashDetailsDraft(value: unknown): { details: SquashDetails; repairs: string[] } | null {
  if (value == null) return null
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    typeof record.trainingFocus !== 'string' ||
    !VALID_SQUASH_TRAINING_FOCUS.has(record.trainingFocus)
  ) {
    return null
  }
  const validMode =
    record.sessionMode == null ||
    (typeof record.sessionMode === 'string' && VALID_SQUASH_SESSION_MODES.has(record.sessionMode as SquashSessionMode))
  if (!validMode) return null

  const validSessionKind =
    record.sessionKind == null ||
    (typeof record.sessionKind === 'string' && VALID_SQUASH_SESSION_KINDS.has(record.sessionKind as SquashSessionKind))
  if (!validSessionKind) return null

  const drills = normalizeSquashDrillsDraft(record.drills)
  const blocks = record.blocks == null ? undefined : normalizeSquashBlocksDraft(record.blocks)
  if (record.blocks != null && !blocks) return null

  const repairs: string[] = []
  const finalDrills = drills ?? (blocks ? blocks.flatMap((block) => block.drills) : null)
  if (!finalDrills || finalDrills.length === 0) return null
  if (!drills && blocks) repairs.push('squashDetails.drills')

  const details: SquashDetails = {
    trainingFocus: record.trainingFocus as SquashTrainingFocus,
    drills: orderSquashDrillsForSession(finalDrills),
  }
  if (typeof record.sessionMode === 'string') details.sessionMode = record.sessionMode as SquashSessionMode
  if (typeof record.sessionKind === 'string') details.sessionKind = record.sessionKind as SquashSessionKind
  if (blocks) details.blocks = blocks
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

function isTimeBlock(value: unknown): value is TimeBlock {
  return typeof value === 'string' && VALID_TIME_BLOCKS.has(value as TimeBlock)
}

function isSquashSubtype(value: unknown): value is SquashSubtype {
  return typeof value === 'string' && VALID_SQUASH_SUBTYPES.has(value as SquashSubtype)
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
  if (!jsonArray) return null
  // Must start with an object literal — avoids capturing numeric/string arrays like "[Z2, Z3]"
  if (!jsonArray.trimStart().startsWith('[{')) return null
  if (!/"type"\s*:/.test(jsonArray)) return null

  return {
    actionsText: jsonArray,
    messageWithoutActions: message.replace(jsonArray, '').trim(),
  }
}
