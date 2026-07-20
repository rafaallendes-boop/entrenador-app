import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import { AIProviderError } from '../../ai/types'
import { WeekCreatorEngine } from '../WeekCreatorEngine'
import { useAIDebugStore } from '../../../store/useAIDebugStore'

const mockProviderCall = vi.hoisted(() => vi.fn())
const mockAssertDailyAIRequestLimit = vi.hoisted(() => vi.fn())

vi.mock('../../ai/providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
}))

vi.mock('../../ai/aiTelemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai/aiTelemetry')>()),
  assertDailyAIRequestLimit: mockAssertDailyAIRequestLimit,
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

beforeEach(() => {
  mockProviderCall.mockReset()
  mockAssertDailyAIRequestLimit.mockReset()
  mockAssertDailyAIRequestLimit.mockResolvedValue(undefined)
  useAIDebugStore.getState().clear()
})

// Regression: the engine declared a `week_creator` daily cap but never called
// the guard, so a canary run logged 18 uses against a limit of 8.
describe('WeekCreatorEngine daily limit guard', () => {
  it('checks the daily week_creator limit before calling the provider', async () => {
    mockProviderCall.mockRejectedValue(new Error('provider down'))

    await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    expect(mockAssertDailyAIRequestLimit).toHaveBeenCalledWith('week_creator')
  })

  it('does not spend a provider call once the daily cap is reached', async () => {
    mockAssertDailyAIRequestLimit.mockRejectedValue(
      new AIProviderError('gemini', 'rate_limit', 'Límite diario beta alcanzado', false),
    )

    await expect(WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )).rejects.toMatchObject({ code: 'rate_limit' })

    expect(mockProviderCall).not.toHaveBeenCalled()
  })
})
