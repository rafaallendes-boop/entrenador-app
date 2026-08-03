import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

vi.mock('../../sync/syncSupabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'access-token' } },
      }),
    },
  }),
}))
vi.mock('../../apiUrl', () => ({ resolveApiUrl: (path: string) => path }))

import {
  isWhoopConsentRequiredError,
  startWhoopConnect,
  syncWhoopNow,
} from '../whoopApi'

describe('startWhoopConnect', () => {
  beforeEach(() => fetchMock.mockReset())

  it('propaga consent_required como error tipado', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        error: 'Consentimiento biométrico requerido.',
        code: 'consent_required',
      }),
    })

    const error = await startWhoopConnect().catch((caught: unknown) => caught)
    expect(isWhoopConsentRequiredError(error)).toBe(true)
    expect(error).toMatchObject({
      status: 403,
      code: 'consent_required',
      message: 'Consentimiento biométrico requerido.',
    })
  })
})

describe('syncWhoopNow', () => {
  beforeEach(() => fetchMock.mockReset())

  it('returns a typed failed result for consent_required responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        error: 'Consentimiento biométrico requerido.',
        code: 'consent_required',
      }),
    })

    await expect(syncWhoopNow()).resolves.toEqual({
      ok: false,
      reason: 'error',
      error: 'Consentimiento biométrico requerido.',
      code: 'consent_required',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/.netlify/functions/whoop-sync',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer access-token' },
      },
    )
  })
})
