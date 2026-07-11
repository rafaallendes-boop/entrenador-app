import { describe, expect, it } from 'vitest'
import { mapWhoopSport } from '../whoopSportMap'

describe('mapWhoopSport', () => {
  it.each([
    ['squash', 'squash'],
    ['running', 'running'],
    ['cycling', 'cycling'],
    ['weightlifting', 'strength'],
    ['functional fitness', 'strength'],
    ['strength trainer', 'strength'],
    ['hiit', 'strength'],
    ['powerlifting', 'strength'],
    ['yoga', 'mobility'],
    ['pilates', 'mobility'],
    ['stretching', 'mobility'],
  ])('maps %s to %s', (whoopName, appSport) => {
    expect(mapWhoopSport(whoopName)).toBe(appSport)
  })

  it('normalizes casing and separators before mapping', () => {
    expect(mapWhoopSport('  Strength_Trainer ')).toBe('strength')
  })

  it.each(['box fitness', 'tennis', 'padel', 'walking', ''])('returns null for unmapped %s', (name) => {
    expect(mapWhoopSport(name)).toBeNull()
  })
})
