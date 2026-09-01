import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EntitlementRequiredError } from '../../../entitlements/entitlementError'
import type { AIErrorCode, AIRequest } from '../../types'
import { AIProviderError } from '../../types'
import { ProxyProvider } from '../ProxyProvider'
import { classifyProxyHttpError } from '../proxyHttpError'

function res(status: number): Response {
  return new Response(null, { status })
}

function captureError(status: number, payload: {
  error?: string
  errorCode?: AIErrorCode
  detail?: unknown
}): AIProviderError {
  try {
    classifyProxyHttpError(res(status), payload)
  } catch (error) {
    expect(error).toBeInstanceOf(AIProviderError)
    return error as AIProviderError
  }
}

describe('classifyProxyHttpError preserva entitlement_required', () => {
  it('403 con detail produce EntitlementRequiredError con metadata intacta', () => {
    const detail = {
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    } as const

    const error = captureError(403, {
      error: 'Requiere advanced.',
      errorCode: 'entitlement_required',
      detail,
    })

    expect(error).toBeInstanceOf(EntitlementRequiredError)
    expect((error as EntitlementRequiredError).detail).toEqual(detail)
    expect(error).toMatchObject({
      provider: 'gemini',
      code: 'entitlement_required',
      retryable: false,
    })
  })

  it('403 con codigo pero detail malformado NO se convierte en entitlement', () => {
    const error = captureError(403, {
      error: 'Requiere advanced.',
      errorCode: 'entitlement_required',
      detail: { requiredTier: 'pro' },
    })

    expect(error).not.toBeInstanceOf(EntitlementRequiredError)
    expect(error.code).toBe('unauthorized')
  })

  it('403 sin codigo propio sigue siendo unauthorized', () => {
    expect(captureError(403, { error: 'Sesion invalida.' }).code).toBe('unauthorized')
  })
})

describe('classifyProxyHttpError conserva las ramas y precedencias historicas', () => {
  const cases: Array<{
    name: string
    status: number
    errorCode?: AIErrorCode
    expectedCode: AIErrorCode
    retryable?: boolean
  }> = [
    {
      name: '401 aplana cualquier codigo salvo misconfigured a unauthorized',
      status: 401,
      errorCode: 'rate_limit',
      expectedCode: 'unauthorized',
    },
    {
      name: '403 conserva misconfigured por encima del aplanado',
      status: 403,
      errorCode: 'misconfigured',
      expectedCode: 'misconfigured',
    },
    {
      name: '429 gana sobre un codigo timeout',
      status: 429,
      errorCode: 'timeout',
      expectedCode: 'rate_limit',
      retryable: true,
    },
    {
      name: 'rate_limit por codigo es reintentable',
      status: 400,
      errorCode: 'rate_limit',
      expectedCode: 'rate_limit',
      retryable: true,
    },
    {
      name: '502 gana sobre un codigo misconfigured',
      status: 502,
      errorCode: 'misconfigured',
      expectedCode: 'timeout',
      retryable: true,
    },
    {
      name: '503 es timeout reintentable',
      status: 503,
      expectedCode: 'timeout',
      retryable: true,
    },
    {
      name: '504 es timeout reintentable',
      status: 504,
      expectedCode: 'timeout',
      retryable: true,
    },
    {
      name: 'timeout por codigo es reintentable',
      status: 400,
      errorCode: 'timeout',
      expectedCode: 'timeout',
      retryable: true,
    },
    {
      name: 'misconfigured por codigo conserva su clasificacion',
      status: 400,
      errorCode: 'misconfigured',
      expectedCode: 'misconfigured',
    },
    {
      name: 'unauthorized por codigo conserva su clasificacion',
      status: 400,
      errorCode: 'unauthorized',
      expectedCode: 'unauthorized',
    },
    {
      name: 'status 500 se normaliza a server_error',
      status: 500,
      errorCode: 'parse_error',
      expectedCode: 'server_error',
    },
    {
      name: 'server_error por codigo conserva su clasificacion',
      status: 400,
      errorCode: 'server_error',
      expectedCode: 'server_error',
    },
    {
      name: 'otros codigos pasan intactos por la rama final',
      status: 400,
      errorCode: 'parse_error',
      expectedCode: 'parse_error',
    },
    {
      name: 'sin codigo ni rama conocida cae en unknown',
      status: 400,
      expectedCode: 'unknown',
    },
  ]

  for (const testCase of cases) {
    it(testCase.name, () => {
      const error = captureError(testCase.status, {
        error: 'Mensaje controlado.',
        errorCode: testCase.errorCode,
      })

      expect(error).toMatchObject({
        provider: 'gemini',
        code: testCase.expectedCode,
        retryable: testCase.retryable ?? false,
        message: 'Mensaje controlado.',
      })
    })
  }

  it('usa el mensaje de respaldo con el status cuando falta error', () => {
    expect(captureError(418, {})).toMatchObject({
      provider: 'gemini',
      code: 'unknown',
      retryable: false,
      message: 'Error del servidor (418).',
    })
  })
})

describe('ProxyProvider delega ambos transportes al clasificador', () => {
  const detail = {
    requestClass: 'week_creator',
    requiredTier: 'advanced',
    currentTier: 'free',
  } as const

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function request(onChunk?: (chunk: string) => void): AIRequest {
    return {
      systemPrompt: 'Sistema',
      userMessage: 'Crea la semana',
      requestClass: 'week_creator',
      traceId: 'trace-entitlement',
      onChunk,
    }
  }

  it('preserva detail en la respuesta JSON no streaming', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Requiere weekly.',
      errorCode: 'entitlement_required',
      detail,
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(new ProxyProvider().call(request())).rejects.toMatchObject({
      name: 'EntitlementRequiredError',
      code: 'entitlement_required',
      detail,
    })
  })

  it('preserva detail en la respuesta HTTP del intento streaming', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Requiere weekly.',
      errorCode: 'entitlement_required',
      detail,
    }), {
      status: 403,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ProxyProvider().call(request(vi.fn()))).rejects.toMatchObject({
      name: 'EntitlementRequiredError',
      code: 'entitlement_required',
      detail,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
