import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveReadScope } from '../readScope'
import { setActiveAthleteId } from '../activeAthlete'

afterEach(() => vi.unstubAllEnvs())
beforeEach(() => setActiveAthleteId(null))

describe('resolveReadScope', () => {
  it('is legacy when flag off (even if hydrated)', () => {
    setActiveAthleteId('ath_u1')
    expect(resolveReadScope()).toEqual({ mode: 'legacy' })
  })

  it('is legacy when flag on but not hydrated (hard precondition)', () => {
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    expect(resolveReadScope()).toEqual({ mode: 'legacy' })
  })

  it('is athlete-scoped only when flag on AND hydrated', () => {
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    setActiveAthleteId('ath_u1')
    expect(resolveReadScope()).toEqual({ mode: 'athlete', athleteId: 'ath_u1' })
  })
})
