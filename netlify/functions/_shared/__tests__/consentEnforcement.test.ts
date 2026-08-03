import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentVersion } from '../../../../src/services/legal/consentDocuments'
import { hasCurrentWhoopConsent } from '../consentEnforcement'
import { isConsentEnforcementEnabled } from '../consentFlag'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('server consent enforcement', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    process.env['SUPABASE_URL'] = 'https://example.supabase.co/'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-key'
    delete process.env['CONSENT_GATE_ENABLED']
  })

  afterEach(() => {
    delete process.env['SUPABASE_URL']
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']
    delete process.env['CONSENT_GATE_ENABLED']
  })

  it('uses the independent server flag', () => {
    expect(isConsentEnforcementEnabled()).toBe(false)
    process.env['CONSENT_GATE_ENABLED'] = 'true'
    expect(isConsentEnforcementEnabled()).toBe(true)
  })

  it('accepts only the current Whoop publication returned by Supabase', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { version: '2026-01-01' },
        { version: getCurrentVersion('whoop_biometric') },
      ],
    })

    await expect(hasCurrentWhoopConsent('user / one')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('user_id=eq.user%20%2F%20one'),
      expect.objectContaining({
        headers: {
          apikey: 'service-key',
          Authorization: 'Bearer service-key',
        },
      }),
    )
  })

  it('rejects an old or missing version', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ version: '2026-01-01' }] })
    await expect(hasCurrentWhoopConsent('user-1')).resolves.toBe(false)

    fetchMock.mockResolvedValue({ ok: true, json: async () => [] })
    await expect(hasCurrentWhoopConsent('user-1')).resolves.toBe(false)
  })

  it('fails closed for missing configuration, HTTP errors, invalid rows, and network failures', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']
    await expect(hasCurrentWhoopConsent('user-1')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-key'
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    await expect(hasCurrentWhoopConsent('user-1')).resolves.toBe(false)

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: 'not-an-array' }) })
    await expect(hasCurrentWhoopConsent('user-1')).resolves.toBe(false)

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(hasCurrentWhoopConsent('user-1')).resolves.toBe(false)
  })
})
