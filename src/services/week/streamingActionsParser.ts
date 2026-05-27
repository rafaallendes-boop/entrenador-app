import type { CoachAction } from '../../types'

export interface StreamingActionsParserOptions {
  onAction?: (action: CoachAction) => void
}

export interface StreamingActionsParserFlushResult {
  completeActions: CoachAction[]
  truncated: boolean
}

export interface StreamingActionsParser {
  push: (chunk: string) => void
  flush: () => StreamingActionsParserFlushResult
}

/**
 * Progressive parser for streamed `<actions>[...]</actions>` or raw
 * `{ "actions": [...] }` responses. It emits each complete JSON object in the
 * actions array as soon as its closing brace arrives.
 */
export function createStreamingActionsParser(
  options: StreamingActionsParserOptions = {},
): StreamingActionsParser {
  let buffer = ''
  let cursor = 0
  let insideActionsArray = false
  let objectDepth = 0
  let objectStart = -1
  let inString = false
  let escapeNext = false
  const emitted: CoachAction[] = []

  function emitIfAction(jsonSlice: string): void {
    try {
      const parsed = JSON.parse(jsonSlice) as unknown
      if (!isCoachActionLike(parsed)) return
      emitted.push(parsed)
      options.onAction?.(parsed)
    } catch {
      // The stream may still be mid-object; wait for more chunks.
    }
  }

  function advance(): void {
    for (; cursor < buffer.length; cursor++) {
      const ch = buffer[cursor]
      if (!ch) continue

      if (escapeNext) {
        escapeNext = false
        continue
      }
      if (ch === '\\' && inString) {
        escapeNext = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue

      if (!insideActionsArray) {
        if (ch === '[' && isActionsArrayStart(buffer, cursor)) {
          insideActionsArray = true
          objectDepth = 0
          objectStart = -1
        }
        continue
      }

      if (ch === '{') {
        if (objectDepth === 0) objectStart = cursor
        objectDepth += 1
        continue
      }

      if (ch === '}') {
        objectDepth -= 1
        if (objectDepth === 0 && objectStart >= 0) {
          emitIfAction(buffer.slice(objectStart, cursor + 1))
          objectStart = -1
        }
        continue
      }

      if (ch === ']' && objectDepth === 0) {
        insideActionsArray = false
        objectStart = -1
      }
    }
  }

  return {
    push(chunk: string) {
      if (!chunk) return
      buffer += chunk
      advance()
    },
    flush() {
      advance()
      return {
        completeActions: emitted.slice(),
        truncated: insideActionsArray || objectDepth > 0 || inString || escapeNext,
      }
    },
  }
}

function isCoachActionLike(value: unknown): value is CoachAction {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string'
}

function isActionsArrayStart(text: string, bracketIndex: number): boolean {
  const before = text.slice(0, bracketIndex)
  const lastOpenTag = before.toLowerCase().lastIndexOf('<actions>')
  const lastCloseTag = before.toLowerCase().lastIndexOf('</actions>')
  if (lastOpenTag > lastCloseTag) return true

  return /"actions"\s*:\s*$/.test(before)
}
