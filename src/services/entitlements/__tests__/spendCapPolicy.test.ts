import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER,
  GLOBAL_DAILY_SPEND_CAP_USD,
  evaluateSpendCaps,
  resolveAccountDailySpendCapUsd,
} from '../spendCapPolicy'

describe('spendCapPolicy', () => {
  it('los montos por tier son los aprobados en el spec', () => {
    expect(ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER).toEqual({
      free: 0.3,
      weekly: 0.8,
      advanced: 3,
    })
    expect(GLOBAL_DAILY_SPEND_CAP_USD).toBe(5)
  })

  it('un free gasta menos antes de que dispare el breaker que un advanced', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.5, globalCostUsd: 0 }, 'free'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 0.3 })
    expect(evaluateSpendCaps({ accountCostUsd: 0.5, globalCostUsd: 0 }, 'advanced'))
      .toEqual({ exceeded: false })
  })

  it('el cap exacto ya cuenta como alcanzado, en cada tier', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.8, globalCostUsd: 0 }, 'weekly'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 0.8 })
  })

  it('debajo de ambos caps, permite', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 1, globalCostUsd: 2 }, 'advanced'))
      .toEqual({ exceeded: false })
  })

  it('cuenta en el cap exacto, rechaza por cuenta', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 3, globalCostUsd: 2 }, 'advanced'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('cuenta por encima del cap, rechaza por cuenta', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 3.5, globalCostUsd: 1 }, 'advanced'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('global en el cap exacto con cuenta bajo su cap, rechaza por global', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.5, globalCostUsd: 5 }, 'advanced'))
      .toEqual({ exceeded: true, scope: 'global', capUsd: 5 })
  })

  it('cuenta y global exceden a la vez, prioriza el rechazo por cuenta', () => {
    // Rechazo por cuenta es más específico y accionable para el usuario.
    expect(evaluateSpendCaps({ accountCostUsd: 4, globalCostUsd: 6 }, 'advanced'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('un tier fuera de la unión cae al cap más restrictivo', () => {
    expect(resolveAccountDailySpendCapUsd('inventado' as never)).toBe(0.3)
  })
})
