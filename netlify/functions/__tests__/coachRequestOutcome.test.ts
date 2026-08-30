import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerEvent } from '@netlify/functions'

const mocks = vi.hoisted(() => ({
  resolveAuthContext: vi.fn(),
  corsPreflight: vi.fn(() => ({ statusCode: 204, body: '' })),
}))

vi.mock('../_shared/planGenerationShared', () => ({
  JSON_HEADERS: {},
  json: (statusCode: number, body: object) => ({ statusCode, headers: {}, body: JSON.stringify(body) }),
  resolveAuthContext: mocks.resolveAuthContext,
}))
vi.mock('../_shared/cors', () => ({ corsPreflight: mocks.corsPreflight }))

const ORIGINAL_ENV = { ...process.env }

function event(body: unknown): HandlerEvent {
  return {
    httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify(body),
  } as unknown as HandlerEvent
}

describe('coach-request-outcome', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env['SUPABASE_URL'] = 'https://project.supabase.co'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-key'
    mocks.resolveAuthContext.mockResolvedValue({ userId: 'user-1', token: 'token' })
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('updates only the authenticated successful request to safety_blocked', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify([{ trace_id: 'trace-1' }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const { handler } = await import('../coach-request-outcome')

    const response = await handler(event({ traceId: 'trace-1', outcome: 'safety_blocked' }), {} as never, () => undefined) as { statusCode: number }

    expect(response.statusCode).toBe(204)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('trace_id=eq.trace-1')
    expect(url).toContain('user_id=eq.user-1')
    expect(url).toContain('outcome=in.%28ok%2Csafety_blocked%29')
    expect(init.body).toBe(JSON.stringify({ outcome: 'safety_blocked' }))
    expect(init.headers).toMatchObject({ Authorization: 'Bearer service-key' })
  })

  it('rejects another outcome before it authenticates or writes', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { handler } = await import('../coach-request-outcome')

    const response = await handler(event({ traceId: 'trace-1', outcome: 'error' }), {} as never, () => undefined) as { statusCode: number }

    expect(response.statusCode).toBe(400)
    expect(mocks.resolveAuthContext).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
