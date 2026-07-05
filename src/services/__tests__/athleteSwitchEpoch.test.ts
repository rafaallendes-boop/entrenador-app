import { describe, expect, it } from 'vitest'
import { bumpSwitchEpoch, getSwitchEpoch } from '../athlete/activeAthlete'

describe('switch epoch', () => {
  it('bumpSwitchEpoch increments and getSwitchEpoch reflects it', () => {
    const before = getSwitchEpoch()
    const bumped = bumpSwitchEpoch()

    expect(bumped).toBe(before + 1)
    expect(getSwitchEpoch()).toBe(bumped)
  })
})
