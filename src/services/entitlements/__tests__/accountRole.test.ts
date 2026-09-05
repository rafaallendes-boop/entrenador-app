import { describe, expect, it } from 'vitest'
import { parseAccountRole } from '../entitlementPolicy'
import { USER_ENTITLEMENT_SELECT_COLUMNS } from '../entitlementColumns'

describe('parseAccountRole', () => {
  it('acepta los dos roles persistidos', () => {
    expect(parseAccountRole('athlete')).toBe('athlete')
    expect(parseAccountRole('coach')).toBe('coach')
  })

  it('devuelve null para cualquier otra cosa, incluido "unknown"', () => {
    // `unknown` es un estado RESUELTO en runtime, nunca un valor persistido.
    for (const value of ['unknown', '', 'COACH', null, undefined, 0, {}]) {
      expect(parseAccountRole(value)).toBeNull()
    }
  })
})

describe('columnas del select', () => {
  it('pide account_role', () => {
    expect(USER_ENTITLEMENT_SELECT_COLUMNS).toContain('account_role')
  })
})
