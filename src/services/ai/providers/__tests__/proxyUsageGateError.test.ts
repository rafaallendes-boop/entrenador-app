import { describe, expect, it } from 'vitest'
import { classifyProxyHttpError } from '../proxyHttpError'
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError } from '../../../entitlements/usageGateError'

function res(status: number): Response {
  return new Response(null, { status })
}

describe('classifyProxyHttpError — usage gate', () => {
  it('429 quota_exceeded con detail válido lanza QuotaExceededError tipado', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(429), {
        error: 'Alcanzaste el cupo diario.',
        errorCode: 'quota_exceeded',
        detail: { bucketId: 'chat', limit: 15, remaining: 0 },
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(QuotaExceededError)
    expect((thrown as QuotaExceededError).detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
  })

  it('429 spend_cap_exceeded con detail válido lanza SpendCapExceededError tipado', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(429), {
        error: 'Presupuesto diario alcanzado.',
        errorCode: 'spend_cap_exceeded',
        detail: { scope: 'global', capUsd: 5 },
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SpendCapExceededError)
    expect((thrown as SpendCapExceededError).detail).toEqual({ scope: 'global', capUsd: 5 })
  })

  it('503 kill_switch_active lanza KillSwitchActiveError sin exigir detail', () => {
    expect(() => classifyProxyHttpError(res(503), {
      error: 'IA pausada.',
      errorCode: 'kill_switch_active',
    })).toThrowError(KillSwitchActiveError)
  })

  it('429 quota_exceeded con detail malformado NO usa el error tipado', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(429), { error: 'x', errorCode: 'quota_exceeded', detail: { bucketId: 'chat' } })
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(QuotaExceededError)
  })

  it('429 spend_cap_exceeded con detail malformado NO usa el error tipado', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(429), { error: 'x', errorCode: 'spend_cap_exceeded', detail: { scope: 'account' } })
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(SpendCapExceededError)
  })

  it('429 genérico sin errorCode sigue cayendo a rate_limit', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(429), { error: 'demasiadas solicitudes' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(QuotaExceededError)
    expect(thrown).not.toBeInstanceOf(SpendCapExceededError)
    expect(thrown).toMatchObject({ code: 'rate_limit', retryable: true })
  })

  it('503 sin errorCode kill_switch_active sigue cayendo a timeout', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(503), { error: 'gateway down' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(KillSwitchActiveError)
    expect(thrown).toMatchObject({ code: 'timeout', retryable: true })
  })

  it('503 server_error conserva la falla de infraestructura y no la vuelve timeout', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(503), {
        error: 'RPC increment_ai_usage_if_under_limit devolvió 400.',
        errorCode: 'server_error',
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'server_error', retryable: false })
  })
})
