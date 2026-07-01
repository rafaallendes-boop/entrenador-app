import { describe, expect, it } from 'vitest'
import { effectiveAthleteKey, isInAthleteScope, isScopedAthleteId } from '../effectiveAthleteKey'

describe('isScopedAthleteId', () => {
  it('is true only for a real scoped id', () => {
    expect(isScopedAthleteId('ath_A')).toBe(true)
  })

  it('treats null, undefined, empty, and default as legacy', () => {
    expect(isScopedAthleteId(null)).toBe(false)
    expect(isScopedAthleteId(undefined)).toBe(false)
    expect(isScopedAthleteId('')).toBe(false)
    expect(isScopedAthleteId('default')).toBe(false)
  })
})

describe('effectiveAthleteKey', () => {
  it('uses the row scoped id when present', () => {
    expect(effectiveAthleteKey('ath_A', 'ath_A')).toBe('ath_A')
    expect(effectiveAthleteKey('ath_B', 'ath_A')).toBe('ath_B')
  })

  it('falls back to the active athlete for legacy rows', () => {
    expect(effectiveAthleteKey(null, 'ath_A')).toBe('ath_A')
    expect(effectiveAthleteKey(undefined, 'ath_A')).toBe('ath_A')
    expect(effectiveAthleteKey('default', 'ath_A')).toBe('ath_A')
  })

  it('uses the legacy key when no active athlete exists', () => {
    expect(effectiveAthleteKey(null, null)).toBe('legacy')
    expect(effectiveAthleteKey('default', null)).toBe('legacy')
  })
})

describe('isInAthleteScope', () => {
  it('active athlete owns its own rows and legacy rows', () => {
    expect(isInAthleteScope('ath_A', 'ath_A')).toBe(true)
    expect(isInAthleteScope(null, 'ath_A')).toBe(true)
    expect(isInAthleteScope('default', 'ath_A')).toBe(true)
    expect(isInAthleteScope('ath_B', 'ath_A')).toBe(false)
  })

  it('includes all rows when no active athlete exists', () => {
    expect(isInAthleteScope('ath_A', null)).toBe(true)
    expect(isInAthleteScope(null, null)).toBe(true)
  })
})
