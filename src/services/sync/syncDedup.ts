/**
 * Scoped promise deduplication helper.
 *
 * Replaces three duplicated patterns in syncService.ts (drainQueue, pullAll,
 * runFullSync). Concurrent calls with the same `userId` share the in-flight
 * promise; calls with a different userId start a new operation (the previous
 * one is left running but no longer tracked here).
 *
 * The active entry is cleared in `finally`, so failures clean up too.
 */

export interface ScopedDedup<T> {
  /**
   * Run `factory` deduped by userId. If a call is already in-flight for this
   * userId, returns its promise; otherwise creates a new one and tracks it.
   */
  run(userId: string, factory: () => Promise<T>): Promise<T>
  /** Active in-flight userId, or null. Useful for diagnostics/tests. */
  activeUserId(): string | null
}

export function createScopedDedup<T>(): ScopedDedup<T> {
  let active: { userId: string; promise: Promise<T> } | null = null

  return {
    run(userId, factory) {
      if (active && active.userId === userId) {
        return active.promise
      }
      const promise = factory()
      active = { userId, promise }
      const cleanup = () => {
        if (active?.promise === promise) {
          active = null
        }
      }
      promise.then(cleanup, cleanup)
      return promise
    },
    activeUserId() {
      return active?.userId ?? null
    },
  }
}
