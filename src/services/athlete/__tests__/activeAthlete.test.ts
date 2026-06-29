import { beforeEach, describe, expect, it } from 'vitest'
import { ATHLETE_PROFILE_LOCAL_ID, getActiveAthleteId, setActiveAthleteId } from '../activeAthlete'

describe('activeAthlete', () => {
  beforeEach(() => setActiveAthleteId(null))

  it('exposes the legacy local profile id constant', () => {
    expect(ATHLETE_PROFILE_LOCAL_ID).toBe('default')
  })

  it('returns null until hydrated', () => {
    expect(getActiveAthleteId()).toBeNull()
  })

  it('returns the hydrated id once set', () => {
    setActiveAthleteId('ath_123')
    expect(getActiveAthleteId()).toBe('ath_123')
  })

  it('can be reset back to null', () => {
    setActiveAthleteId('ath_123')
    setActiveAthleteId(null)
    expect(getActiveAthleteId()).toBeNull()
  })
})
