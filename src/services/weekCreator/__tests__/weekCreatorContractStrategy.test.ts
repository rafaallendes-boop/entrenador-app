import { describe, expect, it } from 'vitest'

import { resolveWeekCreatorContractStrategy } from '../weekCreatorContractStrategy'

describe('resolveWeekCreatorContractStrategy', () => {
  it('uses the compact v1 contract by default', () => {
    expect(resolveWeekCreatorContractStrategy(undefined)).toBe('skeleton_v1')
  })

  it('supports an explicit detailed-contract rollback', () => {
    expect(resolveWeekCreatorContractStrategy('detailed')).toBe('detailed')
    expect(resolveWeekCreatorContractStrategy(' DETAILED ')).toBe('detailed')
  })
})
