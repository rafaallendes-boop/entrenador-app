import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readEntitlementRecord,
  readVerifiedMembership,
  resolveEntitlementTier,
} from '../resolveEntitlement'

const OLD_ENV = { ...process.env }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_ANON_KEY'] = 'anon'
})
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...OLD_ENV } })

describe('readEntitlementRecord', () => {
  it('fila presente devuelve tier y rol', async () => {
    mockFetch(() => json([{ tier: 'advanced', expires_at: null, account_role: 'coach' }]))
    expect(await readEntitlementRecord('t')).toEqual({
      status: 'present', row: { tier: 'advanced', expiresAt: null }, accountRole: 'coach',
    })
  })

  it('cero filas es ausencia CONFIRMADA, no fallo', async () => {
    mockFetch(() => json([]))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'absent' })
  })

  it('respuesta no-ok es fallo de lectura', async () => {
    mockFetch(() => new Response('boom', { status: 500 }))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })

  it('error de red es fallo de lectura y no lanza', async () => {
    mockFetch(() => { throw new Error('network') })
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })

  it('account_role fuera de la unión es fallo, NO athlete', async () => {
    mockFetch(() => json([{ tier: 'free', expires_at: null, account_role: 'wat' }]))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })

  it('expires_at ilegible es fallo de lectura', async () => {
    mockFetch(() => json([{ tier: 'advanced', expires_at: 'no-es-fecha', account_role: 'athlete' }]))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })
})

describe('resolveEntitlementTier no cambia', () => {
  it('ausencia confirmada sigue dando free', async () => {
    mockFetch(() => json([]))
    expect(await resolveEntitlementTier('t')).toBe('free')
  })
  it('fallo de lectura sigue dando free y sin lanzar', async () => {
    mockFetch(() => { throw new Error('network') })
    expect(await resolveEntitlementTier('t')).toBe('free')
  })
  it('fila vencida sigue dando free', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    mockFetch(() => json([{ tier: 'advanced', expires_at: past, account_role: 'athlete' }]))
    expect(await resolveEntitlementTier('t')).toBe('free')
  })
})

describe('readVerifiedMembership', () => {
  it('devuelve sólo una membresía visible por RLS', async () => {
    const fetchMock = vi.fn(
      (url: unknown, init?: RequestInit) => {
        void url
        void init
        return json([{ athlete_id: 'ath_m_1', role: 'coach' }])
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(readVerifiedMembership('tok-1', 'ath_m_1')).resolves.toEqual({
      status: 'present', membership: { athleteId: 'ath_m_1', role: 'coach' },
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/rest/v1/athlete_memberships')
    expect(String(url)).toContain('athlete_id=eq.ath_m_1')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok-1' })
  })

  it('distingue una ausencia confirmada de una lectura rota', async () => {
    mockFetch(() => json([]))
    await expect(readVerifiedMembership('t', 'ath_m_1')).resolves.toEqual({ status: 'absent' })

    mockFetch(() => new Response('boom', { status: 500 }))
    await expect(readVerifiedMembership('t', 'ath_m_1')).resolves.toEqual({ status: 'unreadable' })
  })

  it.each([
    [{ athlete_id: 'ath_m_1', role: 'owner' }],
    [{ athlete_id: 'ath_m_other', role: 'coach' }],
    [{ athlete_id: 'ath_m_1', role: 'coach' }, { athlete_id: 'ath_m_1', role: 'coach' }],
    { athlete_id: 'ath_m_1', role: 'coach' },
  ])('trata una forma inesperada como unreadable', async (body) => {
    mockFetch(() => json(body))
    await expect(readVerifiedMembership('t', 'ath_m_1')).resolves.toEqual({ status: 'unreadable' })
  })
})
