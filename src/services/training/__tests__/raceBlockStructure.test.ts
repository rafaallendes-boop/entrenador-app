import { describe, expect, it } from 'vitest'
import { RACE } from '../strengthBlocks/raceBlock'

describe('raceBlock structure', () => {
  it('has at least 3 slots including core and mobility cool-down', () => {
    expect(RACE.slots.length).toBeGreaterThanOrEqual(3)
    const patterns = RACE.slots.map((slot) => slot.pattern)
    expect(patterns).toContain('core')
    expect(patterns).toContain('mobility')
  })

  it('keeps high-fatigue patterns optional in race week', () => {
    const highFatigue = RACE.slots.filter((slot) => ['plyo', 'push', 'pull', 'squat', 'hinge'].includes(slot.pattern))
    expect(highFatigue.every((slot) => !slot.required)).toBe(true)
  })
})
