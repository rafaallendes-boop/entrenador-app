/**
 * Pure offline-queue primitives backed by localStorage.
 *
 * Extracted from syncService.ts in Fase 1 of the refactor. This module owns:
 * - serialization to/from localStorage (`loadQueue` / `saveQueue`)
 * - enqueue with overflow handling
 * - identity helpers used by the dedup logic
 *
 * It does NOT own:
 * - cross-tab notification (lives in syncService for now)
 * - diagnostics emission (lives in syncService for now)
 * - retry/backoff (see syncRetry.ts)
 *
 * Notification of "queue changed" is delivered via a single optional listener
 * registered with `setQueueChangeListener()`. syncService wires this up at
 * module load so that `saveQueue` triggers `refreshQueueDiagnostics` +
 * broadcast without this module having to know about either.
 */

import {
  compactQueue,
  getOfflineOpEntityId,
  getEntityIdFromPayload,
  type OfflineOp,
  type SupabaseTable,
} from '../syncUtils'
import { QUEUE_KEY } from './syncStorageKeys'

/** Hard cap on queued ops. Older ops are dropped (with a log emitted upstream). */
export const MAX_QUEUE_SIZE = 500

let onQueueChanged: (() => void) | null = null

/**
 * Register the listener invoked after every successful saveQueue.
 * syncService wires this once at startup; tests can override.
 */
export function setQueueChangeListener(fn: (() => void) | null): void {
  onQueueChanged = fn
}

export function loadQueue(): OfflineOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item): item is OfflineOp => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as OfflineOp).userId === 'string' &&
        typeof (item as OfflineOp).table === 'string' &&
        typeof (item as OfflineOp).action === 'string' &&
        typeof (item as OfflineOp).payload === 'object' &&
        (item as OfflineOp).payload !== null &&
        typeof (item as OfflineOp).enqueuedAt === 'number'
      )
    })
  } catch {
    return []
  }
}

export function saveQueue(queue: OfflineOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Ignore storage quota failures.
  }
  onQueueChanged?.()
}

export interface EnqueueOptions {
  onOverflow?: (dropped: OfflineOp) => void
}

export function enqueue(op: OfflineOp, opts?: EnqueueOptions): void {
  const queue = mergeConcurrentQueueOps(compactQueue(loadQueue(), op), op)
  if (queue.length >= MAX_QUEUE_SIZE) {
    const dropped = queue.shift()
    if (dropped) opts?.onOverflow?.(dropped)
  }
  saveQueue(queue)
}

export function mergeConcurrentQueueOps(queue: OfflineOp[], incoming: OfflineOp): OfflineOp[] {
  let merged = queue
  const latest = loadQueue()
  for (const op of latest) {
    if (shouldDropConcurrentQueueOp(op, incoming)) continue
    if (merged.some((item) => offlineOpsShareIdentity(item, op))) continue
    merged = compactQueue(merged, op)
  }
  return merged
}

export function shouldDropConcurrentQueueOp(existing: OfflineOp, incoming: OfflineOp): boolean {
  return existing.userId === incoming.userId
    && existing.table === incoming.table
    && getOfflineOpEntityId(existing) === getOfflineOpEntityId(incoming)
    && getOfflineOpEntityId(incoming) != null
}

export function offlineOpsShareIdentity(a: OfflineOp, b: OfflineOp): boolean {
  return a.userId === b.userId
    && a.table === b.table
    && a.action === b.action
    && a.enqueuedAt === b.enqueuedAt
    && getOfflineOpEntityId(a) === getOfflineOpEntityId(b)
}

/**
 * Removes from the queue every op for `(userId, table, payload.id)` whose
 * enqueuedAt is at or before `cutoffEnqueuedAt`. Used after a successful
 * push to garbage-collect ops superseded by the just-completed write.
 */
export function clearQueuedOpsForEntityOlderThan(
  userId: string,
  table: SupabaseTable,
  payload: Record<string, unknown>,
  cutoffEnqueuedAt: number,
): void {
  const entityId = getEntityIdFromPayload(table, payload)
  if (!entityId) return

  const queue = loadQueue()
  const nextQueue = queue.filter((op) => {
    if (op.userId !== userId || op.table !== table) return true
    if (getOfflineOpEntityId(op) !== entityId) return true
    return op.enqueuedAt > cutoffEnqueuedAt
  })

  if (nextQueue.length !== queue.length) {
    saveQueue(nextQueue)
  }
}

/** Drops every queued op for `(userId, table)` across the listed tables. */
export function clearQueuedOpsForTables(userId: string, tables: Iterable<SupabaseTable>): void {
  const selectedTables = new Set(tables)
  if (selectedTables.size === 0) return

  try {
    const queue = loadQueue().filter((op) => op.userId !== userId || !selectedTables.has(op.table))
    saveQueue(queue)
  } catch {
    // Ignore storage failures.
  }
}
