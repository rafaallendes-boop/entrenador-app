import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
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
})
