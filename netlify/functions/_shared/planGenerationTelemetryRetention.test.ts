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
      results: {
        plan_generation_attempts: { status: 'ok', deleted: 3 },
        plan_generation_jobs: { status: 'ok', deleted: 4 },
        coach_requests: { status: 'ok', deleted: 7 },
      },
      failures: [],
    })
  })

  it('reporta éxito parcial sin perder los deletes si coach_requests todavía no existe', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => table === 'coach_requests'
          ? { count: null, error: { message: 'relation "coach_requests" does not exist' } }
          : { count: table === 'plan_generation_attempts' ? 3 : 4, error: null },
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(207)
    expect(from).toHaveBeenCalledTimes(3)
    expect(body).toMatchObject({
      deleted: 3,
      deletedJobs: 4,
      deletedCoachRequests: null,
      results: {
        plan_generation_attempts: { status: 'ok', deleted: 3 },
        plan_generation_jobs: { status: 'ok', deleted: 4 },
        coach_requests: {
          status: 'failed',
          error: 'relation "coach_requests" does not exist',
        },
      },
      failures: [{
        table: 'coach_requests',
        error: 'relation "coach_requests" does not exist',
      }],
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[plan-generation-telemetry-retention] coach_requests cleanup failed',
      expect.any(Error),
    )
  })

  it('devuelve 500 con diagnóstico por tabla cuando fallan todas las limpiezas', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => ({ count: null, error: { message: `${table} denied` } }),
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(500)
    expect(body.failures).toEqual([
      { table: 'plan_generation_attempts', error: 'plan_generation_attempts denied' },
      { table: 'plan_generation_jobs', error: 'plan_generation_jobs denied' },
      { table: 'coach_requests', error: 'coach_requests denied' },
    ])
  })
})
