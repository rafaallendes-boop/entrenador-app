import { afterEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  createSupabaseWriter: vi.fn(),
  resolveAuthContext: vi.fn(),
  resolveEntitlementTier: vi.fn(),
}))

vi.mock('../_shared/planGenerationShared', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/planGenerationShared')>()
  return {
    ...actual,
    createSupabaseWriter: handlerMocks.createSupabaseWriter,
    resolveAuthContext: handlerMocks.resolveAuthContext,
  }
})

vi.mock('../_shared/resolveEntitlement', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    resolveEntitlementTier: handlerMocks.resolveEntitlementTier,
  }
})

import { assertPlanGenerationEntitlement } from '../_shared/resolveEntitlement'
import { handler } from '../enqueue-plan-generation'
import { buildEnqueueEvent } from './helpers/enqueuePlanTestHarness'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  handlerMocks.createSupabaseWriter.mockReset()
  handlerMocks.resolveAuthContext.mockReset()
  handlerMocks.resolveEntitlementTier.mockReset()
  vi.restoreAllMocks()
})

describe('assertPlanGenerationEntitlement', () => {
  it('advanced pasa y devuelve la decisión que el gate debe propagar', () => {
    expect(assertPlanGenerationEntitlement('advanced', 'user-1')).toMatchObject({
      allowed: true,
      tier: 'advanced',
      quotaOwnerUserId: 'user-1',
      quotaBucketId: 'plan_builder_week',
      limit: 16,
    })
  })

  it('free es rechazado con 403 y detail', () => {
    try {
      assertPlanGenerationEntitlement('free', 'user-1')
      throw new Error('debio lanzar')
    } catch (error) {
      const err = error as { statusCode?: number; errorCode?: string; detail?: unknown }
      expect(err.statusCode).toBe(403)
      expect(err.errorCode).toBe('entitlement_required')
      expect(err.detail).toEqual({
        requestClass: 'plan_builder_week',
        requiredTier: 'advanced',
        currentTier: 'free',
      })
    }
  })

  it('weekly tambien es rechazado: Plan Builder es advanced', () => {
    expect(() => assertPlanGenerationEntitlement('weekly', 'user-1')).toThrow()
  })
})

describe('enqueue-plan-generation entitlement wiring', () => {
  it('consulta auth y entitlement en paralelo y rechaza antes de crear el writer', async () => {
    process.env['ENTITLEMENTS_ENABLED'] = 'true'
    let resolveAuth!: (value: { userId: string; token: string }) => void
    const authPending = new Promise<{ userId: string; token: string }>((resolve) => {
      resolveAuth = resolve
    })
    handlerMocks.resolveAuthContext.mockReturnValue(authPending)
    handlerMocks.resolveEntitlementTier.mockResolvedValue('free')
    const event = buildEnqueueEvent()

    const responsePending = handler(event, {} as never, () => undefined)

    // La lectura RLS empieza mientras auth sigue pendiente; no es una segunda
    // ida y vuelta secuencial.
    expect(handlerMocks.resolveAuthContext).toHaveBeenCalledTimes(1)
    expect(handlerMocks.resolveEntitlementTier).toHaveBeenCalledWith('token-1')
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()

    resolveAuth({ userId: 'user-1', token: 'token-1' })
    const response = await responsePending as { statusCode: number; body: string }

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      error: 'Esta función requiere el plan advanced.',
      errorCode: 'entitlement_required',
      detail: {
        requestClass: 'plan_builder_week',
        requiredTier: 'advanced',
        currentTier: 'free',
      },
    })
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()
  })
})
