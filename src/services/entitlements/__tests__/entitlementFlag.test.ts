import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('isProactiveEntitlementUiEnabled', () => {
  it('esta apagado por defecto', async () => {
    vi.stubEnv('VITE_ENTITLEMENTS', '')
    const { isProactiveEntitlementUiEnabled } = await import('../entitlementFlag')

    expect(isProactiveEntitlementUiEnabled()).toBe(false)
  })

  it('solo la cadena exacta "true" lo enciende', async () => {
    vi.stubEnv('VITE_ENTITLEMENTS', 'true')
    const { isProactiveEntitlementUiEnabled } = await import('../entitlementFlag')

    expect(isProactiveEntitlementUiEnabled()).toBe(true)
  })

  it('un valor mal tipeado no lo enciende a medias', async () => {
    vi.stubEnv('VITE_ENTITLEMENTS', 'TRUE')
    const { isProactiveEntitlementUiEnabled } = await import('../entitlementFlag')

    expect(isProactiveEntitlementUiEnabled()).toBe(false)
  })
})
