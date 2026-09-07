import { describe, expect, it, vi } from 'vitest'
import { MissingClientErrorRpcError, readClientErrorMetrics } from './clientErrorMetrics'

const VENTANA = {
  total: 3,
  groups: [
    {
      fingerprint: '0123456789abcdef',
      release: 'r1',
      source: 'react_boundary',
      diagnostic_code: 'render_failure',
      error_name: 'TypeError',
      component: 'PlanBuilderV2',
      route: '/plans/builder',
      count: 2,
      accounts: 1,
      first_seen: '2026-09-06T00:00:00.000Z',
      last_seen: '2026-09-06T10:00:00.000Z',
    },
  ],
  unknown: {
    total: 1,
    share: 0.3333,
    breakdown: [
      { source: 'window_error', error_name: 'RangeError', route: '/week', release: 'r1', count: 1 },
    ],
  },
}

const SALUD = { expiredRemaining: 0, oldestExpiredAt: null, checkedAt: '2026-09-07T04:00:00.000Z' }

function callRpcOk() {
  return vi.fn(async (fn: string) => (fn === 'read_client_error_metrics' ? VENTANA : SALUD))
}

describe('readClientErrorMetrics — ready', () => {
  it('devuelve las dos ventanas y la salud de retención', async () => {
    const metrics = await readClientErrorMetrics({ callRpc: callRpcOk() })

    expect(metrics.status).toBe('ready')
    expect(metrics.windows?.day.total).toBe(3)
    expect(metrics.windows?.week.total).toBe(3)
    expect(metrics.retention?.status).toBe('ok')
  })

  it('mapea los grupos a camelCase sin perder dimensiones', async () => {
    const metrics = await readClientErrorMetrics({ callRpc: callRpcOk() })
    const grupo = metrics.windows?.day.groups[0]

    expect(grupo).toMatchObject({
      fingerprint: '0123456789abcdef',
      diagnosticCode: 'render_failure',
      errorName: 'TypeError',
      component: 'PlanBuilderV2',
      route: '/plans/builder',
      count: 2,
      accounts: 1,
    })
  })

  it('nunca expone user_id ni email', async () => {
    const metrics = await readClientErrorMetrics({ callRpc: callRpcOk() })
    expect(JSON.stringify(metrics)).not.toMatch(/user_id|email|@/)
  })

  it('consulta dos ventanas distintas', async () => {
    const callRpc = callRpcOk()
    await readClientErrorMetrics({ callRpc })

    const calls = callRpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    const sinces = calls
      .filter((call) => call[0] === 'read_client_error_metrics')
      .map((call) => call[1]['p_since'])
    expect(new Set(sinces).size).toBe(2)
  })

  // `ready` con total cero significa «sin eventos». Es un estado distinto de
  // ausencia y de fallo, y el panel lo dice con esas palabras.
  it('distingue cero eventos de ausencia', async () => {
    const vacio = { total: 0, groups: [], unknown: { total: 0, share: 0, breakdown: [] } }
    const callRpc = vi.fn(async (fn: string) =>
      fn === 'read_client_error_metrics' ? vacio : SALUD,
    )
    const metrics = await readClientErrorMetrics({ callRpc })

    expect(metrics.status).toBe('ready')
    expect(metrics.windows?.day.total).toBe(0)
  })
})

describe('readClientErrorMetrics — ausencia vs fallo', () => {
  it('reporta not_installed cuando la RPC no existe', async () => {
    const callRpc = vi.fn(async () => {
      throw new MissingClientErrorRpcError('read_client_error_metrics')
    })
    const metrics = await readClientErrorMetrics({ callRpc })

    expect(metrics.status).toBe('not_installed')
    expect(metrics.windows).toBeUndefined()
  })

  // Un timeout o un permiso denegado no pueden presentarse como cero: sería
  // el peor resultado posible para un panel de operación.
  it('reporta unavailable ante un fallo cualquiera, no cero', async () => {
    const callRpc = vi.fn(async () => {
      throw new Error('timeout')
    })
    const metrics = await readClientErrorMetrics({ callRpc })

    expect(metrics.status).toBe('unavailable')
    expect(metrics.windows).toBeUndefined()
  })
})

describe('readClientErrorMetrics — salud de la retención', () => {
  it('marca atraso cuando quedan filas vencidas', async () => {
    const callRpc = vi.fn(async (fn: string) =>
      fn === 'read_client_error_metrics'
        ? VENTANA
        : { expiredRemaining: 12, oldestExpiredAt: '2026-07-01T00:00:00.000Z', checkedAt: '2026-09-07T04:00:00.000Z' },
    )
    const metrics = await readClientErrorMetrics({ callRpc })

    expect(metrics.retention?.status).toBe('behind')
    expect(metrics.retention?.expiredRemaining).toBe(12)
  })

  // Si la consulta de salud falla, el estado es unavailable — nunca «sano».
  it('no reporta salud ok cuando su consulta falla', async () => {
    const callRpc = vi.fn(async (fn: string) => {
      if (fn === 'read_client_error_metrics') return VENTANA
      throw new Error('sin permiso')
    })
    const metrics = await readClientErrorMetrics({ callRpc })

    expect(metrics.status).toBe('ready')
    expect(metrics.retention?.status).toBe('unavailable')
    expect(metrics.retention?.expiredRemaining).toBeNull()
  })

  it('la salud se consulta aunque no haya eventos recientes', async () => {
    const vacio = { total: 0, groups: [], unknown: { total: 0, share: 0, breakdown: [] } }
    const callRpc = vi.fn(async (fn: string) =>
      fn === 'read_client_error_metrics' ? vacio : SALUD,
    )
    await readClientErrorMetrics({ callRpc })

    expect(callRpc.mock.calls.some((call) => call[0] === 'read_client_error_retention_health')).toBe(true)
  })
})
