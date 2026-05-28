import { describe, expect, it } from 'vitest'
import { BUILD_B, BUILD_C } from '../strengthBlocks/buildBlock'

describe('Build B/C templates respect duration gating', () => {
  it.each([BUILD_B, BUILD_C])('marks accessory slots optional', (block) => {
    const requiredWithoutDurationGate = block.slots.filter((slot) => slot.required && !slot.minDurationMin)
    expect(requiredWithoutDurationGate.length).toBeLessThanOrEqual(3)
  })
})
