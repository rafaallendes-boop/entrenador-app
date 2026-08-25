import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerEvent } from '@netlify/functions'

const ADMIN_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const mocks = vi.hoisted(() => ({
  resolveAuthContext: vi.fn(),
  readOperationsMetrics: vi.fn(),
  corsPreflight: vi.fn(() => ({ statusCode: 204, body: '' })),
}))

vi.mock('../_shared/planGenerationShared', () => ({
  json: (statusCode: number, body: object) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  resolveAuthContext: mocks.resolveAuthContext,
}))
vi.mock('../_shared/operationsMetrics', () => ({ readOperationsMetrics: mocks.readOperationsMetrics }))
vi.mock('../_shared/cors', () => ({ corsPreflight: mocks.corsPreflight }))

const ORIGINAL_ENV = { ...process.env }

function event(method = 'GET'): HandlerEvent {
  return { httpMethod: method, headers: {} } as unknown as HandlerEvent
}

async function invoke(method = 'GET') {
  const { handler } = await import('../operations-dashboard')
  return handler(event(method), {} as never, () => undefined) as Promise<{
    statusCode: number
    body: string
  }>
}

describe('operations-dashboard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env['OPERATIONS_ADMIN_USER_IDS'] = ADMIN_ID
    mocks.resolveAuthContext.mockResolvedValue({ userId: ADMIN_ID, token: 'tok' })
    mocks.readOperationsMetrics.mockResolvedValue({
      last24h: { marker: '24h' }, last7d: { marker: '7d' }, generatedAt: 'now',
    })
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('sin sesión devuelve 401 y no consulta telemetría', async () => {
    mocks.resolveAuthContext.mockRejectedValue(Object.assign(new Error('no'), { statusCode: 401 }))

    const response = await invoke()

    expect(response.statusCode).toBe(401)
    expect(mocks.readOperationsMetrics).not.toHaveBeenCalled()
  })

  it('una cuenta autenticada no listada devuelve 403 y no consulta telemetría', async () => {
    mocks.resolveAuthContext.mockResolvedValue({ userId: OTHER_ID, token: 'tok' })

    const response = await invoke()

    expect(response.statusCode).toBe(403)
    expect(mocks.readOperationsMetrics).not.toHaveBeenCalled()
  })

  it('sin OPERATIONS_ADMIN_USER_IDS nadie pasa', async () => {
    delete process.env['OPERATIONS_ADMIN_USER_IDS']

    const response = await invoke()

    expect(response.statusCode).toBe(403)
    expect(mocks.readOperationsMetrics).not.toHaveBeenCalled()
  })

  it('la cuenta listada recibe las dos ventanas agregadas', async () => {
    const response = await invoke()

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      last24h: { marker: '24h' }, last7d: { marker: '7d' }, generatedAt: 'now',
    })
  })

  it('un método no permitido devuelve 405 sin autenticar', async () => {
    const response = await invoke('POST')

    expect(response.statusCode).toBe(405)
    expect(mocks.resolveAuthContext).not.toHaveBeenCalled()
  })

  it('preflight responde sin autenticar', async () => {
    const response = await invoke('OPTIONS')

    expect(response.statusCode).toBe(204)
    expect(mocks.resolveAuthContext).not.toHaveBeenCalled()
  })

  it('un fallo del RPC devuelve 500 sin filtrar la causa cruda', async () => {
    mocks.readOperationsMetrics.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:5432'))

    const response = await invoke()

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('ECONNREFUSED')
  })

  it('respeta un 5xx clasificado sin exponer su causa', async () => {
    mocks.readOperationsMetrics.mockRejectedValue(
      Object.assign(new Error('upstream unavailable'), { statusCode: 502 }),
    )

    const response = await invoke()

    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain('upstream unavailable')
  })
})
