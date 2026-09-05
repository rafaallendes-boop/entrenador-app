import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { callHandler } from './helpers/coachTestHarness'

/**
 * Las lecturas role-aware (`user_entitlements`, `athlete_memberships`) usan
 * `READ_TIMEOUT_MS = 3_000` cada una. El presupuesto del proveedor se calcula
 * desde `requestReceivedAt` contra `MAX_FUNCTION_WALLCLOCK_MS = 24_000`, así
 * que encadenarlas detrás de auth le resta hasta 3 s a cada request
 * coach-operated — y en modo `audit` la sombra que las consume se descarta.
 */
describe('lecturas de autorización del coach', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('inicia la lectura de membresía sin esperar a que resuelva auth', async () => {
    let membershipStarted = false
    let authSawMembershipStarted: boolean | null = null

    const fetchMock = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('/auth/v1/user')) {
        // Ceder el control repetidamente: si la lectura de membresía corre en
        // paralelo, ya arrancó cuando auth está por resolver.
        for (let i = 0; i < 20; i++) await Promise.resolve()
        authSawMembershipStarted = membershipStarted
        return { ok: true, status: 200, json: async () => ({ id: 'user-1' }) }
      }
      if (href.includes('/rest/v1/athlete_memberships')) {
        membershipStarted = true
        return { ok: true, status: 200, json: async () => [] }
      }
      if (href.includes('/rest/v1/user_entitlements')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ tier: 'advanced', expires_at: null, account_role: 'coach' }],
        }
      }
      if (href.includes('generateContent')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    await callHandler({
      systemPrompt: 'sys',
      userMessage: 'hola',
      requestClass: 'chat_general',
      traceId: 't-parallel',
      targetAthleteId: 'ath_m_abc',
    })

    expect(authSawMembershipStarted).toBe(true)
  })
})
