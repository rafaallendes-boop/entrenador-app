import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoachRequestTelemetry } from '../_shared/coachRequestTelemetry'

// Sin este mock se ejerce el wrapper de AWS (`awslambda`) en vez del handler.
vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

const mocks = vi.hoisted(() => ({
  insertRow: vi.fn<
    (client: unknown, telemetry: CoachRequestTelemetry) => Promise<'ok' | 'failed'>
  >(async () => 'ok'),
  createClient: vi.fn((...args: unknown[]) => {
    void args
    return { __client: true }
  }),
}))

vi.mock('../_shared/coachRequestTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_shared/coachRequestTelemetry')>()
  return { ...actual, insertCoachRequestRow: mocks.insertRow }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

const AUTHED_USER_ID = '11111111-1111-4111-8111-111111111111'
const BYPASS_MESSAGE = 'pon descanso el lunes'

interface HandlerResult {
  statusCode: number
  body?: unknown
  headers?: Record<string, string>
}

async function callHandler(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<HandlerResult> {
  const { handler } = await import('../coach')
  return (handler as unknown as (
    event: unknown,
    context: unknown,
    callback: () => void,
  ) => Promise<HandlerResult>)(
    { httpMethod: 'POST', body: JSON.stringify(body), headers },
    {},
    () => undefined,
  )
}

function stubAuthFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: AUTHED_USER_ID }),
  })))
}

/** Deja correr efectos best-effort posteriores del test. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('persistencia de telemetría del coach', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.insertRow.mockClear()
    mocks.insertRow.mockResolvedValue('ok')
    mocks.createClient.mockClear()
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('COACH_PROXY_REQUIRE_AUTH', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('persiste una fila para una request autenticada', async () => {
    stubAuthFetch()

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).toHaveBeenCalledTimes(1)
    const telemetry = mocks.insertRow.mock.calls[0]![1]
    expect(telemetry.userId).toBe(AUTHED_USER_ID)
    expect(telemetry.requestClass).toBe('chat_action')
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon',
      expect.objectContaining({
        global: { headers: { Authorization: 'Bearer tok' } },
      }),
    )
  })

  it('espera la persistencia acotada antes de cerrar la respuesta', async () => {
    stubAuthFetch()
    let releaseInsert: ((status: 'ok') => void) | undefined
    mocks.insertRow.mockImplementationOnce(() => new Promise((resolve) => {
      releaseInsert = resolve
    }))

    let handlerSettled = false
    const responsePromise = callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer tok' },
    ).then((response) => {
      handlerSettled = true
      return response
    })

    await vi.waitFor(() => expect(mocks.insertRow).toHaveBeenCalledOnce())
    expect(handlerSettled).toBe(false)

    releaseInsert?.('ok')
    await expect(responsePromise).resolves.toMatchObject({ statusCode: 200 })
  })

  it('el bypass con stream:true persiste streamed=true', async () => {
    stubAuthFetch()

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: true },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).toHaveBeenCalledTimes(1)
    expect(mocks.insertRow.mock.calls[0]![1].streamed).toBe(true)
  })

  it('el bypass con stream:false persiste streamed=false', async () => {
    stubAuthFetch()

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).toHaveBeenCalledTimes(1)
    expect(mocks.insertRow.mock.calls[0]![1].streamed).toBe(false)
  })

  it('no persiste en modo dev sin auth', async () => {
    vi.stubEnv('COACH_PROXY_REQUIRE_AUTH', 'false')

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).not.toHaveBeenCalled()
  })

  it('no persiste cuando la autenticación falla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer malo' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).not.toHaveBeenCalled()
  })

  it('persiste un rechazo por rate limit después de autenticar al usuario', async () => {
    vi.stubEnv('COACH_RATE_LIMIT_MAX', '1')
    stubAuthFetch()
    const request = {
      systemPrompt: 's',
      userMessage: BYPASS_MESSAGE,
      requestClass: 'chat_action',
      stream: true,
    }
    const headers = { authorization: 'Bearer tok' }

    expect((await callHandler(request, headers)).statusCode).toBe(200)
    const limited = await callHandler(request, headers)
    await flushMicrotasks()

    expect(limited.statusCode).toBe(429)
    expect(mocks.insertRow).toHaveBeenCalledTimes(2)
    expect(mocks.insertRow.mock.calls[1]![1]).toMatchObject({
      userId: AUTHED_USER_ID,
      outcome: 'error',
      errorCode: 'rate_limit',
      streamed: false,
    })
  })

  it('un fallo de Supabase no altera la respuesta del coach ni lanza', async () => {
    stubAuthFetch()
    mocks.insertRow.mockResolvedValue('failed')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = await callHandler(
      {
        systemPrompt: 's',
        userMessage: BYPASS_MESSAGE,
        requestClass: 'chat_action',
        traceId: 'telemetry-failure-stable-trace',
        stream: false,
      },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(String(response.body))).toMatchObject({
      traceId: 'telemetry-failure-stable-trace',
      requestClass: 'chat_action',
      model: 'local_regex (deterministic_bypass)',
    })
    expect(warn).toHaveBeenCalledWith('[coach] telemetry insert failed', {
      traceId: 'telemetry-failure-stable-trace',
    })
  })

  it('traga y registra una promesa rechazada por una implementación defensiva', async () => {
    stubAuthFetch()
    mocks.insertRow.mockRejectedValueOnce(new Error('unexpected rejection'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = await callHandler(
      {
        systemPrompt: 's',
        userMessage: BYPASS_MESSAGE,
        requestClass: 'chat_action',
        traceId: 'telemetry-rejection-stable-trace',
        stream: false,
      },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(response.statusCode).toBe(200)
    expect(warn).toHaveBeenCalledWith('[coach] telemetry insert failed', {
      traceId: 'telemetry-rejection-stable-trace',
    })
  })
})
