import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ATHLETE_PROFILE_LOCAL_ID,
  getActiveAthleteId,
  setActiveAthleteId,
  getSelfAthleteId,
  setSelfAthleteId,
  isSelfScopeActive,
} from '../activeAthlete'

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

describe('selfAthleteId holder', () => {
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('stores and returns the self athlete id', () => {
    expect(getSelfAthleteId()).toBeNull()
    setSelfAthleteId('ath_self')
    expect(getSelfAthleteId()).toBe('ath_self')
  })

  it('isSelfScopeActive: legacy mode (no active) → true', () => {
    setActiveAthleteId(null)
    expect(isSelfScopeActive()).toBe(true)
  })

  it('isSelfScopeActive: active === self → true', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    expect(isSelfScopeActive()).toBe(true)
  })

  it('isSelfScopeActive: active is a managed athlete → false', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    expect(isSelfScopeActive()).toBe(false)
  })
})
