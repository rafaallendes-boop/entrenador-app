import { describe, expect, it } from 'vitest'
import {
  EntitlementRequiredError,
  ENTITLEMENT_ERROR_CODE,
  buildEntitlementDetail,
  formatEntitlementMessage,
  isEntitlementRequiredDetail,
} from '../entitlementError'
import { AIProviderError } from '../../ai/types'

describe('buildEntitlementDetail', () => {
  it('arma la metadata tipada', () => {
    expect(buildEntitlementDetail('plan_builder_week', 'advanced', 'free')).toEqual({
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    })
  })
})

describe('isEntitlementRequiredDetail', () => {
  it('acepta una forma válida', () => {
    expect(isEntitlementRequiredDetail({
      requestClass: 'week_creator',
      requiredTier: 'advanced',
      currentTier: 'free',
    })).toBe(true)
  })

  it('rechaza tiers inválidos, campos faltantes y no-objetos', () => {
    expect(isEntitlementRequiredDetail({
      requestClass: 'week_creator', requiredTier: 'pro', currentTier: 'free',
    })).toBe(false)
    expect(isEntitlementRequiredDetail({ requestClass: 'week_creator' })).toBe(false)
    expect(isEntitlementRequiredDetail(null)).toBe(false)
    expect(isEntitlementRequiredDetail('week_creator')).toBe(false)
  })
})

describe('EntitlementRequiredError', () => {
  const detail = buildEntitlementDetail('plan_builder_week', 'advanced', 'free')

  it('es un AIProviderError con el código propio', () => {
    const error = new EntitlementRequiredError(detail)
    expect(error).toBeInstanceOf(AIProviderError)
    expect(error.code).toBe(ENTITLEMENT_ERROR_CODE)
    expect(error.name).toBe('EntitlementRequiredError')
  })

  it('conserva la metadata y no es reintentable', () => {
    const error = new EntitlementRequiredError(detail)
    expect(error.detail).toEqual(detail)
    expect(error.retryable).toBe(false)
  })

  it('el mensaje no depende del parseo: la metadata es la fuente', () => {
    const error = new EntitlementRequiredError(detail)
    expect(error.message).toBe(formatEntitlementMessage(detail))
    expect(error.message.length).toBeGreaterThan(0)
  })
})
