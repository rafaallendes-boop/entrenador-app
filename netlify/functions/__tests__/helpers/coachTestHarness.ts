import { vi } from 'vitest'

// Sin este mock se ejerce el wrapper de AWS (`awslambda`) en vez del handler.
// Vive acá (no en cada test file) porque este módulo importa `../../coach`
// más abajo: el mock tiene que registrarse antes de esa importación, y
// Vitest hoistea `vi.mock` al tope de ESTE archivo — no del archivo que lo
// importa. Cualquier test file que use este harness debe importarlo ANTES
// de importar `../coach` directamente (p. ej. para `normalizeErrorForTest`),
// o el mock de `@netlify/functions` puede llegar tarde.
vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

import { handler } from '../../coach'

export interface HandlerResult {
  statusCode: number
  body: string
}

interface RawHandlerResponse {
  statusCode: number
  headers?: Record<string, string>
  body?: string | ReadableStream<Uint8Array>
}

type RawCoachHandler = (
  event: unknown,
  context: unknown,
  callback: () => void,
) => Promise<RawHandlerResponse>

async function invokeHandler(
  body: Record<string, unknown>,
  token: string | undefined,
): Promise<RawHandlerResponse> {
  return (handler as unknown as RawCoachHandler)(
    {
      httpMethod: 'POST',
      body: JSON.stringify(body),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
    {},
    () => undefined,
  )
}

/** Invoca el handler y devuelve la respuesta JSON no-streaming (`body` como string). */
export async function callHandler(
  body: Record<string, unknown>,
  token = 'tok',
): Promise<HandlerResult> {
  const response = await invokeHandler(body, token)
  return { statusCode: response.statusCode, body: String(response.body ?? '') }
}

/**
 * Invoca el handler forzando `stream: true` en el body y devuelve las
 * líneas NDJSON crudas ya decodificadas (una por chunk `{type: ...}`
 * emitido), en el orden en que se emitieron.
 */
export async function callStreamingHandler(
  body: Record<string, unknown>,
  token = 'tok',
): Promise<string[]> {
  const response = await invokeHandler({ ...body, stream: true }, token)
  const streamBody = response.body
  if (!streamBody || typeof streamBody === 'string') {
    throw new Error('callStreamingHandler: la respuesta no trajo un ReadableStream body.')
  }
  const reader = streamBody.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
  }
  buffer += decoder.decode()
  return buffer.split('\n').filter((line) => line.trim().length > 0)
}

const DEFAULT_USER_ID = 'user-1'

interface FetchStubResponse {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}

function authResponse(userId: string, ok: boolean): FetchStubResponse {
  return ok
    ? { ok: true, status: 200, json: async () => ({ id: userId }) }
    : { ok: false, status: 401, json: async () => ({}) }
}

/**
 * Stub de `fetch` que sólo sabe responder al endpoint de auth de Supabase
 * (`/auth/v1/user`); cualquier otra URL devuelve un 200 vacío para no
 * romper escrituras best-effort (telemetría) que no son el objeto bajo
 * prueba. También fija las env vars de Supabase y `GEMINI_API_KEY` (el
 * proveedor primario por default de todas las clases sin override — ver
 * OPTIMIZATION_AND_COSTS.md §8), para que un test que necesite borrar esa
 * key para simular "provider mal configurado" tenga algo que borrar.
 *
 * Para tests que también invocan al proveedor, usar `stubProviderFetch` en
 * su lugar — reemplaza este stub por uno que también sabe rutear al
 * proveedor, sin perder el ruteo de auth.
 */
export function stubAuthFetch(
  opts: { userId?: string; ok?: boolean } = {},
): ReturnType<typeof vi.fn> {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
  const userId = opts.userId ?? DEFAULT_USER_ID
  const ok = opts.ok ?? true
  const fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).includes('/auth/v1/user')) return authResponse(userId, ok)
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export interface StubProviderFetchOptions {
  /** userId que debe devolver el endpoint de auth simulado. */
  userId?: string
  /** El primer intento al proveedor falla con un 503 retryable; el resto responde OK. */
  failFirstAttempt?: boolean
  /** La respuesta del proveedor omite `usageMetadata` por completo — no "cero tokens", ausencia real. */
  omitUsage?: boolean
  responseText?: string
}

/**
 * Stub de `fetch` que rutea entre el endpoint de auth de Supabase y el
 * endpoint de Gemini (`generateContent`), el proveedor primario por default
 * para `chat_general` sin overrides de env var. Devuelve el mock
 * ESPECÍFICO del proveedor (no el router completo), para que
 * `expect(providerFetch).not.toHaveBeenCalled()` en los tests de rechazo
 * temprano (kill switch, cuota agotada) no se confunda con las llamadas de
 * auth, que sí deben seguir ocurriendo.
 *
 * No vuelve a fijar `GEMINI_API_KEY`/las env vars de Supabase — se asume
 * que `stubAuthFetch` ya corrió (p. ej. en un `beforeEach`), para que un
 * test pueda borrar `GEMINI_API_KEY` después de ese `beforeEach` y antes de
 * llamar a este helper sin que se la pisen.
 */
export function stubProviderFetch(
  opts: StubProviderFetchOptions = {},
): ReturnType<typeof vi.fn> {
  const authUserId = opts.userId ?? DEFAULT_USER_ID
  const responseText = opts.responseText ?? 'respuesta del coach'
  let providerCallCount = 0

  const providerFetchMock = vi.fn(async (): Promise<FetchStubResponse> => {
    providerCallCount += 1
    if (opts.failFirstAttempt && providerCallCount === 1) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'Modelo temporalmente no disponible.' } }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: responseText }] },
          finishReason: 'STOP',
        }],
        ...(opts.omitUsage
          ? {}
          : { usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } }),
      }),
    }
  })

  const router = vi.fn(async (url: unknown): Promise<FetchStubResponse> => {
    const href = String(url)
    if (href.includes('/auth/v1/user')) return authResponse(authUserId, true)
    if (href.includes('generativelanguage.googleapis.com')) return providerFetchMock()
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', router)
  return providerFetchMock
}
