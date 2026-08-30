import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readOperationsMetrics } from '../_shared/operationsMetrics'

const ORIGINAL_ENV = { ...process.env }

const WINDOW = {
  activity: { accountsUsingAi: 2, accountsPlanning: 1 },
  coach: {
    requests: 4, errors: 1, safetyBlocked: 0, topErrorCodes: [{ code: 'timeout', count: 1 }],
    latencyP50: 800, latencyP90: 1500, latencyP95: 1800, costUsd: 0.05,
    coverage: { rowsTotal: 4, rowsWithCost: 3, tokensTotal: 100, tokensWithCost: 80 },
  },
  planBuilder: {
    runs: 1, byOutcome: { succeeded: 1 },
    firstWeekP50: 1, firstWeekP90: 1, firstWeekP95: 1,
    completeP50: 2, completeP90: 2, completeP95: 2,
    costUsd: 0.1,
    coverage: { rowsTotal: 1, rowsWithCost: 1, tokensTotal: 10, tokensWithCost: 10 },
  },
  attempts: { total: 2, byOutcome: { succeeded: 2 } },
  quota: null,
  totalCostUsd: 0.15,
  totalCostCoverage: { rowsTotal: 5, rowsWithCost: 4, tokensTotal: 110, tokensWithCost: 90 },
}

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }))
}

describe('readOperationsMetrics', () => {
  it('consulta las dos ventanas y las devuelve etiquetadas', async () => {
    const spy = stubFetch(() => ok(WINDOW))
    const result = await readOperationsMetrics(Date.parse('2026-08-23T12:00:00Z'))

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result.last24h.activity.accountsUsingAi).toBe(2)
    expect(result.last7d.activity.accountsUsingAi).toBe(2)
    expect(result.generatedAt).toBe('2026-08-23T12:00:00.000Z')
  })

  it('envia los dos p_since correctos: 24 h y 7 dias', async () => {
    const bodies: string[] = []
    stubFetch((_url, init) => {
      bodies.push(String(init?.body))
      return ok(WINDOW)
    })
    await readOperationsMetrics(Date.parse('2026-08-23T12:00:00Z'))

    expect(bodies).toContain(JSON.stringify({ p_since: '2026-08-22T12:00:00.000Z' }))
    expect(bodies).toContain(JSON.stringify({ p_since: '2026-08-16T12:00:00.000Z' }))
  })

  it('usa el service role y llama al RPC por nombre', async () => {
    const spy = stubFetch(() => ok(WINDOW))
    await readOperationsMetrics(Date.now())

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/read_operations_metrics')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer service-role-key')
  })

  it('sin service role configurado falla con 500, sin llamar a la red', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']
    const spy = stubFetch(() => ok(WINDOW))

    await expect(readOperationsMetrics(Date.now())).rejects.toMatchObject({ statusCode: 500 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('RPC ausente (404) es 500 explicito: la migracion no fue aplicada', async () => {
    // El body tiene que tener la forma VALIDA de WINDOW a proposito: si el
    // unico motivo de rechazo fuera un payload mal formado, este test
    // pasaria igual aunque se elimine el chequeo de `response.ok` y dejaria
    // de discriminar la rama que dice proteger. Con body valido, la unica
    // razon posible del rechazo es el status 404.
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 })))
    await expect(readOperationsMetrics(Date.now())).rejects.toMatchObject({
      statusCode: 500,
      diagnostics: { upstreamStatus: 404, upstreamBody: expect.stringContaining('PGRST202') },
    })
  })

  it('respuesta con forma inesperada NO se propaga a la UI', async () => {
    stubFetch(() => ok({ activity: { accountsUsingAi: 'muchas' } }))
    await expect(readOperationsMetrics(Date.now())).rejects.toMatchObject({ statusCode: 500 })
  })

  it('quota null se preserva tal cual, sin convertirse en ceros', async () => {
    stubFetch(() => ok({ ...WINDOW, quota: null }))
    const result = await readOperationsMetrics(Date.now())
    expect(result.last24h.quota).toBeNull()
  })
})
