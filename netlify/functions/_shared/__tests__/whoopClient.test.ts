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

  it('refreshes with stored granted scopes and returns rotated tokens', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'newacc', refresh_token: 'newref', expires_in: 3600 }),
    }))

    const res = await ensureFreshToken(
      {
        accessToken: 'old',
        refreshToken: 'ref',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scopes: 'offline read:recovery read:workout',
      },
      { fetchImpl },
    )

    expect(res.accessToken).toBe('newacc')
    expect(res.refreshed?.refreshToken).toBe('newref')
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain('scope=offline+read%3Arecovery+read%3Aworkout')
  })

  it('omits scope when no stored scopes exist', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'newacc', refresh_token: 'newref', expires_in: 3600 }),
    }))

    await ensureFreshToken(
      { accessToken: 'old', refreshToken: 'ref', expiresAt: new Date(Date.now() - 1000).toISOString() },
      { fetchImpl },
    )

    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain('scope=')
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
    expect(raw.workouts).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })
})

function workoutCollectionResponse(records: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ records, next_token: null }),
  }
}

describe('fetchWhoopData workouts', () => {
  it('fetches workouts when requested', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (input) => (
      String(input).includes('/v2/activity/workout')
        ? workoutCollectionResponse([{ id: 'w1' }])
        : workoutCollectionResponse([])
    ))
    const raw = await fetchWhoopData('token', { fetchImpl, includeWorkouts: true })
    expect(raw.workouts).toEqual([{ id: 'w1' }])
  })

  it('returns null and does not request workouts when omitted', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => workoutCollectionResponse([]))
    const raw = await fetchWhoopData('token', { fetchImpl })
    expect(raw.workouts).toBeNull()
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('/v2/activity/workout'))).toBe(false)
  })

  it('returns null on workout 403 without breaking readiness', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (input) => {
      if (String(input).includes('/v2/activity/workout')) {
        return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) }
      }
      return workoutCollectionResponse([{ id: 'r1' }])
    })
    const raw = await fetchWhoopData('token', { fetchImpl, includeWorkouts: true })
    expect(raw.workouts).toBeNull()
    expect(raw.recovery).toEqual([{ id: 'r1' }])
  })

  it('returns an empty array for a successfully fetched empty collection', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => workoutCollectionResponse([]))
    const raw = await fetchWhoopData('token', { fetchImpl, includeWorkouts: true })
    expect(raw.workouts).toEqual([])
  })

  it('uses the explicit workout window independently from readiness', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn<FetchImpl>(async (input) => {
      urls.push(String(input))
      return workoutCollectionResponse([])
    })
    await fetchWhoopData('token', {
      fetchImpl,
      includeWorkouts: true,
      days: 7,
      workoutWindowStartIso: '2026-06-24T00:00:00.000Z',
    })
    const workoutUrl = urls.find((url) => url.includes('/v2/activity/workout'))
    const recoveryUrl = urls.find((url) => url.includes('/v2/recovery'))
    expect(workoutUrl).toContain('2026-06-24')
    expect(recoveryUrl).not.toContain('2026-06-24')
  })
})
