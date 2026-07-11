import { describe, expect, it } from 'vitest'
import { shouldRegisterServiceWorker } from './registerServiceWorker'

describe('service worker registration policy', () => {
  it('registers in a secure supported web environment', () => {
    expect(shouldRegisterServiceWorker({ native: false, supported: true, secure: true })).toBe(true)
  })

  it('never registers inside Capacitor', () => {
    expect(shouldRegisterServiceWorker({ native: true, supported: true, secure: true })).toBe(false)
  })
})
