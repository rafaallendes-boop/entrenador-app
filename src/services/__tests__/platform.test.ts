import { beforeEach, describe, expect, it, vi } from 'vitest'

const capacitor = vi.hoisted(() => ({
  getPlatform: vi.fn<() => string>(),
  isNativePlatform: vi.fn<() => boolean>(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

import { getAppPlatform, isIOSPlatform, isNativePlatform, isWebPlatform } from '../platform'

describe('platform', () => {
  beforeEach(() => {
    capacitor.getPlatform.mockReturnValue('web')
    capacitor.isNativePlatform.mockReturnValue(false)
  })

  it('detects web through Capacitor without a user-agent check', () => {
    expect(getAppPlatform()).toBe('web')
    expect(isWebPlatform()).toBe(true)
    expect(isNativePlatform()).toBe(false)
  })

  it('detects native iOS through Capacitor', () => {
    capacitor.getPlatform.mockReturnValue('ios')
    capacitor.isNativePlatform.mockReturnValue(true)

    expect(isNativePlatform()).toBe(true)
    expect(isIOSPlatform()).toBe(true)
    expect(isWebPlatform()).toBe(false)
  })
})
