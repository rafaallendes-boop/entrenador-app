import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../../auth', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}))

import { OperationsAccessError, fetchOperationsMetrics } from '../fetchOperationsMetrics'

const WINDOW = {
  activity: { accountsUsingAi: 3, accountsPlanning: 1 },
  coach: {
    requests: 10, errors: 2, topErrorCodes: [],
    latencyP50: 900, latencyP90: 2100, latencyP95: 3000, costUsd: 0.12,
    coverage: { rowsTotal: 10, rowsWithCost: 8, tokensTotal: 5000, tokensWithCost: 4200 },
  },
  planBuilder: {
    runs: 2, byOutcome: { succeeded: 2 },
    firstWeekP50: 14000, firstWeekP90: 20000, firstWeekP95: 22000,
    completeP50: 31000, completeP90: 40000, completeP95: 44000,
    costUsd: 0.23,
    coverage: { rowsTotal: 2, rowsWithCost: 2, tokensTotal: 900, tokensWithCost: 900 },
  },
  attempts: { total: 8, byOutcome: { succeeded: 6, truncated: 2 } },
  quota: null,
  totalCostUsd: 0.35,
  totalCostCoverage: { rowsTotal: 12, rowsWithCost: 10, tokensTotal: 5900, tokensWithCost: 5100 },
}
const PAYLOAD = { last24h: WINDOW, last7d: WINDOW, generatedAt: '2026-08-23T00:00:00.000Z' }

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('fetchOperationsMetrics', () => {
  it('manda el bearer de la sesión al endpoint correcto', async () => {
    const spy = stubFetch(200, PAYLOAD)
    await fetchOperationsMetrics()

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/.netlify/functions/operations-dashboard')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('sin sesión local no llama a la red', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: null } })
    const spy = stubFetch(200, PAYLOAD)

    await expect(fetchOperationsMetrics()).rejects.toMatchObject({ kind: 'unauthenticated' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('403 se distingue de 401: es acceso denegado, no sesión caída', async () => {
    stubFetch(403, { error: 'No autorizado.' })
    await expect(fetchOperationsMetrics()).rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('401 se reporta como sesión requerida', async () => {
    stubFetch(401, { error: 'Sesión requerida.' })
    await expect(fetchOperationsMetrics()).rejects.toMatchObject({ kind: 'unauthenticated' })
  })

  it('500 se reporta como no disponible', async () => {
    stubFetch(500, { error: 'No se pudo leer la telemetría.' })
    await expect(fetchOperationsMetrics()).rejects.toBeInstanceOf(OperationsAccessError)
  })

  it('200 con forma inválida no llega a la UI', async () => {
    stubFetch(200, { last24h: {} })
    await expect(fetchOperationsMetrics()).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('200 devuelve el payload validado', async () => {
    stubFetch(200, PAYLOAD)
    await expect(fetchOperationsMetrics()).resolves.toEqual(PAYLOAD)
  })
})
