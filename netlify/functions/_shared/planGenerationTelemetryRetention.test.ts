import { describe, expect, it, vi } from 'vitest'
import {
  deleteExpiredPlanGenerationAttempts,
  deleteExpiredPlanGenerationJobs,
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

describe('deleteExpiredPlanGenerationJobs', () => {
  it('deletes job rows older than the retention window', async () => {
    const tables: string[] = []
    const client = {
      from(table: string) {
        tables.push(table)
        return { delete() { return { lt: async () => ({ count: 4, error: null }) } } }
      },
    }
    const deleted = await deleteExpiredPlanGenerationJobs(client as never, Date.UTC(2026, 6, 24))
    expect(deleted).toBe(4)
    expect(tables).toContain('plan_generation_jobs')
  })
})
