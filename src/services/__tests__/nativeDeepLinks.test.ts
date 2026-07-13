import { describe, expect, it } from 'vitest'
import { getWhoopCallbackPath } from '../nativeDeepLinks'

describe('getWhoopCallbackPath', () => {
  it('returns to settings after a successful native Whoop OAuth flow', () => {
    expect(getWhoopCallbackPath('rallyiq://settings?whoop=connected'))
      .toBe('/settings?whoop=connected')
  })

  it('preserves the native Whoop error result', () => {
    expect(getWhoopCallbackPath('rallyiq://settings?whoop=error'))
      .toBe('/settings?whoop=error')
  })

  it('ignores unrelated or malformed deep links', () => {
    expect(getWhoopCallbackPath('rallyiq://auth/callback?code=abc')).toBeNull()
    expect(getWhoopCallbackPath('not a url')).toBeNull()
  })
})
