import { afterEach, describe, expect, it, vi } from 'vitest'

// El handler usa `stream(...)` al importar; para estas pruebas de borde se
// necesita la función pura, no el wrapper de Lambda.
vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

const mocks = vi.hoisted(() => ({
  insertCoachRequestRow: vi.fn(async () => 'ok' as const),
}))

vi.mock('../_shared/coachRequestTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_shared/coachRequestTelemetry')>()
  return { ...actual, insertCoachRequestRow: mocks.insertCoachRequestRow }
})

type HandlerResult = { statusCode: number; body?: unknown }
type CoachHandler = (
  event: unknown,
  context: unknown,
  callback: () => void,
) => Promise<HandlerResult>

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function loadHandler(mode: 'audit' | 'enforce' = 'audit'): Promise<CoachHandler> {
  vi.resetModules()
  vi.stubEnv('COACH_PROXY_REQUIRE_AUTH', 'true')
  vi.stubEnv('ENTITLEMENTS_ENABLED', 'true')
  vi.stubEnv('COACH_AUTHZ_MODE', mode)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
  const { handler } = await import('../coach')
  return handler as unknown as CoachHandler
}

async function callAssistant(handler: CoachHandler, targetAthleteId?: string): Promise<HandlerResult> {
  return handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      systemPrompt: 's',
      userMessage: 'hola',
      requestClass: 'coach_assistant_message',
      stream: false,
      ...(targetAthleteId ? { targetAthleteId } : {}),
    }),
    headers: { authorization: 'Bearer tok' },
  }, {}, () => undefined)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('coach.ts — auditoría de autorización Coach', () => {
  it('en audit conserva el permiso legacy y registra wouldDeny sin exponer IDs', async () => {
    const provider = vi.fn(() => response({
      candidates: [{ content: { parts: [{ text: 'respuesta' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }))
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes('/auth/v1/user')) return response({ id: 'user-private-id' })
      if (href.includes('/rest/v1/user_entitlements')) {
        return response([{ tier: 'advanced', expires_at: null, account_role: 'athlete' }])
      }
      if (href.includes('generativelanguage.googleapis.com')) return provider()
      throw new Error(`URL inesperada: ${href}`)
    }))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const handler = await loadHandler()

    const result = await callAssistant(handler)

    expect(result.statusCode).toBe(200)
    expect(provider).toHaveBeenCalledOnce()
    const auditCall = info.mock.calls.find(([event]) => event === '[coach-authz]')
    expect(auditCall).toEqual([
      '[coach-authz]',
      expect.objectContaining({
        capability: 'coach_assistant_message',
        legacyAllowed: true,
        shadowAllowed: false,
        wouldDeny: true,
        wouldGrant: false,
      }),
    ])
    expect(JSON.stringify(auditCall)).not.toContain('user-private-id')
  })

  it('en enforce, un rol ilegible responde 503 antes de proveedor y cuota', async () => {
    const provider = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes('/auth/v1/user')) return response({ id: 'user-1' })
      if (href.includes('/rest/v1/user_entitlements')) return response({ error: 'boom' }, 500)
      if (href.includes('generativelanguage.googleapis.com')) return provider()
      throw new Error(`URL inesperada: ${href}`)
    }))
    const handler = await loadHandler('enforce')

    const result = await callAssistant(handler)

    expect(result.statusCode).toBe(503)
    expect(JSON.parse(String(result.body))).toMatchObject({ errorCode: 'server_error' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('en enforce, una falla al leer membresía no se oculta como 403 de delegación', async () => {
    const provider = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes('/auth/v1/user')) return response({ id: 'user-1' })
      if (href.includes('/rest/v1/user_entitlements')) {
        return response([{ tier: 'advanced', expires_at: null, account_role: 'coach' }])
      }
      if (href.includes('/rest/v1/athlete_memberships')) return response({ error: 'boom' }, 500)
      if (href.includes('generativelanguage.googleapis.com')) return provider()
      throw new Error(`URL inesperada: ${href}`)
    }))
    const handler = await loadHandler('enforce')

    const result = await callAssistant(handler, 'ath_m_1')

    expect(result.statusCode).toBe(503)
    expect(JSON.parse(String(result.body))).toMatchObject({ errorCode: 'server_error' })
    expect(provider).not.toHaveBeenCalled()
  })

  // La constante no negociable del plan: en `audit` la ruta efectiva es la
  // legacy, EXACTAMENTE. Un fallo de lectura no puede cortar el request, o un
  // blip de Supabase —o desplegar antes de `028`/`013b`— tumba el chat con
  // ambos flags apagados.
  it('en audit, un rol ilegible conserva la ruta legacy y sólo deja evidencia', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes('/auth/v1/user')) return response({ id: 'user-1' })
      if (href.includes('/rest/v1/user_entitlements')) return response({ error: 'boom' }, 500)
      if (href.includes('generativelanguage.googleapis.com')) {
        return response({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
      }
      throw new Error(`URL inesperada: ${href}`)
    }))
    const handler = await loadHandler('audit')

    const result = await callAssistant(handler)

    expect(result.statusCode).not.toBe(503)
    const auditCall = info.mock.calls.find(([event]) => event === '[coach-authz]')
    expect(auditCall?.[1]).toMatchObject({
      shadowUnavailable: 'entitlement_unreadable',
      shadowAllowed: null,
      wouldDeny: false,
      wouldGrant: false,
    })
  })

  it('en audit, una membresía ilegible conserva la ruta legacy y deja evidencia', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes('/auth/v1/user')) return response({ id: 'user-1' })
      if (href.includes('/rest/v1/user_entitlements')) {
        return response([{ tier: 'advanced', expires_at: null, account_role: 'athlete' }])
      }
      if (href.includes('/rest/v1/athlete_memberships')) return response({ error: 'boom' }, 500)
      if (href.includes('generativelanguage.googleapis.com')) {
        return response({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
      }
      throw new Error(`URL inesperada: ${href}`)
    }))
    const handler = await loadHandler('audit')

    const result = await callAssistant(handler, 'ath_m_1')

    expect(result.statusCode).not.toBe(503)
    const auditCall = info.mock.calls.find(([event]) => event === '[coach-authz]')
    expect(auditCall?.[1]).toMatchObject({ shadowUnavailable: 'membership_unreadable' })
  })

  it('en enforce, la falta de membresía NO se representa como oferta de plan', async () => {
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes('/auth/v1/user')) return response({ id: 'user-1' })
      if (href.includes('/rest/v1/user_entitlements')) {
        return response([{ tier: 'advanced', expires_at: null, account_role: 'coach' }])
      }
      // Lectura correcta, sin filas: el coach no gestiona a ese atleta.
      if (href.includes('/rest/v1/athlete_memberships')) return response([])
      throw new Error(`URL inesperada: ${href}`)
    }))
    const handler = await loadHandler('enforce')

    const result = await callAssistant(handler, 'ath_ajeno')

    expect(result.statusCode).toBe(403)
    const body = JSON.parse(String(result.body))
    expect(body.errorCode).toBe('coach_access_required')
    expect(body.detail).toMatchObject({ reason: 'membership' })
    // Un coach Avanzado no puede recibir «sube a Avanzado».
    expect(body.error.toLowerCase()).not.toContain('plan')
  })
})
