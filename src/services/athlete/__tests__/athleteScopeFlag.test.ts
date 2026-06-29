import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAthleteScopeEnabled } from '../athleteScopeFlag'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isAthleteScopeEnabled', () => {
  it('defaults to false', () => {
    expect(isAthleteScopeEnabled()).toBe(false)
  })

  it('is true when VITE_ATHLETE_SCOPE=true', () => {
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    expect(isAthleteScopeEnabled()).toBe(true)
  })

  it('stays controlled by the explicit flag in production', () => {
    vi.stubEnv('PROD', true as unknown as string)
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    expect(isAthleteScopeEnabled()).toBe(true)
  })
})
