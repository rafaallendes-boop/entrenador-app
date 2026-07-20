import type { WeekCreatorSkeleton, WeekCreatorSkeletonSession } from './weekCreatorSkeleton'
import {
  WEEK_CREATOR_SKELETON_RUNNING_TYPES,
  WEEK_CREATOR_SKELETON_SESSION_TYPES,
  WEEK_CREATOR_SKELETON_SQUASH_SUBTYPES,
  WEEK_CREATOR_SKELETON_TIME_BLOCKS,
} from './weekCreatorSkeleton'

export interface WeekCreatorSkeletonParseIssue {
  path: string
  code: 'invalid_json' | 'missing_field' | 'invalid_type' | 'invalid_value'
}

export type WeekCreatorSkeletonParseResult =
  | { ok: true; skeleton: WeekCreatorSkeleton }
  | { ok: false; issues: WeekCreatorSkeletonParseIssue[] }

/**
 * Parses the provider payload before the generic Coach response normalizer.
 * This ordering is required: normalizeSessionProposalDraft intentionally drops
 * unknown fields, while focusKey must reach the local hydration selectors.
 */
export function parseWeekCreatorSkeletonResponse(text: string): WeekCreatorSkeletonParseResult {
  let value: unknown
  try {
    const unwrappedText = text.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
    const actionsMatch = unwrappedText.match(/^<actions>([\s\S]*?)<\/actions>$/i)
    value = JSON.parse(actionsMatch?.[1] ?? unwrappedText)
  } catch {
    return { ok: false, issues: [{ path: '$', code: 'invalid_json' }] }
  }

  return validateWeekCreatorSkeleton(unwrapSkeletonCandidate(value))
}

function unwrapSkeletonCandidate(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) return value[0]
  if (!isRecord(value)) return value
  if (Array.isArray(value.actions) && value.actions.length === 1) return value.actions[0]
  return value
}

export function validateWeekCreatorSkeleton(value: unknown): WeekCreatorSkeletonParseResult {
  const issues: WeekCreatorSkeletonParseIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', code: 'invalid_type' }] }
  }

  if (value.type !== 'create_week') addIssue(issues, 'type', value.type == null ? 'missing_field' : 'invalid_value')
  if (!isNonEmptyString(value.reason)) addIssue(issues, 'reason', value.reason == null ? 'missing_field' : 'invalid_type')
  if (!isIsoDate(value.targetDate)) addIssue(issues, 'targetDate', value.targetDate == null ? 'missing_field' : 'invalid_value')

  let weekObjectives: string[] | undefined
  if (value.weekObjectives != null) {
    if (Array.isArray(value.weekObjectives) && value.weekObjectives.every(isNonEmptyString)) {
      weekObjectives = value.weekObjectives.map((objective) => objective.trim())
    } else {
      addIssue(issues, 'weekObjectives', 'invalid_type')
    }
  }

  const sessions: WeekCreatorSkeletonSession[] = []
  if (!Array.isArray(value.sessions)) {
    addIssue(issues, 'sessions', value.sessions == null ? 'missing_field' : 'invalid_type')
  } else if (value.sessions.length === 0) {
    addIssue(issues, 'sessions', 'invalid_value')
  } else {
    value.sessions.forEach((session, index) => {
      const parsed = validateSession(session, index, issues)
      if (parsed) sessions.push(parsed)
    })
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    skeleton: {
      type: 'create_week',
      reason: (value.reason as string).trim(),
      targetDate: value.targetDate as string,
      ...(weekObjectives ? { weekObjectives } : {}),
      sessions,
    },
  }
}

function validateSession(
  value: unknown,
  index: number,
  issues: WeekCreatorSkeletonParseIssue[],
): WeekCreatorSkeletonSession | undefined {
  const path = `sessions[${index}]`
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid_type')
    return undefined
  }

  if (!isIsoDate(value.date)) addIssue(issues, `${path}.date`, value.date == null ? 'missing_field' : 'invalid_value')
  if (!isMember(value.timeBlock, WEEK_CREATOR_SKELETON_TIME_BLOCKS)) {
    addIssue(issues, `${path}.timeBlock`, value.timeBlock == null ? 'missing_field' : 'invalid_value')
  }
  if (!isMember(value.sessionType, WEEK_CREATOR_SKELETON_SESSION_TYPES)) {
    addIssue(issues, `${path}.sessionType`, value.sessionType == null ? 'missing_field' : 'invalid_value')
  }
  if (!Number.isInteger(value.durationMin) || (value.durationMin as number) < 5) {
    addIssue(issues, `${path}.durationMin`, value.durationMin == null ? 'missing_field' : 'invalid_value')
  }
  if (!Number.isInteger(value.rpe) || (value.rpe as number) < 1 || (value.rpe as number) > 10) {
    addIssue(issues, `${path}.rpe`, value.rpe == null ? 'missing_field' : 'invalid_value')
  }
  if (!isNonEmptyString(value.focusKey)) addIssue(issues, `${path}.focusKey`, value.focusKey == null ? 'missing_field' : 'invalid_type')
  if (!isNonEmptyString(value.title)) addIssue(issues, `${path}.title`, value.title == null ? 'missing_field' : 'invalid_type')
  if (!isNonEmptyString(value.objective)) addIssue(issues, `${path}.objective`, value.objective == null ? 'missing_field' : 'invalid_type')
  if (value.subtype != null && !isMember(value.subtype, WEEK_CREATOR_SKELETON_SQUASH_SUBTYPES)) {
    addIssue(issues, `${path}.subtype`, 'invalid_value')
  } else if (value.subtype != null && value.sessionType !== 'squash') {
    addIssue(issues, `${path}.subtype`, 'invalid_value')
  }
  if (value.runningType != null && !isMember(value.runningType, WEEK_CREATOR_SKELETON_RUNNING_TYPES)) {
    addIssue(issues, `${path}.runningType`, 'invalid_value')
  } else if (value.runningType != null && value.sessionType !== 'running') {
    addIssue(issues, `${path}.runningType`, 'invalid_value')
  }

  if (issues.some((issue) => issue.path === path || issue.path.startsWith(`${path}.`))) return undefined

  return {
    date: value.date as string,
    timeBlock: value.timeBlock as WeekCreatorSkeletonSession['timeBlock'],
    sessionType: value.sessionType as WeekCreatorSkeletonSession['sessionType'],
    durationMin: value.durationMin as number,
    rpe: value.rpe as number,
    focusKey: (value.focusKey as string).trim(),
    title: (value.title as string).trim(),
    objective: (value.objective as string).trim(),
    ...(value.subtype != null ? { subtype: value.subtype as NonNullable<WeekCreatorSkeletonSession['subtype']> } : {}),
    ...(value.runningType != null ? { runningType: value.runningType as NonNullable<WeekCreatorSkeletonSession['runningType']> } : {}),
  }
}

function addIssue(
  issues: WeekCreatorSkeletonParseIssue[],
  path: string,
  code: WeekCreatorSkeletonParseIssue['code'],
): void {
  issues.push({ path, code })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isMember<const T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
}
