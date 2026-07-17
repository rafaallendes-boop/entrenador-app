import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../syncService', () => ({
  pullWeekSessionsForAthlete: vi.fn(async () => 'completed' as const),
  pullWeekDayLogsForAthlete: vi.fn(async () => 'completed' as const),
  pullWeekSummaryRowForAthlete: vi.fn(async () => 'completed' as const),
}))

import { db } from '../../../db/db'
import * as syncService from '../../syncService'
import {
  clearCoachPlanningHydrationRegistry,
  ensureWeekHydrated,
  isWeekHydrated,
} from '../coachPlanningHydration'

const owner = 'user-1'
const week = '2026-07-13'
const scope = { athleteId: 'ath_m_a', includeLegacy: false }
const now = Date.now()

describe('coach planning hydration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    clearCoachPlanningHydrationRegistry()
    db.close()
    await db.delete()
    await db.open()
    await db.athletes.bulkPut([
      {
        id: 'ath_m_a', ownerAccountId: owner, linkedAccountId: null,
        status: 'active', createdAt: now, updatedAt: now,
      },
      {
        id: 'ath_m_b', ownerAccountId: owner, linkedAccountId: null,
        status: 'active', createdAt: now, updatedAt: now,
      },
      {
        id: 'ath_archived', ownerAccountId: owner, linkedAccountId: null,
        status: 'archived', createdAt: now, updatedAt: now,
      },
    ])
  })

  afterEach(() => {
    clearCoachPlanningHydrationRegistry()
    db.close()
  })

  it('marca solo después de completar las tres fuentes', async () => {
    await ensureWeekHydrated(owner, scope, week)

    expect(syncService.pullWeekSessionsForAthlete).toHaveBeenCalledOnce()
    expect(syncService.pullWeekDayLogsForAthlete).toHaveBeenCalledOnce()
    expect(syncService.pullWeekSummaryRowForAthlete).toHaveBeenCalledOnce()
    expect(isWeekHydrated(owner, scope.athleteId, week)).toBe(true)
  })

  it('deduplica llamadas simultáneas de la misma clave', async () => {
    let release!: () => void
    vi.mocked(syncService.pullWeekSessionsForAthlete).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return 'completed'
    })

    const first = ensureWeekHydrated(owner, scope, week)
    const second = ensureWeekHydrated(owner, scope, week)
    await vi.waitFor(() => expect(syncService.pullWeekSessionsForAthlete).toHaveBeenCalledOnce())
    release()
    await Promise.all([first, second])
    expect(syncService.pullWeekSummaryRowForAthlete).toHaveBeenCalledOnce()
  })

  it('un outcome incompleto falla y no deja marca', async () => {
    vi.mocked(syncService.pullWeekDayLogsForAthlete).mockResolvedValueOnce('unavailable')
    await expect(ensureWeekHydrated(owner, scope, week)).rejects.toThrow(
      'No se pudo hidratar la semana completa.',
    )
    expect(isWeekHydrated(owner, scope.athleteId, week)).toBe(false)
  })

  it('un clear durante el pull veta la marca del ticket anterior', async () => {
    vi.mocked(syncService.pullWeekSummaryRowForAthlete).mockImplementationOnce(async () => {
      clearCoachPlanningHydrationRegistry()
      return 'completed'
    })
    await ensureWeekHydrated(owner, scope, week)
    expect(isWeekHydrated(owner, scope.athleteId, week)).toBe(false)
  })

  it('clear por atleta no veta una hidratación simultánea de otro atleta', async () => {
    const other = { athleteId: 'ath_m_b', includeLegacy: false }
    vi.mocked(syncService.pullWeekSummaryRowForAthlete).mockImplementation(async (_owner, athleteId) => {
      if (athleteId === scope.athleteId) clearCoachPlanningHydrationRegistry(scope.athleteId)
      return 'completed'
    })
    await Promise.all([
      ensureWeekHydrated(owner, scope, week),
      ensureWeekHydrated(owner, other, week),
    ])
    expect(isWeekHydrated(owner, scope.athleteId, week)).toBe(false)
    expect(isWeekHydrated(owner, other.athleteId, week)).toBe(true)
  })

  it('rechaza fuera del roster y archivado antes de iniciar pulls', async () => {
    await expect(ensureWeekHydrated(
      owner,
      { athleteId: 'ath_missing', includeLegacy: false },
      week,
    )).rejects.toThrow('El atleta no pertenece a tu roster.')
    await expect(ensureWeekHydrated(
      owner,
      { athleteId: 'ath_archived', includeLegacy: false },
      week,
    )).rejects.toThrow('Este atleta está archivado')
    expect(syncService.pullWeekSessionsForAthlete).not.toHaveBeenCalled()
  })
})
