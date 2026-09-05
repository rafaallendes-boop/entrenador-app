import { describe, expect, it } from 'vitest'
import { readStoredEntitlementRole } from '../entitlementService'

describe('espejo local del rol', () => {
  it('devuelve un rol persistido válido', () => {
    expect(readStoredEntitlementRole({
      userId: 'u1', tier: 'advanced', expiresAt: null, confirmedAt: 1, accountRole: 'coach',
    })).toBe('coach')
  })

  it('un espejo anterior sin rol queda unknown', () => {
    expect(readStoredEntitlementRole({
      userId: 'u1', tier: 'advanced', expiresAt: null, confirmedAt: 1,
    })).toBe('unknown')
  })

  it('un rol corrupto o un espejo ausente queda unknown', () => {
    expect(readStoredEntitlementRole({
      userId: 'u1', tier: 'free', expiresAt: null, confirmedAt: 1, accountRole: 'wat',
    } as never)).toBe('unknown')
    expect(readStoredEntitlementRole(null)).toBe('unknown')
  })
})
