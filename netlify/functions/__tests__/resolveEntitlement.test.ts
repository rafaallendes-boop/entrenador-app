import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isEntitlementEnforcementEnabled,
  resolveEntitlementTier,
} from '../_shared/resolveEntitlement'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_ANON_KEY'] = 'anon-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mockFetchJson(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

describe('isEntitlementEnforcementEnabled', () => {
  it('apagado por defecto', () => {
    expect(isEntitlementEnforcementEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('solo la cadena exacta "true" lo enciende', () => {
    expect(isEntitlementEnforcementEnabled({ ENTITLEMENTS_ENABLED: 'true' } as never)).toBe(true)
    expect(isEntitlementEnforcementEnabled({ ENTITLEMENTS_ENABLED: '1' } as never)).toBe(false)
    expect(isEntitlementEnforcementEnabled({ ENTITLEMENTS_ENABLED: 'TRUE' } as never)).toBe(false)
  })
})

describe('resolveEntitlementTier', () => {
  it('fila presente y vigente devuelve su tier', async () => {
    mockFetchJson(200, [{ tier: 'advanced', expires_at: null }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('advanced')
  })

  it('respuesta vacia (sin fila) devuelve free', async () => {
    mockFetchJson(200, [])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('fila vencida devuelve free', async () => {
    mockFetchJson(200, [{ tier: 'advanced', expires_at: '2020-01-01T00:00:00Z' }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('tier invalido en la fila devuelve free', async () => {
    mockFetchJson(200, [{ tier: 'pro', expires_at: null }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('expires_at ILEGIBLE devuelve free, no "sin vencimiento"', async () => {
    for (const bad of ['no-es-fecha', '', 42, {}]) {
      mockFetchJson(200, [{ tier: 'advanced', expires_at: bad }])
      await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
    }
  })

  it('expires_at ausente sigue siendo sin vencimiento', async () => {
    mockFetchJson(200, [{ tier: 'advanced' }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('advanced')
  })

  it('error HTTP devuelve free (fail-closed)', async () => {
    mockFetchJson(500, { message: 'boom' })
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('fallo de red devuelve free (fail-closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('config ausente devuelve free', async () => {
    delete process.env['SUPABASE_URL']
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('nunca pide select=*, y pide las columnas del contrato', async () => {
    const spy = vi.fn<typeof fetch>(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await resolveEntitlementTier('tok')
    const url = String(spy.mock.calls[0][0])
    expect(url).not.toContain('select=*')
    expect(url).toContain('select=tier%2Cexpires_at')
  })

  it('manda el token del usuario para que RLS filtre', async () => {
    const spy = vi.fn<typeof fetch>(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await resolveEntitlementTier('tok-123')
    const init = spy.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tok-123')
  })

  it('aborta la lectura a los 3 segundos y devuelve free', async () => {
    const timeoutSignal = AbortSignal.abort(new DOMException('timed out', 'TimeoutError'))
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    const fetchSpy = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason
      return new Response('[]', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
    expect(timeoutSpy).toHaveBeenCalledWith(3_000)
    expect(fetchSpy.mock.calls[0][1]?.signal).toBe(timeoutSignal)
  })
})
