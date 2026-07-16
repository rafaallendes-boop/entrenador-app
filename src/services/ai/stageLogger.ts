/**
 * stageLogger — structured per-stage timing for coach AI requests.
 *
 * Emits a single console.info log per request with all stage durations and the
 * final outcome. Designed to be cheap (no buffering, no Dexie writes) so it can
 * stay enabled in production.
 *
 * Stage timings are also returned so callers can persist them in
 * `PlanGenerationMeta.stageTimings`.
 */

import type { AIRequestClass, CoachStage, StageTiming } from '../../types'

export type { CoachStage, StageTiming } from '../../types'

export type CoachOutcome = 'ok' | 'truncated' | 'parse_fail' | 'invalid_schema' | 'timeout' | 'rate_limit' | 'error'

export interface StageTracker {
  readonly traceId: string
  readonly requestClass: AIRequestClass
  /** Open a stage. Call the returned `end()` when the stage finishes. */
  stage: (name: CoachStage) => StageHandle
  /** Get accumulated timings (snapshot). */
  timings: () => StageTiming[]
  /** Emit the structured log. Call once when the request resolves or fails. */
  flush: (outcome: CoachOutcome, extra?: Record<string, unknown>) => void
}

export interface StageHandle {
  end: (result?: { ok?: boolean; error?: string }) => StageTiming
}

const noopHandle: StageHandle = {
  end: () => ({ stage: 'apply', durationMs: 0, ok: true }),
}

export function createStageTracker(
  traceId: string,
  requestClass: AIRequestClass,
): StageTracker {
  const startedAt = Date.now()
  const timings: StageTiming[] = []
  let flushed = false

  return {
    traceId,
    requestClass,
    stage(name) {
      const begin = Date.now()
      let closed = false
      return {
        end(result) {
          if (closed) return noopHandle.end()
          closed = true
          const timing: StageTiming = {
            stage: name,
            durationMs: Date.now() - begin,
            ok: result?.ok !== false,
            ...(result?.error ? { error: result.error } : {}),
          }
          timings.push(timing)
          return timing
        },
      }
    },
    timings() {
      return timings.slice()
    },
    flush(outcome, extra) {
      if (flushed) return
      flushed = true
      if (typeof console === 'undefined' || typeof console.info !== 'function') return
      const totalMs = Date.now() - startedAt
      try {
        console.info(
          JSON.stringify({
            event: 'coach.request',
            traceId,
            requestClass,
            outcome,
            totalMs,
            stages: timings,
            ...(extra ?? {}),
          }),
        )
      } catch {
        // Defensive: stringify should never fail with this shape.
      }
    },
  }
}

/** Wrap an async stage so the tracker is closed even if it throws. */
export async function trackStage<T>(
  tracker: StageTracker,
  stage: CoachStage,
  fn: () => Promise<T> | T,
): Promise<T> {
  const handle = tracker.stage(stage)
  try {
    const result = await fn()
    handle.end({ ok: true })
    return result
  } catch (error) {
    handle.end({ ok: false, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
