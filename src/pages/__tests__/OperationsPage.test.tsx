// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ fetchOperationsMetrics: vi.fn() }))
vi.mock('../../services/operations/fetchOperationsMetrics', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/operations/fetchOperationsMetrics')
  >('../../services/operations/fetchOperationsMetrics')
  return { ...actual, fetchOperationsMetrics: mocks.fetchOperationsMetrics }
})

import { OperationsAccessError } from '../../services/operations/fetchOperationsMetrics'
import OperationsPage from '../OperationsPage'

const WINDOW = {
  activity: { accountsUsingAi: 3, accountsPlanning: 2 },
  coach: {
    requests: 12, errors: 2, safetyBlocked: 1, topErrorCodes: [{ code: 'timeout', count: 2 }],
    latencyP50: 900, latencyP90: 2100, latencyP95: 3000, costUsd: 0.1234,
    coverage: { rowsTotal: 12, rowsWithCost: 9, tokensTotal: 1000, tokensWithCost: 600 },
  },
  planBuilder: {
    runs: 2, byOutcome: { succeeded: 2 },
    firstWeekP50: 14000, firstWeekP90: 20000, firstWeekP95: 22000,
    completeP50: 31000, completeP90: 40000, completeP95: 44000,
    costUsd: 0.2, coverage: { rowsTotal: 2, rowsWithCost: 2, tokensTotal: 50, tokensWithCost: 50 },
  },
  attempts: { total: 5, byOutcome: { succeeded: 5 } },
  quota: null,
  totalCostUsd: 0.3234,
  totalCostCoverage: { rowsTotal: 14, rowsWithCost: 11, tokensTotal: 1050, tokensWithCost: 650 },
}

const METRICS = { last24h: WINDOW, last7d: WINDOW, generatedAt: '2026-08-23T00:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('OperationsPage', () => {
  it('muestra estado de carga antes de resolver', () => {
    mocks.fetchOperationsMetrics.mockReturnValue(new Promise(() => {}))
    render(<OperationsPage />)
    expect(screen.getByText(/cargando/i)).toBeTruthy()
  })

  it('403 muestra acceso denegado, no un error técnico', async () => {
    mocks.fetchOperationsMetrics.mockRejectedValue(
      new OperationsAccessError('forbidden', 'Esta vista no está disponible para tu cuenta.'),
    )
    render(<OperationsPage />)
    expect(await screen.findByText(/no está disponible para tu cuenta/i)).toBeTruthy()
  })

  it('un fallo de servidor muestra un mensaje humano', async () => {
    mocks.fetchOperationsMetrics.mockRejectedValue(
      new OperationsAccessError('unavailable', 'No se pudo leer la telemetría.'),
    )
    render(<OperationsPage />)
    expect(await screen.findByText(/no se pudo leer la telemetr/i)).toBeTruthy()
  })

  it('nunca rotula una métrica como usuarios activos', async () => {
    mocks.fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)
    expect(await screen.findAllByText(/cuentas con uso de IA/i)).toHaveLength(2)
    expect(screen.getAllByText(/cuentas con planificación/i)).toHaveLength(2)
    expect(screen.queryByText(/usuarios activos/i)).toBeNull()
  })

  it('muestra declinaciones seguras sin mezclarlas con la tasa de error', async () => {
    mocks.fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)
    expect(await screen.findAllByText('Declinaciones seguras')).toHaveLength(2)
    expect(screen.getAllByText('16.7%')).toHaveLength(2)
  })

  it('publica cobertura junto al costo', async () => {
    mocks.fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)
    expect(await screen.findAllByText(/9\/12 filas/i)).toHaveLength(2)
    expect(screen.getAllByText(/600\/1000 tokens/i)).toHaveLength(2)
  })

  it('quota poblada muestra sus números y el día de inicio', async () => {
    const quota = { startDate: '2026-08-22', requests: 42, costUsd: 0.51, byBucket: { chat: 42 } }
    mocks.fetchOperationsMetrics.mockResolvedValue({
      last24h: { ...WINDOW, quota }, last7d: { ...WINDOW, quota },
      generatedAt: '2026-08-23T00:00:00.000Z',
    })
    render(<OperationsPage />)
    expect(await screen.findAllByText('42')).toHaveLength(2)
    expect(screen.getAllByText('US$0.5100')).toHaveLength(2)
    expect(screen.getAllByText('Requests con cuota desde 2026-08-22')).toHaveLength(2)
    expect(screen.getAllByText('Cuotas por tipo: chat 42')).toHaveLength(2)
    expect(screen.queryByText(/sin datos/i)).toBeNull()
  })

  it('muestra outcome, percentiles completos y costo total de IA', async () => {
    mocks.fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)

    expect(await screen.findAllByText(/Outcomes de corridas: succeeded 2/)).toHaveLength(2)
    expect(screen.getAllByText('1ª semana p50')).toHaveLength(2)
    expect(screen.getAllByText('1ª semana p95')).toHaveLength(2)
    expect(screen.getAllByText('Plan completo p50')).toHaveLength(2)
    expect(screen.getAllByText('Plan completo p95')).toHaveLength(2)
    expect(screen.getAllByText('Costo total IA')).toHaveLength(2)
    expect(screen.getAllByText('US$0.3234')).toHaveLength(2)
    expect(screen.getAllByText(/11\/14 filas/)).toHaveLength(2)
    expect(screen.getAllByText(/650\/1050 tokens/)).toHaveLength(2)
  })

  it('quota en cero no se muestra como sin datos', async () => {
    const quota = { startDate: '2026-08-22', requests: 0, costUsd: 0, byBucket: {} }
    mocks.fetchOperationsMetrics.mockResolvedValue({
      last24h: { ...WINDOW, quota }, last7d: { ...WINDOW, quota },
      generatedAt: '2026-08-23T00:00:00.000Z',
    })
    render(<OperationsPage />)
    expect(await screen.findAllByText('0')).toHaveLength(2)
    expect(screen.queryByText(/sin datos/i)).toBeNull()
  })

  it('quota null se muestra como sin datos', async () => {
    mocks.fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)
    // Dos paneles y dos métricas de cuota por panel (requests y costo).
    expect(await screen.findAllByText(/sin datos/i)).toHaveLength(4)
  })

  it('distingue una latencia sin mediciones de una cuota sin datos', async () => {
    mocks.fetchOperationsMetrics.mockResolvedValue({
      last24h: { ...WINDOW, coach: { ...WINDOW.coach, latencyP50: null } },
      last7d: { ...WINDOW, coach: { ...WINDOW.coach, latencyP50: null } },
      generatedAt: '2026-08-23T00:00:00.000Z',
    })
    render(<OperationsPage />)

    expect(await screen.findAllByText('sin mediciones')).toHaveLength(2)
    expect(screen.getAllByText('sin datos')).toHaveLength(4)
  })

  it('nombra explícitamente la ausencia de intentos', async () => {
    mocks.fetchOperationsMetrics.mockResolvedValue({
      last24h: { ...WINDOW, attempts: { total: 0, byOutcome: {} } },
      last7d: { ...WINDOW, attempts: { total: 0, byOutcome: {} } },
      generatedAt: '2026-08-23T00:00:00.000Z',
    })
    render(<OperationsPage />)

    expect(await screen.findAllByText('Outcomes de intentos: sin intentos')).toHaveLength(2)
  })

  it('permite reintentar una lectura transitoria', async () => {
    mocks.fetchOperationsMetrics
      .mockRejectedValueOnce(new OperationsAccessError('unavailable', 'No se pudo leer la telemetría.'))
      .mockResolvedValueOnce(METRICS)
    render(<OperationsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Operación')).toBeTruthy()
    expect(mocks.fetchOperationsMetrics).toHaveBeenCalledTimes(2)
  })
})
