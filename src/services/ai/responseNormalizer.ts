import type { CoachAction, CoachActionType, CoachExerciseProposal, CoachSessionProposal, CyclingDetails, GeneratedProtocol, MobilityDetails, RunningIntervalStructure, RunningType, SquashDetails, SquashSessionMode, SquashSubtype, TimeBlock } from '../../types'
import type { AIRawResponse, CoachNormalizedResponse, CreateWeekNormalizationDiagnostic } from './types'
import { orderSquashDrillsForSession } from '../training/drillLibrary'

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
const VALID_SQUASH_TRAINING_FOCUS = new Set(['technical', 'tactical', 'physical', 'conditioned_games'])
const VALID_MOBILITY_CONTEXTS = new Set(['post_run', 'post_cycling', 'post_squash', 'post_strength', 'pre_training_activation', 'recovery', 'full_body', 'sport_specific'])

export function normalizeResponse(raw: AIRawResponse): CoachNormalizedResponse {
  let message = raw.text.replace(
    /```[a-z]*\n?(<actions>[\s\S]*?<\/actions>)\n?```/gi,
    '$1',
  )
  message = message.replace(/```[a-z]*\n?\s*\n?```/g, '')

  let actions: CoachAction[] | undefined
  let actionParseFailed = false
  let hadActionsMarkup = false
  let likelyTruncated = false
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

  message = message.replace(/\n{3,}/g, '\n\n').trim()

  return {
    message,
    actions: actions && actions.length > 0 ? actions : undefined,
    provider: raw.provider,
    model: raw.model,
    raw: raw.raw,
    timestamp: Date.now(),
    durationMs: raw.durationMs,
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

    if (typeof record.type === 'string') {
      return [record]
    }
  }

  return null
}

function validateAction(obj: unknown): {
  action: CoachAction | null
  createWeekDiagnostic?: CreateWeekNormalizationDiagnostic
} {
  if (!obj || typeof obj !== 'object') return { action: null }
  const record = obj as Record<string, unknown>

  if (typeof record.type !== 'string' || !VALID_ACTION_TYPES.has(record.type as CoachActionType)) return { action: null }
  if (typeof record.reason !== 'string' || !record.reason.trim()) return { action: null }

  const type = record.type as CoachActionType
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
      if (!isValidDate(record.targetDate) || !isSessionType(record.sessionType) || typeof record.title !== 'string' || !record.title.trim()) {
        return { action: null }
      }
      if (typeof record.durationMin !== 'number' || record.durationMin < 5 || !isTimeBlock(record.timeBlock)) {
        return { action: null }
      }
      if (record.sessionType === 'squash' && !isSquashDetails(record.squashDetails)) {
        return { action: null }
      }

      const action: CoachAction = {
        ...base,
        targetDate: record.targetDate,
        sessionType: record.sessionType,
        title: record.title.trim(),
        durationMin: record.durationMin,
        timeBlock: record.timeBlock,
      }
      return { action: assignOptionalSessionFields(action, record) }
    }

    case 'create_week': {
      if (!Array.isArray(record.sessions) || record.sessions.length === 0) return { action: null }
      const rawSessions = record.sessions.length
      const sessions = record.sessions
        .map(validateSessionProposal)
        .filter((item): item is CoachSessionProposal => item != null)
      const createWeekDiagnostic: CreateWeekNormalizationDiagnostic = {
        targetDate: isValidDate(record.targetDate) ? record.targetDate : undefined,
        rawSessions,
        validSessions: sessions.length,
        droppedSessions: rawSessions - sessions.length,
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
      if (isSquashDetails(record.squashDetails)) action.squashDetails = normalizeSquashDetails(record.squashDetails)

      return { action: hasAnyUpdateField(action) ? action : null }
    }
  }
}

function assignOptionalSessionFields(action: CoachAction, record: Record<string, unknown>): CoachAction | null {
  if (isRpe(record.rpe)) action.rpe = record.rpe
  if (typeof record.objective === 'string' && record.objective.trim()) action.objective = record.objective.trim()
  if (isSquashSubtype(record.subtype)) action.subtype = record.subtype
  if (isRunningType(record.runningType)) action.runningType = record.runningType
  if (typeof record.targetPaceMin === 'string') action.targetPaceMin = record.targetPaceMin
  if (typeof record.targetPaceMax === 'string') action.targetPaceMax = record.targetPaceMax
  if (typeof record.targetHrMin === 'number') action.targetHrMin = record.targetHrMin
  if (typeof record.targetHrMax === 'number') action.targetHrMax = record.targetHrMax
  if (isRunningIntervalStructure(record.intervalStructure)) action.intervalStructure = record.intervalStructure
  if (isGeneratedProtocol(record.warmup)) action.warmup = record.warmup
  if (isGeneratedProtocol(record.cooldown)) action.cooldown = record.cooldown
  if (Array.isArray(record.exercises)) {
    action.exercises = record.exercises
      .map(validateExerciseProposal)
      .filter((item): item is CoachExerciseProposal => item != null)
  }
  if (isCyclingDetails(record.cyclingDetails)) action.cyclingDetails = record.cyclingDetails
  if (isMobilityDetails(record.mobilityDetails)) action.mobilityDetails = record.mobilityDetails
  if (isSquashDetails(record.squashDetails)) action.squashDetails = normalizeSquashDetails(record.squashDetails)
  return action
}

function validateSessionProposal(value: unknown): CoachSessionProposal | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isValidDate(record.date) || !isTimeBlock(record.timeBlock) || !isSessionType(record.sessionType) || typeof record.title !== 'string' || !record.title.trim()) {
    return null
  }
  if (typeof record.durationMin !== 'number' || record.durationMin < 5) return null

  const proposal: CoachSessionProposal = {
    date: record.date,
    timeBlock: record.timeBlock,
    sessionType: record.sessionType,
    title: record.title.trim(),
    durationMin: record.durationMin,
  }

  if (isRpe(record.rpe)) proposal.rpe = record.rpe
  if (typeof record.objective === 'string' && record.objective.trim()) proposal.objective = record.objective.trim()
  if (isSquashSubtype(record.subtype)) proposal.subtype = record.subtype
  if (isRunningType(record.runningType)) proposal.runningType = record.runningType
  if (typeof record.targetPaceMin === 'string') proposal.targetPaceMin = record.targetPaceMin
  if (typeof record.targetPaceMax === 'string') proposal.targetPaceMax = record.targetPaceMax
  if (typeof record.targetHrMin === 'number') proposal.targetHrMin = record.targetHrMin
  if (typeof record.targetHrMax === 'number') proposal.targetHrMax = record.targetHrMax
  if (isRunningIntervalStructure(record.intervalStructure)) proposal.intervalStructure = record.intervalStructure
  if (record.sessionType === 'squash' && !isSquashDetails(record.squashDetails)) return null
  if (Array.isArray(record.exercises)) {
    proposal.exercises = record.exercises
      .map(validateExerciseProposal)
      .filter((item): item is CoachExerciseProposal => item != null)
  }
  if (isGeneratedProtocol(record.warmup)) proposal.warmup = record.warmup
  if (isGeneratedProtocol(record.cooldown)) proposal.cooldown = record.cooldown
  if (isCyclingDetails(record.cyclingDetails)) proposal.cyclingDetails = record.cyclingDetails
  if (isMobilityDetails(record.mobilityDetails)) proposal.mobilityDetails = record.mobilityDetails
  if (isSquashDetails(record.squashDetails)) proposal.squashDetails = normalizeSquashDetails(record.squashDetails)

  return proposal
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

function isSquashDetails(value: unknown): value is SquashDetails {
  if (value == null) return false
  if (typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const validMode =
    record.sessionMode == null ||
    (typeof record.sessionMode === 'string' && VALID_SQUASH_SESSION_MODES.has(record.sessionMode as SquashSessionMode))
  const validDrills =
    Array.isArray(record.drills) &&
    record.drills.length > 0 &&
    record.drills.every((drill) => {
      if (!drill || typeof drill !== 'object') return false
      const drillRecord = drill as Record<string, unknown>
      return (
        typeof drillRecord.name === 'string' &&
        drillRecord.name.trim().length > 0 &&
        (drillRecord.durationMin == null || typeof drillRecord.durationMin === 'number') &&
        (drillRecord.notes == null || typeof drillRecord.notes === 'string')
      )
    })
  const isValid =
    typeof record.trainingFocus === 'string' &&
    VALID_SQUASH_TRAINING_FOCUS.has(record.trainingFocus) &&
    validDrills &&
    validMode
  return isValid
}

function normalizeSquashDetails(details: SquashDetails): SquashDetails {
  return {
    ...details,
    drills: orderSquashDrillsForSession(details.drills),
  }
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

function extractInlineActionsJson(message: string): { actionsText: string; messageWithoutActions: string } | null {
  const jsonArray = extractJsonArray(message)
  if (!jsonArray) return null
  if (!/"type"\s*:/.test(jsonArray)) return null

  return {
    actionsText: jsonArray,
    messageWithoutActions: message.replace(jsonArray, '').trim(),
  }
}
