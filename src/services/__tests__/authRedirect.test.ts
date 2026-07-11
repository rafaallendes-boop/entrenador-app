import { describe, expect, it } from 'vitest'
import { NATIVE_AUTH_REDIRECT_URL, resolveAuthRedirectUrl } from '../auth'

describe('auth redirect selection', () => {
  it('uses the custom scheme on native', () => {
    expect(resolveAuthRedirectUrl({
      native: true,
      explicitRedirect: 'https://app.rallyiq.cl/auth/callback',
      webOrigin: 'https://app.rallyiq.cl',
    })).toBe(NATIVE_AUTH_REDIRECT_URL)
  })

  it('preserves the configured web redirect', () => {
    expect(resolveAuthRedirectUrl({
      native: false,
      explicitRedirect: 'https://app.rallyiq.cl/auth/callback',
      webOrigin: 'https://app.rallyiq.cl',
    })).toBe('https://app.rallyiq.cl/auth/callback')
  })

  it('falls back to the current web origin', () => {
    expect(resolveAuthRedirectUrl({
      native: false,
      webOrigin: 'http://localhost:5173',
    })).toBe('http://localhost:5173')
  })
})
