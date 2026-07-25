import { describe, expect, it, vi } from 'vitest'

import { PLAN_GENERATION_POLL_INTERVAL_MS } from '../pollingConfig'
import { pollPlanGeneration } from '../pollPlanGeneration'

describe('PLAN_GENERATION_POLL_INTERVAL_MS', () => {
  it('is the 4s cadence the client already used', () => {
    expect(PLAN_GENERATION_POLL_INTERVAL_MS).toBe(4_000)
  })

  it('is the default the poller sleeps for between snapshots', async () => {
    vi.useFakeTimers()
    try {
      const fetched: number[] = []
      const controller = new AbortController()
      const run = pollPlanGeneration({
        planId: 'plan-1',
        signal: controller.signal,
        _fetchFn: async () => {
          fetched.push(Date.now())
          if (fetched.length >= 2) controller.abort()
          return null
        },
      })

      // Primera consulta inmediata, luego duerme el intervalo compartido.
      await vi.advanceTimersByTimeAsync(PLAN_GENERATION_POLL_INTERVAL_MS - 1)
      expect(fetched).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetched).toHaveLength(2)
      await run
    } finally {
      vi.useRealTimers()
    }
  })
})
