import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consentEnabled: vi.fn(() => false),
  hasConsent: vi.fn(async (userId: string) => {
    void userId
    return false
  }),
  resolveAuth: vi.fn(async () => ({ userId: 'user-1', token: 'token' })),
  insertOAuthState: vi.fn(async () => undefined),
  consumeOAuthState: vi.fn(async () => ({ userId: 'user-1' })),
  upsertConnection: vi.fn(async () => undefined),
  exchangeCode: vi.fn(async () => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: '2026-08-03T12:00:00.000Z',
  })),
  getConnection: vi.fn(async () => null),
  deleteAllWhoopData: vi.fn(async () => undefined),
  deleteExpiredOAuthStates: vi.fn(async () => undefined),
  runWhoopSync: vi.fn(async () => ({ ok: true })),
  revokeWhoopAccess: vi.fn(async () => undefined),
  getDb: vi.fn(),
}))

vi.mock('../_shared/consentFlag', () => ({
  isConsentEnforcementEnabled: mocks.consentEnabled,
}))
vi.mock('../_shared/consentEnforcement', () => ({
  hasCurrentWhoopConsent: mocks.hasConsent,
}))
vi.mock('../_shared/planGenerationShared', () => ({
  json: (statusCode: number, body: object) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  resolveAuthContext: mocks.resolveAuth,
}))
vi.mock('../_shared/cors', () => ({
  corsPreflight: () => ({ statusCode: 204, body: '' }),
}))
vi.mock('../_shared/whoopOAuth', () => ({
  OAUTH_STATE_TTL_MS: 600_000,
  WHOOP_SCOPES: ['offline'],
  buildAuthorizeUrl: () => 'https://whoop.test/authorize',
  generateOAuthState: () => 'state-1',
  getServiceRoleDb: mocks.getDb,
}))
vi.mock('../_shared/whoopSupabase', () => ({
  insertOAuthState: mocks.insertOAuthState,
  consumeOAuthState: mocks.consumeOAuthState,
  upsertConnection: mocks.upsertConnection,
  getConnection: mocks.getConnection,
  deleteAllWhoopData: mocks.deleteAllWhoopData,
  deleteExpiredOAuthStates: mocks.deleteExpiredOAuthStates,
  reconcileWorkouts: vi.fn(),
  resolveSelfAthleteId: vi.fn(),
  setSyncResult: vi.fn(),
  upsertBiometricReadings: vi.fn(),
  upsertReadiness: vi.fn(),
  upsertWorkouts: vi.fn(),
}))
vi.mock('../_shared/whoopClient', () => ({
  exchangeCode: mocks.exchangeCode,
  ensureFreshToken: vi.fn(),
  fetchWhoopData: vi.fn(),
  revokeWhoopAccess: mocks.revokeWhoopAccess,
}))
vi.mock('../_shared/whoopNormalize', () => ({
  normalizeWhoop: vi.fn(),
  normalizeWorkouts: vi.fn(),
}))
vi.mock('../_shared/whoopSync', () => ({
  runWhoopSync: mocks.runWhoopSync,
}))
vi.mock('../_shared/tokenCrypto', () => ({ CURRENT_KEY_VERSION: 1 }))

import { handler as oauthStartHandler } from '../whoop-oauth-start'
import { handler as oauthCallbackHandler } from '../whoop-oauth-callback'
import { handler as syncHandler } from '../whoop-sync'
import { runWhoopCron } from '../_shared/whoopCron'

function event(input: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token' },
    body: '{}',
    queryStringParameters: null,
    ...input,
  } as never
}

describe('Whoop consent handler wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consentEnabled.mockReturnValue(false)
    mocks.hasConsent.mockResolvedValue(false)
    mocks.resolveAuth.mockResolvedValue({ userId: 'user-1', token: 'token' })
    mocks.consumeOAuthState.mockResolvedValue({ userId: 'user-1' })
    mocks.getConnection.mockResolvedValue(null)
    mocks.getDb.mockReturnValue({
      from: () => ({
        select: async () => ({ data: [], error: null }),
      }),
    })
    process.env['WHOOP_CLIENT_ID'] = 'client-id'
    process.env['WHOOP_REDIRECT_URI'] = 'https://app.test/callback'
    process.env['WHOOP_AUTHORIZE_URL'] = 'https://whoop.test/oauth'
  })

  it('preserves OAuth start when the server flag is off', async () => {
    const response = await oauthStartHandler(event({ body: JSON.stringify({ nativeReturn: false }) }), {} as never)

    expect(response?.statusCode).toBe(200)
    expect(mocks.hasConsent).not.toHaveBeenCalled()
    expect(mocks.insertOAuthState).toHaveBeenCalledOnce()
  })

  it('blocks OAuth start before creating provider state when consent is missing', async () => {
    mocks.consentEnabled.mockReturnValue(true)

    const response = await oauthStartHandler(event({}), {} as never)

    expect(response?.statusCode).toBe(403)
    expect(JSON.parse(response?.body ?? '{}')).toEqual({
      ok: false,
      error: 'Consentimiento biométrico requerido.',
      code: 'consent_required',
    })
    expect(mocks.hasConsent).toHaveBeenCalledWith('user-1')
    expect(mocks.insertOAuthState).not.toHaveBeenCalled()
  })

  it('redirects the callback before token exchange or persistence', async () => {
    mocks.consentEnabled.mockReturnValue(true)

    const response = await oauthCallbackHandler(event({
      httpMethod: 'GET',
      queryStringParameters: { code: 'code-1', state: 'ios.state-1' },
    }), {} as never)

    expect(response?.statusCode).toBe(302)
    expect(response?.headers?.Location).toBe('rallyiq://settings?whoop=error&reason=consent_required')
    expect(mocks.hasConsent).toHaveBeenCalledWith('user-1')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('blocks sync POST but always permits DELETE', async () => {
    mocks.consentEnabled.mockReturnValue(true)

    const blocked = await syncHandler(event({ httpMethod: 'POST' }), {} as never)
    expect(blocked?.statusCode).toBe(403)
    expect(JSON.parse(blocked?.body ?? '{}').code).toBe('consent_required')
    expect(mocks.runWhoopSync).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.consentEnabled.mockReturnValue(true)
    mocks.getConnection.mockResolvedValue(null)
    mocks.getDb.mockReturnValue({ from: vi.fn() })
    const deleted = await syncHandler(event({ httpMethod: 'DELETE' }), {} as never)

    expect(deleted?.statusCode).toBe(200)
    expect(mocks.hasConsent).not.toHaveBeenCalled()
    expect(mocks.deleteAllWhoopData).toHaveBeenCalledWith(expect.anything(), 'user-1')
  })

  it('skips only the cron account without current consent and continues', async () => {
    mocks.consentEnabled.mockReturnValue(true)
    mocks.hasConsent.mockImplementation(async (userId: string) => userId === 'user-2')
    mocks.getDb.mockReturnValue({
      from: () => ({
        select: async () => ({
          data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
          error: null,
        }),
      }),
    })

    const response = await runWhoopCron()

    expect(response).toEqual({ statusCode: 200, body: 'ok' })
    expect(mocks.runWhoopSync).toHaveBeenCalledTimes(1)
    expect(mocks.runWhoopSync).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'user-2', trigger: 'cron' },
    )
    expect(mocks.deleteExpiredOAuthStates).toHaveBeenCalledOnce()
  })
})
