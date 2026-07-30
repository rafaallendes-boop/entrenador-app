import { describe, expect, it } from 'vitest'

import { isLocalFallbackEligible } from '../fallbackEligibility'

describe('fallbackEligibility', () => {
  it('rechaza el fallback local para la firma de squash no resuelta', () => {
    expect(isLocalFallbackEligible('quality.squash.signature_uniqueness_unresolved')).toBe(false)
  })

  it('mantiene elegibles los demás errores y la ausencia de clasificación', () => {
    expect(isLocalFallbackEligible('validation')).toBe(true)
    expect(isLocalFallbackEligible(undefined)).toBe(true)
  })
})
