/**
 * Normalizes raw AI provider responses into the CoachNormalizedResponse shape.
 *
 * Responsibilities:
 * 1. Extract <actions>...</actions> block if present
 * 2. Validate each action object (type, required fields)
 * 3. Strip the actions block from the display message
 * 4. Return a clean CoachNormalizedResponse
 *
 * The <actions> format expected from the model:
 *   <actions>
 *   [{"type":"skip_session","sessionId":"abc12345","reason":"fatiga acumulada"}]
 *   </actions>
 *
 * If parsing fails, actions are silently dropped (message is still shown).
 * This ensures UI never breaks due to malformed model output.
 */

import type { AIRawResponse, CoachNormalizedResponse } from './types'
import type { CoachAction, CoachActionType } from '../../types'

// ─── Actions block extractor ───────────────────────────────────────────────────

const ACTIONS_BLOCK_RE = /<actions>([\s\S]*?)<\/actions>/i

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
])

export function normalizeResponse(raw: AIRawResponse): CoachNormalizedResponse {
  let message = raw.text
  let actions: CoachAction[] | undefined

  // Try to find and extract the actions block
  const match = message.match(ACTIONS_BLOCK_RE)
  if (match) {
    actions = parseActionsBlock(match[1])
    // Remove the actions block (and any surrounding whitespace) from display text
    message = message.replace(ACTIONS_BLOCK_RE, '').trim()
  }

  // Clean up any trailing whitespace or extra newlines left after stripping
  message = message.replace(/\n{3,}/g, '\n\n').trim()

  return {
    message,
    actions: actions && actions.length > 0 ? actions : undefined,
    provider: raw.provider,
    model: raw.model,
    raw: raw.raw,
    timestamp: Date.now(),
    durationMs: raw.durationMs,
  }
}

// ─── Action parsing + validation ──────────────────────────────────────────────

function parseActionsBlock(jsonText: string): CoachAction[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText.trim())
  } catch {
    // Model may have added trailing text or bad JSON — attempt lenient recovery
    const fixedJson = extractJsonArray(jsonText)
    if (!fixedJson) return []
    try {
      parsed = JSON.parse(fixedJson)
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) return []

  return parsed.reduce<CoachAction[]>((acc, item) => {
    const action = validateAction(item)
    if (action) acc.push(action)
    return acc
  }, [])
}

function validateAction(obj: unknown): CoachAction | null {
  if (!obj || typeof obj !== 'object') return null
  const a = obj as Record<string, unknown>

  // type is always required
  if (typeof a.type !== 'string' || !VALID_ACTION_TYPES.has(a.type as CoachActionType)) return null

  // reason is always required
  if (typeof a.reason !== 'string' || !a.reason.trim()) return null

  const type = a.type as CoachActionType

  // Validate required fields per action type
  switch (type) {
    case 'skip_session':
    case 'replace_session_type':
      if (typeof a.sessionId !== 'string') return null
      break
    case 'change_rpe':
      if (typeof a.sessionId !== 'string') return null
      if (typeof a.newRpe !== 'number' || a.newRpe < 1 || a.newRpe > 10) return null
      break
    case 'shorten_session':
    case 'lengthen_session':
      if (typeof a.sessionId !== 'string') return null
      if (typeof a.newDurationMin !== 'number' || a.newDurationMin < 5) return null
      break
    case 'move_session':
      if (typeof a.sessionId !== 'string') return null
      if (typeof a.targetDate !== 'string' || !isValidDate(a.targetDate)) return null
      break
    case 'insert_recovery':
      if (typeof a.targetDate !== 'string' || !isValidDate(a.targetDate)) return null
      break
    case 'add_session':
      if (typeof a.targetDate !== 'string' || !isValidDate(a.targetDate)) return null
      if (typeof a.sessionType !== 'string') return null
      if (typeof a.title !== 'string' || !a.title.trim()) return null
      if (typeof a.durationMin !== 'number' || a.durationMin < 5) return null
      if (typeof a.timeBlock !== 'string') return null
      break
    case 'create_week':
      if (!Array.isArray(a.sessions) || a.sessions.length === 0) return null
      break
    case 'delete_session':
      if (typeof a.sessionId !== 'string') return null
      break
  }

  // For sessionId fields, expand short IDs back (the model uses 8-char prefix from prompt)
  // The executor handles lookup by prefix — pass as-is
  return a as unknown as CoachAction
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}

// Attempt to recover a JSON array from partially malformed text
function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start, end + 1)
}
