import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import { WeekCreatorEngine } from '../WeekCreatorEngine'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import { useAIDebugStore } from '../../../store/useAIDebugStore'

const mockProviderCall = vi.hoisted(() => vi.fn())

vi.mock('../../ai/providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
}))

vi.mock('../../ai/aiTelemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai/aiTelemetry')>()),
  assertDailyAIRequestLimit: vi.fn(async () => undefined),
}))

const context: ChatContext = {
  athleteProfile: {
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
  } as AthleteProfile,
  recentSessions: [],
  plannedSessions: [],
  historicalSessions: [],
}

function firstRequestTarget(): unknown {
  const request = mockProviderCall.mock.calls[0]?.[0] as Record<string, unknown> | undefined
  return request?.['targetAthleteId']
}

beforeEach(() => {
  mockProviderCall.mockReset()
  // Falla el proveedor a propósito: la request ya quedó capturada y el resto
  // del motor (validación, repair, fallback) no aporta a lo que se verifica.
  mockProviderCall.mockRejectedValue(new Error('provider down'))
  useAIDebugStore.getState().clear()
})

afterEach(() => {
  setSelfAthleteId(null)
  setActiveAthleteId(null)
})

describe('Week Creator propone el atleta activo', () => {
  it('manda el gestionado activo', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')

    await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    expect(firstRequestTarget()).toBe('ath_m_1')
  })

  it('no propone objetivo cuando el activo es el propio actor', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')

    await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    expect(firstRequestTarget()).toBeNull()
  })
})
