import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

const getSession = vi.hoisted(() => vi.fn())
vi.mock('../../auth', () => ({ supabase: { auth: { getSession } } }))

import {
  PlanEnqueueRejectedError,
  triggerBackgroundGeneration,
  type TriggerBackgroundGenerationInput,
} from '../triggerBackgroundGeneration'

function makeInput(): TriggerBackgroundGenerationInput {
  return {
    plan: { id: 'plan-1' } as TrainingPlan,
    weeks: [{ id: 'week-1', planId: 'plan-1', weekIndex: 0 } as TrainingPlanWeek],
    profile: { id: 'athlete-1', updatedAt: 0 } as AthleteProfile,
    wizardConfig: {} as PlanWizardConfig,
    targetWeekIndexes: [0],
  }
}

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

async function captureRejection(): Promise<PlanEnqueueRejectedError> {
  try {
    await triggerBackgroundGeneration(makeInput())
    throw new Error('La llamada debio ser rechazada')
  } catch (error) {
    expect(error).toBeInstanceOf(PlanEnqueueRejectedError)
    return error as PlanEnqueueRejectedError
  }
}

beforeEach(() => {
  getSession.mockReset()
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('el 403 de entitlement conserva su metadata', () => {
  it('expone un detail valido para que la UI arme la oferta', async () => {
    const detail = {
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    } as const
    mockResponse(403, {
      error: 'Requiere advanced.',
      errorCode: 'entitlement_required',
      detail,
    })

    const error = await captureRejection()

    expect(error.statusCode).toBe(403)
    expect(error.entitlement).toEqual(detail)
  })

  it('un 403 ordinario deja entitlement en null', async () => {
    mockResponse(403, { error: 'Sesion invalida.' })

    const error = await captureRejection()

    expect(error.statusCode).toBe(403)
    expect(error.entitlement).toBeNull()
  })

  it('un detail malformado no se propaga como oferta', async () => {
    mockResponse(403, {
      error: 'Requiere advanced.',
      errorCode: 'entitlement_required',
      detail: { requestClass: 'plan_builder_week', requiredTier: 'pro', currentTier: 'free' },
    })

    expect((await captureRejection()).entitlement).toBeNull()
  })

  it('un codigo distinto no convierte un detail valido en oferta', async () => {
    mockResponse(403, {
      error: 'Sesion invalida.',
      errorCode: 'unauthorized',
      detail: { requestClass: 'plan_builder_week', requiredTier: 'advanced', currentTier: 'free' },
    })

    expect((await captureRejection()).entitlement).toBeNull()
  })

  it('un 500 sigue siendo un rechazo tecnico aunque copie metadata de entitlement', async () => {
    mockResponse(500, {
      error: 'boom',
      errorCode: 'entitlement_required',
      detail: { requestClass: 'plan_builder_week', requiredTier: 'advanced', currentTier: 'free' },
    })

    const error = await captureRejection()

    expect(error.statusCode).toBe(500)
    expect(error.entitlement).toBeNull()
  })
})
