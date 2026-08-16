import { afterEach, describe, expect, it, vi } from 'vitest'

// Sin este mock se ejerce el wrapper de AWS (`awslambda`) en vez del handler.
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

interface HandlerResult {
  statusCode: number
  body?: unknown
}

type CoachHandler = (
  event: unknown,
  context: unknown,
  callback: () => void,
) => Promise<HandlerResult>

async function loadAnonymousHandler(gateEnabled: boolean): Promise<CoachHandler> {
  // `AUTH_REQUIRED` se captura al evaluar el módulo: cada caso necesita una
  // instancia nueva, cargada después de fijar el entorno anónimo.
  vi.resetModules()
  vi.stubEnv('COACH_PROXY_REQUIRE_AUTH', 'false')
  vi.stubEnv('ENTITLEMENTS_ENABLED', gateEnabled ? 'true' : 'false')
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { handler } = await import('../coach')
  return handler as unknown as CoachHandler
}

async function callHandler(
  handler: CoachHandler,
  requestClass: string,
): Promise<HandlerResult> {
  return handler(
    {
      httpMethod: 'POST',
      body: JSON.stringify({
        systemPrompt: 's',
        userMessage: `request ${requestClass}`,
        requestClass,
        stream: false,
      }),
      headers: {},
    },
    {},
    () => undefined,
  )
}

function stubSuccessfulProvider(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: 'respuesta permitida' }] },
        finishReason: 'STOP',
      }],
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('gate anónimo de entitlement en coach', () => {
  it('con la flag apagada conserva week_creator permitido', async () => {
    const fetchMock = stubSuccessfulProvider()
    const handler = await loadAnonymousHandler(false)

    const response = await callHandler(handler, 'week_creator')

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['chat_general', 'chat_action'])('permite %s como Free anónimo', async (requestClass) => {
    stubSuccessfulProvider()
    const handler = await loadAnonymousHandler(true)

    const response = await callHandler(handler, requestClass)

    expect(response.statusCode).toBe(200)
  })

  it.each([
    ['week_creator', 'weekly'],
    ['weekly_summary', 'weekly'],
  ])('deniega %s como Free anónimo sin tocar proveedor', async (requestClass, requiredTier) => {
    const fetchMock = stubSuccessfulProvider()
    const handler = await loadAnonymousHandler(true)

    const response = await callHandler(handler, requestClass)

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(String(response.body))).toMatchObject({
      errorCode: 'entitlement_required',
      detail: {
        requestClass,
        requiredTier,
        currentTier: 'free',
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
