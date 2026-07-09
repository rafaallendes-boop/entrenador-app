import { describe, expect, it } from 'vitest'
import { recoveryBand } from '../readinessBands'

describe('recoveryBand', () => {
  it('classifies recovery into Whoop color bands', () => {
    expect(recoveryBand(20)).toBe('red')
    expect(recoveryBand(33)).toBe('red')
    expect(recoveryBand(34)).toBe('yellow')
    expect(recoveryBand(66)).toBe('yellow')
    expect(recoveryBand(67)).toBe('green')
    expect(recoveryBand(null)).toBe('none')
    expect(recoveryBand(undefined)).toBe('none')
  })
})
