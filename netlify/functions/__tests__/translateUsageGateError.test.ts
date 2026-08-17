import { describe, expect, it } from 'vitest'
import { translateUsageGateError } from '../_shared/translateUsageGateError'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
} from '../../../src/services/entitlements/usageGateError'
import type { UsageGateHttpError } from '../_shared/usageGate'

function httpError(overrides: Partial<UsageGateHttpError>): UsageGateHttpError {
  return Object.assign(new Error('mensaje'), {
    statusCode: 429,
    errorCode: 'quota_exceeded',
    ...overrides,
  }) as UsageGateHttpError
}

describe('translateUsageGateError', () => {
  it('quota_exceeded → QuotaExceededError con el mismo detail', () => {
    const detail = { bucketId: 'plan_builder_week', limit: 12, remaining: 0 }
    const translated = translateUsageGateError(httpError({ errorCode: 'quota_exceeded', detail }))
    expect(translated).toBeInstanceOf(QuotaExceededError)
    expect((translated as QuotaExceededError).detail).toEqual(detail)
  })

  it('spend_cap_exceeded → SpendCapExceededError con el mismo detail', () => {
    const detail = { scope: 'global' as const, capUsd: 5 }
    const translated = translateUsageGateError(httpError({ errorCode: 'spend_cap_exceeded', detail }))
    expect(translated).toBeInstanceOf(SpendCapExceededError)
    expect((translated as SpendCapExceededError).detail).toEqual(detail)
  })

  it('kill_switch_active → KillSwitchActiveError', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'kill_switch_active', detail: undefined }))
    expect(translated).toBeInstanceOf(KillSwitchActiveError)
  })

  it('server_error → UsageGateUnavailableError, NO se propaga crudo', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'server_error', detail: undefined, statusCode: 503 }))
    expect(translated).toBeInstanceOf(UsageGateUnavailableError)
    expect(translated.message).toBe('mensaje')
  })

  it('quota_exceeded con detail malformado se trata como fallo de infraestructura, no como rechazo corrupto', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'quota_exceeded', detail: { bucketId: 'chat' } }))
    expect(translated).toBeInstanceOf(UsageGateUnavailableError)
    expect(translated).not.toBeInstanceOf(QuotaExceededError)
  })

  it('spend_cap_exceeded con detail ausente se trata como fallo de infraestructura', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'spend_cap_exceeded', detail: undefined }))
    expect(translated).toBeInstanceOf(UsageGateUnavailableError)
    expect(translated).not.toBeInstanceOf(SpendCapExceededError)
  })
})
