import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl, generateOAuthState, WHOOP_SCOPES } from '../whoopOAuth'

describe('whoopOAuth', () => {
  it('builds an authorize URL with required params', () => {
    const url = new URL(buildAuthorizeUrl({
      authorizeUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth',
      clientId: 'cid',
      redirectUri: 'https://app/cb',
      scopes: ['read:recovery', 'read:sleep'],
      state: 'st1',
    }))

    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/cb')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('st1')
    expect(url.searchParams.get('scope')).toBe('read:recovery read:sleep')
  })

  it('generates a non-empty unique state', () => {
    const a = generateOAuthState()
    const b = generateOAuthState()
    expect(a).toHaveLength(64)
    expect(a).not.toBe(b)
  })

  it('requests offline scope so WHOOP returns a refresh token', () => {
    expect(WHOOP_SCOPES).toContain('offline')
  })
})
