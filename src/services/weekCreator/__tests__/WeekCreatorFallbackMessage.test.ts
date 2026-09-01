import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import { EntitlementRequiredError, buildEntitlementDetail } from '../../entitlements/entitlementError'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
} from '../../entitlements/usageGateError'
import { WeekCreatorEngine } from '../WeekCreatorEngine'
import { useAIDebugStore } from '../../../store/useAIDebugStore'
import { db } from '../../../db/db'

const mockProviderCall = vi.hoisted(() => vi.fn())

vi.mock('../../ai/providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
}))

function makeProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: Date.now(),
    sportContext: { enabledSports: ['squash', 'strength'], primarySport: 'squash' },
    planWizardConfig: {
      goalEventId: 'goal-1',
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      sessionsPerWeek: 4,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['strength'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  } as AthleteProfile
}

const context: ChatContext = {
  athleteProfile: makeProfile(),
  recentSessions: [],
  plannedSessions: [],
  historicalSessions: [],
}

async function runWeekCreator() {
  return WeekCreatorEngine.sendWeekCreate(
    'Créame la semana',
    context,
    { surface: 'chat', targetWeekStart: '2026-05-04' },
  )
}

beforeEach(async () => {
  mockProviderCall.mockReset()
  useAIDebugStore.getState().clear()
  await db.aiRequestLogs.clear()
})

// The canary reported "la IA no devolvió una semana válida" for a run where the
// provider answered correctly and the local hydrate/repair pass produced the
// invalid week. Blaming the model sends the user to debug the wrong layer.
describe('Week Creator fallback message attribution', () => {
  it('blames the connection only when the provider actually failed', async () => {
    mockProviderCall.mockRejectedValue(new Error('provider down'))

    const response = await runWeekCreator()

    expect(response.fallbackUsed).toBe(true)
    expect(response.message).toContain('no pude conectar con la IA')
  })

  it('does not blame the model when it answered and local validation rejected the week', async () => {
    // A well-formed provider answer that carries no create_week action: the
    // model responded, the week failed locally.
    mockProviderCall.mockResolvedValue({
      text: JSON.stringify({ message: 'Lista tu semana', actions: [] }),
      provider: 'mock',
      model: 'mock-model',
      durationMs: 10,
      finishReason: 'stop',
    })

    const response = await runWeekCreator()

    expect(response.fallbackUsed).toBe(true)
    expect(response.message).toContain('semana base automática')
    expect(response.message).not.toContain('no pude conectar con la IA')
    expect(response.message).not.toContain('la IA no devolvió una semana válida')
    expect(response.message).toContain('no pasó las validaciones')
  })

  it('propaga el entitlement en vez de fabricar una semana local', async () => {
    const denial = new EntitlementRequiredError(
      buildEntitlementDetail('week_creator', 'advanced', 'free'),
    )
    mockProviderCall.mockRejectedValue(denial)

    await expect(runWeekCreator()).rejects.toBe(denial)
    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(useAIDebugStore.getState().requests.some((request) => request.fallbackUsed)).toBe(false)
  })

  // El entitlement no es el único gate de servidor. Cuota, techo de gasto y
  // kill switch también rechazan ANTES del proveedor, y tratarlos como caída
  // técnica hacía que el cliente entregara la semana determinista que el
  // servidor acababa de negar — además de gastar un segundo intento contra un
  // 429 que iba a repetirse.
  it.each([
    ['cuota diaria', () => new QuotaExceededError({ bucketId: 'week_creator', limit: 8, remaining: 0 })],
    ['techo de gasto', () => new SpendCapExceededError({ scope: 'account' as const, capUsd: 3 })],
    ['kill switch', () => new KillSwitchActiveError()],
  ])('propaga el rechazo por %s en vez de fabricar una semana local', async (_label, build) => {
    const rejection = build()
    mockProviderCall.mockRejectedValue(rejection)

    await expect(runWeekCreator()).rejects.toBe(rejection)
    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(useAIDebugStore.getState().requests.some((request) => request.fallbackUsed)).toBe(false)
  })
})
