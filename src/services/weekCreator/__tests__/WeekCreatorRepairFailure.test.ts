import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext, CoachAction, PlanWizardConfig } from '../../../types'
import type { CoachNormalizedResponse } from '../../ai/types'
import type { RepairFailure } from '../../planBuilder/repairWeek'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'

const repairGeneratedWeekMock = vi.hoisted(() => vi.fn())
const providerCallMock = vi.hoisted(() => vi.fn())

vi.mock('../../planBuilder/repairWeek', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../planBuilder/repairWeek')>()),
  repairGeneratedWeek: repairGeneratedWeekMock,
}))

import { createRepairMeta } from '../../planBuilder/repairWeek'
import { classifyWeekCreatorRepairFailure } from '../WeekCreatorFailurePolicy'
import { WeekCreatorEngine, repairWeekCreatorResponse } from '../WeekCreatorEngine'
import { hydrateWeekCreatorResponse } from '../WeekCreatorLocalHydrator'

const TARGET_WEEK = '2026-08-03'
const REPAIR_FAILURE: RepairFailure = {
  errorClass: 'quality.squash.signature_uniqueness_unresolved',
  message: 'No se pudo diferenciar la firma de la sesión de squash.',
}

function action(): CoachAction {
  return {
    type: 'create_week',
    reason: 'Semana de squash',
    targetDate: TARGET_WEEK,
    sessions: [{
      date: TARGET_WEEK,
      timeBlock: 'AM',
      sessionType: 'squash',
      title: 'Squash técnico',
      durationMin: 60,
      rpe: 6,
      objective: 'Controlar la profundidad.',
    }],
  }
}

function response(): CoachNormalizedResponse {
  return {
    message: 'Semana propuesta',
    actions: [action()],
    provider: 'mock',
    model: 'mock-model',
    timestamp: 0,
    traceId: 'repair-failure-trace',
    requestClass: 'week_creator',
  }
}

function context(): ChatContext {
  return {
    recentSessions: [],
    athleteProfile: profile(),
  }
}

function profile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 0,
    sportContext: { enabledSports: ['squash'], primarySport: 'squash' },
    planWizardConfig: {
      goalEventId: 'goal-1',
      trainingDays: ['monday', 'tuesday', 'wednesday'],
      sessionsPerWeek: 1,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: [],
      currentFitnessLevel: 'fit',
      currentFatigue: 'normal',
      createdAt: '',
      updatedAt: '',
    } as PlanWizardConfig,
  }
}

function config(): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday', 'tuesday', 'wednesday'],
    doubleSessionDays: [],
    sessionsPerWeek: 1,
    maxSessionsPerWeek: 1,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    allowedSports: ['squash'],
    primarySport: 'squash',
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    fromWizard: true,
    configSource: 'wizard',
  }
}

beforeEach(() => {
  repairGeneratedWeekMock.mockReset()
  providerCallMock.mockReset()
  repairGeneratedWeekMock.mockReturnValue({
    sessions: [],
    meta: createRepairMeta(1),
    failure: REPAIR_FAILURE,
  })
})

describe('propagación de repair fail-closed en Week Creator', () => {
  it('el hidratador comunica el fallo sin sustituir la acción por una semana vacía', () => {
    const original = response()
    const result = hydrateWeekCreatorResponse({
      response: original,
      context: context(),
      config: config(),
      targetWeekStart: TARGET_WEEK,
    })

    expect(result.status).toBe('repair_failed')
    expect(result.repairFailure).toEqual(REPAIR_FAILURE)
    expect(result.response).toBe(original)
    expect(result.response.actions?.[0]?.sessions).toHaveLength(1)
  })

  it('el reparador final conserva el fallo para que el engine rechace la candidata', () => {
    const result = repairWeekCreatorResponse(
      response(),
      context(),
      config(),
      TARGET_WEEK,
    )

    expect(result.repairFailure).toEqual(REPAIR_FAILURE)
    expect(result.actions?.[0]?.sessions).toHaveLength(1)
  })

  it('el engine reintenta y termina sin fallback ni semana vacía aceptada', async () => {
    providerCallMock.mockResolvedValue({
      text: JSON.stringify({ actions: [action()] }),
      provider: 'mock',
      model: 'mock-model',
      traceId: 'provider-trace',
    })

    const result = await WeekCreatorEngine.sendWeekCreate(
      'arma una semana',
      context(),
      {
        targetWeekStart: TARGET_WEEK,
        provider: { name: 'mock', call: providerCallMock },
      },
    )

    expect(providerCallMock).toHaveBeenCalledTimes(2)
    expect(result.actions).toEqual([])
    expect(result.fallbackUsed).toBe(false)
    expect(result.message).toContain('sesiones de squash fueran distintas')
  })

  it('el rechazo de calidad no se contabiliza como falla de schema', async () => {
    providerCallMock.mockResolvedValue({
      text: JSON.stringify({ actions: [action()] }),
      provider: 'mock',
      model: 'mock-model',
      traceId: 'provider-trace',
    })

    // La respuesta parseó y validó: mezclarla con `schema_invalid` haría
    // indistinguibles las regresiones de contrato y los rechazos fail-closed.
    expect(classifyWeekCreatorRepairFailure(REPAIR_FAILURE).outcome).toBe('quality_rejected')

    const result = await WeekCreatorEngine.sendWeekCreate(
      'arma una semana',
      context(),
      {
        targetWeekStart: TARGET_WEEK,
        provider: { name: 'mock', call: providerCallMock },
      },
    )

    expect(result.meta?.outcome).toBe('quality_rejected')
    expect(result.meta?.actionParseFailed).toBe(false)
  })
})
