import { describe, expect, it } from 'vitest'
import {
  EntitlementRequiredError,
  buildEntitlementDetail,
  toChatEntitlementOffer,
} from '../../services/entitlements/entitlementError'

describe('traductor de oferta de entitlement para chat', () => {
  it('traduce el error tipado a metadata de oferta', () => {
    const detail = buildEntitlementDetail('week_creator', 'weekly', 'free')

    expect(toChatEntitlementOffer(new EntitlementRequiredError(detail))).toEqual(detail)
  })

  it('deja los demas errores en su camino habitual', () => {
    expect(toChatEntitlementOffer(new Error('timeout'))).toBeNull()
  })
})
