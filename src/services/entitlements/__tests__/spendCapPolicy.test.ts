import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_DAILY_SPEND_CAP_USD,
  GLOBAL_DAILY_SPEND_CAP_USD,
  evaluateSpendCaps,
} from '../spendCapPolicy'

describe('spendCapPolicy', () => {
  it('los montos son los aprobados en el spec', () => {
    expect(ACCOUNT_DAILY_SPEND_CAP_USD).toBe(3)
    expect(GLOBAL_DAILY_SPEND_CAP_USD).toBe(5)
  })

  it('debajo de ambos caps, permite', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 1, globalCostUsd: 2 }))
      .toEqual({ exceeded: false })
  })

  it('cuenta en el cap exacto, rechaza por cuenta', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 3, globalCostUsd: 2 }))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('cuenta por encima del cap, rechaza por cuenta', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 3.5, globalCostUsd: 1 }))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('global en el cap exacto con cuenta bajo su cap, rechaza por global', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.5, globalCostUsd: 5 }))
      .toEqual({ exceeded: true, scope: 'global', capUsd: 5 })
  })

  it('cuenta y global exceden a la vez, prioriza el rechazo por cuenta', () => {
    // Rechazo por cuenta es más específico y accionable para el usuario.
    expect(evaluateSpendCaps({ accountCostUsd: 4, globalCostUsd: 6 }))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })
})
