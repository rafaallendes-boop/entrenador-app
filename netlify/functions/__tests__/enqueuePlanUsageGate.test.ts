import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  isKillSwitchActive: vi.fn(() => false),
  checkUsagePreflight: vi.fn(async () => undefined),
  createSupabaseWriter: vi.fn(),
  resolveAuthContext: vi.fn(async () => ({ userId: 'user-1', token: 'token-1' })),
  isEntitlementEnforcementEnabled: vi.fn(() => false),
  resolveEntitlementTier: vi.fn(async () => 'advanced'),
  assertPlanGenerationEntitlement: vi.fn(),
}))

vi.mock('../_shared/usageGate', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/usageGate')>()
  return {
    ...actual,
    isKillSwitchActive: handlerMocks.isKillSwitchActive,
    checkUsagePreflight: handlerMocks.checkUsagePreflight,
  }
})

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
    isEntitlementEnforcementEnabled: handlerMocks.isEntitlementEnforcementEnabled,
    resolveEntitlementTier: handlerMocks.resolveEntitlementTier,
    assertPlanGenerationEntitlement: handlerMocks.assertPlanGenerationEntitlement,
  }
})

import { handler } from '../enqueue-plan-generation'
import { buildEnqueueEvent } from './helpers/enqueuePlanTestHarness'

describe('enqueue-plan-generation — usage gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlerMocks.isKillSwitchActive.mockReturnValue(false)
    handlerMocks.checkUsagePreflight.mockResolvedValue(undefined)
    handlerMocks.resolveAuthContext.mockResolvedValue({ userId: 'user-1', token: 'token-1' })
    handlerMocks.isEntitlementEnforcementEnabled.mockReturnValue(false)
    handlerMocks.resolveEntitlementTier.mockResolvedValue('advanced')
  })
  afterEach(() => vi.restoreAllMocks())

  it('kill switch activo rechaza antes de actuar sobre entitlement o crear nada', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)

    const response = await handler(buildEnqueueEvent(), {} as never) as { statusCode: number; body: string }

    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).errorCode).toBe('kill_switch_active')
    // `resolveEntitlementTier` SÍ se invoca (corre en paralelo con auth vía
    // Promise.all, optimización ya existente) — lo que no debe pasar es que
    // se ACTÚE sobre esa resolución ni que se cree nada.
    expect(handlerMocks.assertPlanGenerationEntitlement).not.toHaveBeenCalled()
    expect(handlerMocks.checkUsagePreflight).not.toHaveBeenCalled()
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()
  })

  it('preflight de cuota rechazado no crea writer ni job', async () => {
    const gateError = Object.assign(new Error('cupo agotado'), {
      statusCode: 429,
      errorCode: 'quota_exceeded',
      detail: { bucketId: 'plan_builder_week', limit: 12, remaining: 0 },
    })
    handlerMocks.checkUsagePreflight.mockRejectedValue(gateError)

    const response = await handler(buildEnqueueEvent(), {} as never) as { statusCode: number; body: string }

    expect(response.statusCode).toBe(429)
    expect(JSON.parse(response.body).errorCode).toBe('quota_exceeded')
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()
  })

  it('preflight aceptado sigue el flujo normal', async () => {
    handlerMocks.createSupabaseWriter.mockReturnValue({
      getPlan: vi.fn(async () => null),
      putPlan: vi.fn(async () => undefined),
      putWeek: vi.fn(async () => undefined),
    })

    const response = await handler(buildEnqueueEvent(), {} as never) as { statusCode: number; body: string }

    expect(handlerMocks.checkUsagePreflight).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', requestClass: 'plan_builder_week' }),
    )
    expect(response.statusCode).not.toBe(429)
    expect(response.statusCode).not.toBe(503)
  })
})
