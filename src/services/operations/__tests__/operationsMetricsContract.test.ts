import { describe, expect, it } from 'vitest'
import {
  OPERATIONS_METRIC_KEYS,
  isOperationsMetrics,
  isOperationsWindow,
} from '../operationsMetricsContract'

const VALID = {
  activity: { accountsUsingAi: 3, accountsPlanning: 1 },
  coach: {
    requests: 10,
    errors: 2,
    safetyBlocked: 1,
    topErrorCodes: [{ code: 'timeout', count: 2 }],
    latencyP50: 900,
    latencyP90: 2100,
    latencyP95: 3000,
    costUsd: 0.12,
    coverage: { rowsTotal: 10, rowsWithCost: 8, tokensTotal: 5000, tokensWithCost: 4200 },
  },
  planBuilder: {
    runs: 2,
    byOutcome: { succeeded: 2 },
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

describe('operationsMetricsContract', () => {
  it('acepta una ventana completa', () => {
    expect(isOperationsWindow(VALID)).toBe(true)
  })

  it('acepta quota poblada, que es el estado de produccion', () => {
    const withQuota = {
      ...VALID,
      quota: {
        startDate: '2026-08-22',
        requests: 42,
        costUsd: 0.51,
        byBucket: { chat: 30, plan_builder_week: 12 },
      },
    }
    expect(isOperationsWindow(withQuota)).toBe(true)
  })

  it('acepta quota null: entornos sin 021 aplicada', () => {
    expect(isOperationsWindow({ ...VALID, quota: null })).toBe(true)
  })

  it('rechaza quota con byBucket no numerico', () => {
    const broken = {
      ...VALID,
      quota: { startDate: '2026-08-22', requests: 1, costUsd: 0, byBucket: { chat: 'muchos' } },
    }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('rechaza un bloque de actividad ausente', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se destructura solo para omitir `activity` del resto
    const { activity: _omitted, ...rest } = VALID
    expect(isOperationsWindow(rest)).toBe(false)
  })

  it('rechaza cobertura incompleta: sin cobertura el costo miente', () => {
    const broken = { ...VALID, coach: { ...VALID.coach, coverage: { rowsTotal: 10 } } }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('rechaza valores no numericos', () => {
    const broken = { ...VALID, activity: { accountsUsingAi: '3', accountsPlanning: 1 } }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('requiere las declinaciones seguras y las mantiene separadas de errores', () => {
    expect(isOperationsWindow({ ...VALID, coach: { ...VALID.coach, safetyBlocked: 3 } })).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se omite el campo obligatorio a propósito
    const { safetyBlocked: _omitted, ...coach } = VALID.coach
    expect(isOperationsWindow({ ...VALID, coach })).toBe(false)
  })

  it('rechaza attempts.byOutcome como array: no es un Record', () => {
    const broken = { ...VALID, attempts: { total: 8, byOutcome: [6, 2] } }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('rechaza planBuilder.byOutcome como array: no es un Record', () => {
    const broken = { ...VALID, planBuilder: { ...VALID.planBuilder, byOutcome: [2] } }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('rechaza quota.byBucket como array: no es un Record', () => {
    const broken = {
      ...VALID,
      quota: { startDate: '2026-08-22', requests: 42, costUsd: 0.51, byBucket: [30, 12] },
    }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('las claves del contrato estan congeladas', () => {
    expect([...OPERATIONS_METRIC_KEYS]).toEqual([
      'activity', 'coach', 'planBuilder', 'attempts', 'quota',
      'totalCostUsd',
      'totalCostCoverage',
    ])
  })

  it('acepta el sobre de métricas completo', () => {
    expect(isOperationsMetrics({
      last24h: VALID,
      last7d: VALID,
      generatedAt: '2026-08-23T00:00:00.000Z',
    })).toBe(true)
  })

  it('rechaza un timestamp de generación inválido', () => {
    expect(isOperationsMetrics({
      last24h: VALID,
      last7d: VALID,
      generatedAt: 'ahora',
    })).toBe(false)
  })

  it('rechaza un costo total ausente', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se destructura solo para omitir el campo obligatorio
    const { totalCostUsd: _omitted, ...rest } = VALID
    expect(isOperationsWindow(rest)).toBe(false)
  })

  it('rechaza cobertura total ausente', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se destructura solo para omitir el campo obligatorio
    const { totalCostCoverage: _omitted, ...rest } = VALID
    expect(isOperationsWindow(rest)).toBe(false)
  })
})

describe('tarjeta de errores de cliente en el contrato del dashboard', () => {
  const base = {
    last24h: VALID,
    last7d: VALID,
    generatedAt: '2026-09-07T00:00:00.000Z',
  }

  // La tarjeta es opcional: un servidor sin `036` responde sin ella y el panel
  // tiene que seguir siendo válido.
  it('acepta una respuesta sin la tarjeta', () => {
    expect(isOperationsMetrics(base)).toBe(true)
  })

  it.each(['ready', 'not_installed', 'unavailable'])(
    'acepta la tarjeta en estado %s',
    (status) => {
      const conTarjeta = {
        ...base,
        clientErrors:
          status === 'ready'
            ? {
                status,
                windows: {
                  day: { groups: [], total: 0, unknown: { total: 0, share: 0, breakdown: [] } },
                  week: { groups: [], total: 0, unknown: { total: 0, share: 0, breakdown: [] } },
                },
                retention: { status: 'ok', expiredRemaining: 0, oldestExpiredAt: null, checkedAt: null },
              }
            : { status },
      }
      expect(isOperationsMetrics(conTarjeta)).toBe(true)
    },
  )

  // Una tarjeta malformada no puede tumbar el resto del panel: se ignora.
  it('sigue siendo válido con una tarjeta malformada', () => {
    expect(isOperationsMetrics({ ...base, clientErrors: { status: 'inventado' } })).toBe(true)
  })
})
