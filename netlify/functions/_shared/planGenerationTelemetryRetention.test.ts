import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteExpiredCoachRequests,
  deleteExpiredPlanGenerationAttempts,
  deleteExpiredPlanGenerationJobs,
  PLAN_GENERATION_TELEMETRY_RETENTION_DAYS,
  runPlanGenerationTelemetryRetention,
} from './planGenerationTelemetryRetention'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

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

describe('deleteExpiredCoachRequests', () => {
  it('borra filas de coach_requests más viejas que el corte de 90 días', async () => {
    const lt = vi.fn(async () => ({ count: 7, error: null }))
    const from = vi.fn(() => ({ delete: () => ({ lt }) }))
    const now = Date.parse('2026-08-05T12:00:00.000Z')

    const deleted = await deleteExpiredCoachRequests({ from }, now)

    expect(deleted).toBe(7)
    expect(from).toHaveBeenCalledWith('coach_requests')
    expect(lt).toHaveBeenCalledWith(
      'created_at',
      new Date(now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 86_400_000).toISOString(),
    )
  })

  it('falla visiblemente cuando Supabase rechaza la limpieza', async () => {
    const from = () => ({
      delete: () => ({ lt: async () => ({ count: null, error: { message: 'denied' } }) }),
    })

    await expect(deleteExpiredCoachRequests({ from })).rejects.toThrow('denied')
  })
})

describe('runPlanGenerationTelemetryRetention', () => {
  it('limpia las tres tablas en paralelo e incluye coach_requests en la respuesta', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const counts: Record<string, number> = {
      plan_generation_attempts: 3,
      plan_generation_jobs: 4,
      coach_requests: 7,
    }
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => ({ count: counts[table] ?? 0, error: null }),
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()

    expect(response.statusCode).toBe(200)
    expect(from).toHaveBeenCalledTimes(3)
    expect(from).toHaveBeenCalledWith('plan_generation_attempts')
    expect(from).toHaveBeenCalledWith('plan_generation_jobs')
    expect(from).toHaveBeenCalledWith('coach_requests')
    expect(JSON.parse(response.body)).toMatchObject({
      deleted: 3,
      deletedJobs: 4,
      deletedCoachRequests: 7,
    })
  })
})
