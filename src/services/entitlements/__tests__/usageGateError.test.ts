import { describe, expect, it } from 'vitest'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
  isQuotaExceededDetail,
  isSpendCapExceededDetail,
} from '../usageGateError'

describe('usageGateError', () => {
  it('QuotaExceededError lleva code, detail y no es reintentable', () => {
    const error = new QuotaExceededError({ bucketId: 'chat', limit: 15, remaining: 0 })
    expect(error.code).toBe('quota_exceeded')
    expect(error.retryable).toBe(false)
    expect(error.detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
    expect(error.message.length).toBeGreaterThan(0)
  })

  it('SpendCapExceededError lleva scope y capUsd', () => {
    const error = new SpendCapExceededError({ scope: 'global', capUsd: 5 })
    expect(error.code).toBe('spend_cap_exceeded')
    expect(error.retryable).toBe(false)
    expect(error.detail).toEqual({ scope: 'global', capUsd: 5 })
  })

  it('KillSwitchActiveError no requiere detail', () => {
    const error = new KillSwitchActiveError()
    expect(error.code).toBe('kill_switch_active')
    expect(error.retryable).toBe(false)
  })

  it('isQuotaExceededDetail valida forma completa', () => {
    expect(isQuotaExceededDetail({ bucketId: 'chat', limit: 15, remaining: 0 })).toBe(true)
    expect(isQuotaExceededDetail({ bucketId: 'chat', limit: 15 })).toBe(false)
    expect(isQuotaExceededDetail(null)).toBe(false)
    expect(isQuotaExceededDetail('chat')).toBe(false)
  })

  it('isSpendCapExceededDetail valida scope y capUsd', () => {
    expect(isSpendCapExceededDetail({ scope: 'account', capUsd: 3 })).toBe(true)
    expect(isSpendCapExceededDetail({ scope: 'other', capUsd: 3 })).toBe(false)
    expect(isSpendCapExceededDetail({ scope: 'account' })).toBe(false)
  })

  it('UsageGateUnavailableError usa server_error, no un código de rechazo de política', () => {
    const error = new UsageGateUnavailableError('RPC de cuota devolvió 500.')
    expect(error.code).toBe('server_error')
    expect(error.retryable).toBe(false)
    expect(error.message).toBe('RPC de cuota devolvió 500.')
  })
})
