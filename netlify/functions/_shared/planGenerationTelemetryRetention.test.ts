import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteExpiredCoachRequests,
  deleteExpiredPlanGenerationAttempts,
  deleteExpiredPlanGenerationJobs,
  PLAN_GENERATION_TELEMETRY_RETENTION_DAYS,
  runPlanGenerationTelemetryRetention,
  CLIENT_ERROR_RETENTION_DAYS,
  deleteExpiredClientErrorEvents,
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
  it('limpia las cuatro tablas en paralelo e incluye client_error_events en la respuesta', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const counts: Record<string, number> = {
      plan_generation_attempts: 3,
      plan_generation_jobs: 4,
      coach_requests: 7,
      client_error_events: 9,
    }
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => ({ count: counts[table] ?? 0, error: null }),
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()

    expect(response.statusCode).toBe(200)
    expect(from).toHaveBeenCalledTimes(4)
    expect(from).toHaveBeenCalledWith('plan_generation_attempts')
    expect(from).toHaveBeenCalledWith('plan_generation_jobs')
    expect(from).toHaveBeenCalledWith('coach_requests')
    expect(from).toHaveBeenCalledWith('client_error_events')
    expect(JSON.parse(response.body)).toMatchObject({
      deleted: 3,
      deletedJobs: 4,
      deletedCoachRequests: 7,
      deletedClientErrorEvents: 9,
      results: {
        plan_generation_attempts: { status: 'ok', deleted: 3 },
        plan_generation_jobs: { status: 'ok', deleted: 4 },
        coach_requests: { status: 'ok', deleted: 7 },
        client_error_events: { status: 'ok', deleted: 9 },
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
    expect(from).toHaveBeenCalledTimes(4)
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
      { table: 'client_error_events', error: 'client_error_events denied' },
    ])
  })
})

describe('retención de client_error_events', () => {
  // Cutoff propio de 30 días, distinto de los 90 de la telemetría de IA: la
  // fila lleva identidad de cuenta, así que la ventana es más corta a propósito.
  it('usa un corte de 30 días, no el de 90', async () => {
    const cortes: string[] = []
    const client = {
      from: () => ({
        delete: () => ({
          lt: async (_column: string, value: string) => {
            cortes.push(value)
            return { count: 3, error: null }
          },
        }),
      }),
    }

    const ahora = Date.parse('2026-09-07T00:00:00.000Z')
    await deleteExpiredClientErrorEvents(client, ahora)

    expect(cortes[0]).toBe(new Date(ahora - 30 * 24 * 60 * 60 * 1000).toISOString())
    expect(CLIENT_ERROR_RETENTION_DAYS).toBe(30)
    expect(CLIENT_ERROR_RETENTION_DAYS).not.toBe(PLAN_GENERATION_TELEMETRY_RETENTION_DAYS)
  })

  it('entra en el mapa de tablas del cron', async () => {
    const tablas: string[] = []
    const client = {
      from: (table: string) => {
        tablas.push(table)
        return {
          delete: () => ({ lt: async () => ({ count: 0, error: null }) }),
        }
      },
    }
    await deleteExpiredClientErrorEvents(client, Date.now())
    expect(tablas).toContain('client_error_events')
  })

  it('propaga el error de la base como fallo, no como cero borradas', async () => {
    const client = {
      from: () => ({
        delete: () => ({
          lt: async () => ({ count: null, error: { message: 'boom' } }),
        }),
      }),
    }
    await expect(deleteExpiredClientErrorEvents(client, Date.now())).rejects.toThrow('boom')
  })
})

describe('retención de client_error_events — tabla todavía no aplicada', () => {
  // `035` es de aplicación manual y el bundle se despliega antes por diseño.
  // Sin esta tolerancia, el cron devolvería 207 en cada corrida hasta que
  // alguien aplique la migración, volviendo ámbar una función que está sana.
  // PostgREST v12 —lo que corre Supabase— reporta una tabla ausente con
  // `PGRST205` y el texto «Could not find the table … in the schema cache».
  // **Nunca** dice «relation … does not exist»: ese es el mensaje de Postgres
  // crudo, que sólo llegaría por otra vía.
  it('tolera la forma real de PostgREST para tabla ausente', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => table === 'client_error_events'
          ? {
              count: null,
              error: {
                code: 'PGRST205',
                message: "Could not find the table 'public.client_error_events' in the schema cache",
              },
            }
          : { count: 1, error: null },
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.results.client_error_events).toEqual({ status: 'skipped' })
  })

  it('tolera también el código 42P01 de Postgres', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => table === 'client_error_events'
          ? { count: null, error: { code: '42P01', message: 'algo' } }
          : { count: 1, error: null },
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()
    expect(response.statusCode).toBe(200)
  })

  // La clasificación es **por código**, no por texto. Un error sin código no se
  // presume «tabla ausente» aunque su mensaje lo sugiera: preferimos un 207
  // visible antes que tragarnos un fallo real por parecido de texto.
  it('no tolera un error sin código, aunque el texto hable de una relación', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => table === 'client_error_events'
          ? { count: null, error: { message: 'relation "client_error_events" does not exist' } }
          : { count: 1, error: null },
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()
    expect(response.statusCode).toBe(207)
  })

  it('sí reporta fallo si la tabla existe pero el borrado falla', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const from = vi.fn((table: string) => ({
      delete: () => ({
        lt: async () => table === 'client_error_events'
          ? { count: null, error: { message: 'permission denied' } }
          : { count: 1, error: null },
      }),
    }))
    vi.mocked(createClient).mockReturnValue({ from } as never)

    const response = await runPlanGenerationTelemetryRetention()
    expect(response.statusCode).toBe(207)
    expect(JSON.parse(response.body).failures).toEqual([
      { table: 'client_error_events', error: 'permission denied' },
    ])
  })
})
