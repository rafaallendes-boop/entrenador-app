import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureFreshToken, fetchWhoopData, type FetchImpl } from '../whoopClient'

beforeEach(() => {
  process.env['WHOOP_TOKEN_URL'] = 'https://api.prod.whoop.com/oauth/oauth2/token'
  process.env['WHOOP_CLIENT_ID'] = 'cid'
  process.env['WHOOP_CLIENT_SECRET'] = 'sec'
  process.env['WHOOP_API_BASE'] = 'https://api.prod.whoop.com/developer'
})

describe('ensureFreshToken', () => {
  it('returns existing token when not expired', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new Error('should not refresh')
    }

    const res = await ensureFreshToken(
      { accessToken: 'acc', refreshToken: 'ref', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      { fetchImpl },
    )

    expect(res.accessToken).toBe('acc')
    expect(res.refreshed).toBeUndefined()
  })

  it('refreshes when expired and returns rotated tokens', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'newacc', refresh_token: 'newref', expires_in: 3600 }),
    }))

    const res = await ensureFreshToken(
      { accessToken: 'old', refreshToken: 'ref', expiresAt: new Date(Date.now() - 1000).toISOString() },
      { fetchImpl },
    )

    expect(res.accessToken).toBe('newacc')
    expect(res.refreshed?.refreshToken).toBe('newref')
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain('scope=offline')
  })
})

describe('fetchWhoopData', () => {
  it('follows nextToken pagination for collections', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (input) => {
      const url = String(input)
      const hasNext = url.includes('nextToken=n1')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          records: [{ page: hasNext ? 2 : 1 }],
          next_token: hasNext ? undefined : 'n1',
        }),
      }
    })

    const raw = await fetchWhoopData('acc', { fetchImpl, days: 7 })

    expect(raw.recovery).toHaveLength(2)
    expect(raw.sleep).toHaveLength(2)
    expect(raw.cycles).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })
})
