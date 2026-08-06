import type {
  CyclingDetails,
  Exercise,
  GeneratedProtocol,
  MobilityDetails,
  RunningDetails,
  SessionType,
  SquashDetails,
  SquashSubtype,
  TimeBlock,
} from './index'

/** Template exercises have neither durable identity nor completion state. */
export type SessionTemplateExercise = Omit<Exercise, 'id' | 'completed'>

/**
 * Explicit allowlist of the reusable, planable portion of a session.
 * Execution, athlete, match and Plan Builder block metadata never belong here.
 */
export interface SessionTemplatePayload {
  type: SessionType
  timeBlock: TimeBlock
  title: string
  durationMin: number
  objective?: string
  location?: string
  rpe?: number
  notes?: string
  subtype?: SquashSubtype
  squashDetails?: SquashDetails
  runningDetails?: RunningDetails
  cyclingDetails?: CyclingDetails
  mobilityDetails?: MobilityDetails
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
  exercises?: SessionTemplateExercise[]
}

export const SESSION_TEMPLATE_PAYLOAD_VERSION = 1 as const

export interface SupportedSessionTemplate {
  id: string
  name: string
  kind: 'session'
  payloadVersion: typeof SESSION_TEMPLATE_PAYLOAD_VERSION
  payload: SessionTemplatePayload
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/**
 * A row written by a newer client. Its raw payload must survive sync and backup,
 * but must never be opened by the v1 form or materializer.
 */
export interface UnsupportedSessionTemplate {
  id: string
  name: string
  kind: string
  payloadVersion: number
  payload: unknown
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type StoredSessionTemplate = SupportedSessionTemplate | UnsupportedSessionTemplate

const SESSION_TYPES: readonly SessionType[] = [
  'squash',
  'running',
  'cycling',
  'strength',
  'mobility',
  'recovery',
  'nutrition',
]
const SQUASH_SUBTYPES: readonly SquashSubtype[] = [
  'control',
  'training',
  'match',
  'competitive',
  'light',
]
const RUNNING_TYPES = ['z2', 'tempo', 'intervals', 'long'] as const
const SQUASH_FOCUSES = ['technical', 'tactical', 'physical', 'conditioned_games'] as const
const PROTOCOL_TONES = ['general', 'protective', 'competitive', 'recovery'] as const
const PROTOCOL_SOURCES = ['base', 'adapted'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value)
}

function isKnownValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function isProtocol(value: unknown): value is GeneratedProtocol {
  if (!isRecord(value)) return false
  if (
    typeof value.title !== 'string'
    || !isFiniteNumber(value.durationMin)
    || typeof value.note !== 'string'
    || !isKnownValue(PROTOCOL_TONES, value.tone)
    || !isKnownValue(PROTOCOL_SOURCES, value.source)
    || !Array.isArray(value.steps)
  ) return false
  return value.steps.every((step) => (
    isRecord(step)
    && typeof step.label === 'string'
    && isOptionalString(step.detail)
  ))
}

function isRunningDetails(value: unknown): value is RunningDetails {
  if (!isRecord(value) || !isKnownValue(RUNNING_TYPES, value.runningType)) return false
  if (
    !isOptionalString(value.targetPaceMin)
    || !isOptionalString(value.targetPaceMax)
    || !isOptionalFiniteNumber(value.targetHrMin)
    || !isOptionalFiniteNumber(value.targetHrMax)
  ) return false
  if (value.intervalStructure === undefined) return true
  if (!isRecord(value.intervalStructure) || !Array.isArray(value.intervalStructure.blocks)) return false
  return value.intervalStructure.blocks.every((block) => (
    isRecord(block)
    && typeof block.label === 'string'
    && isOptionalFiniteNumber(block.repetitions)
    && isOptionalFiniteNumber(block.durationMin)
    && isOptionalFiniteNumber(block.distanceKm)
    && isOptionalString(block.targetPace)
    && isOptionalFiniteNumber(block.targetHrMax)
    && isOptionalString(block.notes)
  ))
}

function isSquashDetails(value: unknown): value is SquashDetails {
  if (
    !isRecord(value)
    || !isKnownValue(SQUASH_FOCUSES, value.trainingFocus)
    || !Array.isArray(value.drills)
  ) return false
  return value.drills.every((drill) => isRecord(drill) && typeof drill.name === 'string')
    && (value.blocks === undefined || (
      Array.isArray(value.blocks)
      && value.blocks.every((block) => (
        isRecord(block)
        && Array.isArray(block.drills)
        && block.drills.every((drill) => isRecord(drill) && typeof drill.name === 'string')
      ))
    ))
}

function isCyclingDetails(value: unknown): value is CyclingDetails {
  return isRecord(value)
    && typeof value.sessionCategory === 'string'
    && typeof value.targetStructure === 'string'
    && isOptionalString(value.sessionFamily)
    && isOptionalString(value.intensityReference)
    && isOptionalString(value.executionNotes)
}

function isMobilityDetails(value: unknown): value is MobilityDetails {
  return isRecord(value)
    && Array.isArray(value.focusAreas)
    && value.focusAreas.every((area) => typeof area === 'string')
    && typeof value.context === 'string'
    && typeof value.targetStructure === 'string'
    && isOptionalString(value.executionNotes)
}

function isTemplateExercise(value: unknown): value is SessionTemplateExercise {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || !isFiniteNumber(value.sets)
    || (typeof value.reps !== 'string' && !isFiniteNumber(value.reps))
    || !isOptionalFiniteNumber(value.weight)
    || !isOptionalString(value.notes)
    || !isOptionalString(value.supersetGroup)
  ) return false
  if (value.warmupSets === undefined) return true
  return Array.isArray(value.warmupSets) && value.warmupSets.every((set) => (
    isRecord(set)
    && (typeof set.reps === 'string' || isFiniteNumber(set.reps))
    && isOptionalFiniteNumber(set.weight)
    && isOptionalFiniteNumber(set.percent1RM)
  ))
}

/** Runtime boundary for rows coming from sync or backup. */
export function isSessionTemplatePayloadV1(value: unknown): value is SessionTemplatePayload {
  if (!isRecord(value)) return false
  if (
    !isKnownValue(SESSION_TYPES, value.type)
    || (value.timeBlock !== 'AM' && value.timeBlock !== 'PM')
    || typeof value.title !== 'string'
    || !isFiniteNumber(value.durationMin)
    || !isOptionalString(value.objective)
    || !isOptionalString(value.location)
    || !isOptionalFiniteNumber(value.rpe)
    || !isOptionalString(value.notes)
    || (value.subtype !== undefined && !isKnownValue(SQUASH_SUBTYPES, value.subtype))
  ) return false
  if (value.squashDetails !== undefined && !isSquashDetails(value.squashDetails)) return false
  if (value.runningDetails !== undefined && !isRunningDetails(value.runningDetails)) return false
  if (value.cyclingDetails !== undefined && !isCyclingDetails(value.cyclingDetails)) return false
  if (value.mobilityDetails !== undefined && !isMobilityDetails(value.mobilityDetails)) return false
  if (value.warmup !== undefined && !isProtocol(value.warmup)) return false
  if (value.cooldown !== undefined && !isProtocol(value.cooldown)) return false
  if (value.exercises !== undefined && (
    !Array.isArray(value.exercises) || !value.exercises.every(isTemplateExercise)
  )) return false
  return true
}

export function isSupportedSessionTemplate(
  template: StoredSessionTemplate,
): template is SupportedSessionTemplate {
  return template.kind === 'session'
    && template.payloadVersion === SESSION_TEMPLATE_PAYLOAD_VERSION
    && isSessionTemplatePayloadV1(template.payload)
}
