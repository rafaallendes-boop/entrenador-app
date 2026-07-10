import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/browser', () => ({
  Browser: { close: vi.fn(async () => undefined) },
}))

import {
  isAuthCallbackUrl,
  processAuthDeepLink,
  resetProcessedAuthCallbacksForTests,
} from '../authDeepLinks'

function authClient() {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
    },
  }
}

describe('native auth deep links', () => {
  beforeEach(() => resetProcessedAuthCallbacksForTests())

  it('recognizes only the RallyIQ auth callback', () => {
    expect(isAuthCallbackUrl('rallyiq://auth/callback?code=abc')).toBe(true)
    expect(isAuthCallbackUrl('rallyiq://settings/callback?code=abc')).toBe(false)
    expect(isAuthCallbackUrl('https://app.rallyiq.cl/auth/callback?code=abc')).toBe(true)
  })

  it('exchanges a PKCE code and returns an internal route', async () => {
    const client = authClient()
    const result = await processAuthDeepLink('rallyiq://auth/callback?code=abc', client)

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc')
    expect(result).toMatchObject({ handled: true, navigateTo: '/' })
  })

  it('restores an implicit session when tokens arrive in the hash', async () => {
    const client = authClient()
    await processAuthDeepLink(
      'rallyiq://auth/callback#access_token=access&refresh_token=refresh',
      client,
    )

    expect(client.auth.setSession).toHaveBeenCalledWith({
      access_token: 'access',
      refresh_token: 'refresh',
    })
  })

  it('does not process the same callback twice', async () => {
    const client = authClient()
    const url = 'rallyiq://auth/callback?code=once'

    const [first, second] = await Promise.all([
      processAuthDeepLink(url, client),
      processAuthDeepLink(url, client),
    ])
    const third = await processAuthDeepLink(url, client)

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(first.handled).toBe(true)
    expect(second.handled).toBe(true)
    expect(third).toMatchObject({ handled: true, duplicate: true })
  })
})
