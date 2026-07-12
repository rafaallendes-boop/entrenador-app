import { describe, expect, it, vi } from 'vitest'
import {
  deleteExpiredPlanGenerationAttempts,
  PLAN_GENERATION_TELEMETRY_RETENTION_DAYS,
} from './planGenerationTelemetryRetention'

describe('deleteExpiredPlanGenerationAttempts', () => {
  it('deletes only rows strictly older than the 90-day cutoff', async () => {
    const lt = vi.fn(async () => ({ count: 3, error: null }))
    const from = vi.fn(() => ({ delete: () => ({ lt }) }))
    const now = Date.parse('2026-07-12T12:00:00.000Z')

    const deleted = await deleteExpiredPlanGenerationAttempts({ from }, now)

    expect(deleted).toBe(3)
    expect(from).toHaveBeenCalledWith('plan_generation_attempts')
    expect(lt).toHaveBeenCalledWith(
      'created_at',
      new Date(now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 86_400_000).toISOString(),
    )
  })

  it('fails visibly when Supabase rejects cleanup', async () => {
    const from = () => ({
      delete: () => ({
        lt: async () => ({ count: null, error: { message: 'denied' } }),
      }),
    })
    await expect(deleteExpiredPlanGenerationAttempts({ from })).rejects.toThrow('denied')
  })
})
