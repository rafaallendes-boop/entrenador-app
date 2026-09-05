import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  entitlementEnabled: vi.fn(() => false),
  readEntitlementRecord: vi.fn(async () => ({
    status: 'present' as const,
    row: { tier: 'free' as const, expiresAt: null },
    accountRole: 'athlete' as const,
  })),
  insertCoachRequestRow: vi.fn(async () => 'ok' as const),
}))

vi.mock('../_shared/resolveEntitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    isEntitlementEnforcementEnabled: mocks.entitlementEnabled,
    readEntitlementRecord: mocks.readEntitlementRecord,
  }
})

vi.mock('../_shared/coachRequestTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_shared/coachRequestTelemetry')>()
  return { ...actual, insertCoachRequestRow: mocks.insertCoachRequestRow }
})

// Importado ANTES que `../coach`: el harness registra el mock de
// `@netlify/functions` como efecto de su propia carga, y `coach.ts` debe
// verlo ya registrado cuando se evalúe (acá mismo, o transitivamente vía
// el harness) — ver el comentario en `helpers/coachTestHarness.ts`.
import { callHandler, stubAuthFetch } from './helpers/coachTestHarness'
import { normalizeErrorForTest } from '../coach'

const AUTHED_USER_ID = '55555555-5555-4555-8555-555555555555'

function makeDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.entitlementEnabled.mockReset()
  mocks.entitlementEnabled.mockReturnValue(false)
  mocks.readEntitlementRecord.mockReset()
  mocks.readEntitlementRecord.mockResolvedValue({
    status: 'present',
    row: { tier: 'free', expiresAt: null },
    accountRole: 'athlete',
  })
  mocks.insertCoachRequestRow.mockClear()
  stubAuthFetch({ userId: AUTHED_USER_ID })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normalizeError preserva el 403 de entitlement', () => {
  it('un 403 con entitlement_required conserva codigo y detail', () => {
    const detail = { requestClass: 'week_creator', requiredTier: 'weekly', currentTier: 'free' }
    const source = Object.assign(new Error('Requiere plan weekly.'), {
      statusCode: 403,
      errorCode: 'entitlement_required' as const,
      detail,
    })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.statusCode).toBe(403)
    expect(normalized.errorCode).toBe('entitlement_required')
    expect(normalized.detail).toEqual(detail)
  })

  it('un 403 SIN codigo propio sigue cayendo a unauthorized', () => {
    const source = Object.assign(new Error('Sesión inválida.'), { statusCode: 403 })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.errorCode).toBe('unauthorized')
    expect(normalized.detail).toBeUndefined()
  })

  it('un 401 sigue cayendo a unauthorized', () => {
    const source = Object.assign(new Error('Sesión requerida.'), { statusCode: 401 })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.errorCode).toBe('unauthorized')
  })

  it('un 429 sigue siendo rate_limit reintentable', () => {
    const source = Object.assign(new Error('Muchas solicitudes.'), { statusCode: 429 })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.errorCode).toBe('rate_limit')
    expect(normalized.retryable).toBe(true)
  })
})

describe('gate real de entitlement en coach', () => {
  it('con la flag apagada preserva el comportamiento previo', async () => {
    const response = await callHandler({
      systemPrompt: 's',
      userMessage: 'pon descanso el lunes',
      requestClass: 'chat_action',
      stream: false,
    })

    expect(response.statusCode).toBe(200)
    expect(mocks.readEntitlementRecord).toHaveBeenCalledWith('tok')
  })

  it('rechaza a Free con detail antes de tocar al proveedor', async () => {
    mocks.entitlementEnabled.mockReturnValue(true)
    const fetchMock = vi.mocked(fetch)

    const response = await callHandler({
      systemPrompt: 's',
      userMessage: 'crea la próxima semana',
      requestClass: 'week_creator',
      stream: false,
    })

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(String(response.body))).toMatchObject({
      errorCode: 'entitlement_required',
      detail: {
        requestClass: 'week_creator',
        requiredTier: 'weekly',
        currentTier: 'free',
      },
    })
    expect(mocks.readEntitlementRecord).toHaveBeenCalledWith('tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/auth/v1/user')
  })

  it('inicia la lectura de entitlement sin esperar a que termine auth', async () => {
    mocks.entitlementEnabled.mockReturnValue(true)
    const auth = makeDeferred<{ ok: boolean; json: () => Promise<{ id: string }> }>()
    const entitlement = makeDeferred<{
      status: 'present'
      row: { tier: 'free'; expiresAt: null }
      accountRole: 'athlete'
    }>()
    let authStarted = false
    let entitlementStarted = false
    vi.stubGlobal('fetch', vi.fn(() => {
      authStarted = true
      return auth.promise
    }))
    mocks.readEntitlementRecord.mockImplementation(() => {
      entitlementStarted = true
      return entitlement.promise
    })

    const responsePromise = callHandler({
      systemPrompt: 's',
      userMessage: 'pon descanso el lunes',
      requestClass: 'chat_action',
      stream: false,
    }, 'parallel-token')
    await Promise.resolve()
    const observedBeforeSettling = { authStarted, entitlementStarted }

    auth.resolve({
      ok: true,
      json: async () => ({ id: '66666666-6666-4666-8666-666666666666' }),
    })
    entitlement.resolve({
      status: 'present',
      row: { tier: 'free', expiresAt: null },
      accountRole: 'athlete',
    })

    expect((await responsePromise).statusCode).toBe(403)
    expect(observedBeforeSettling).toEqual({ authStarted: true, entitlementStarted: true })
  })
})
