import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, ChatContext } from '../../../types'
import type { AIProvider } from '../../ai/types'
import { useAIDebugStore } from '../../../store/useAIDebugStore'
import { WeekCreatorEngine } from '../WeekCreatorEngine'
import { resolveWeekCreatorConfig } from '../WeekCreatorConfig'
import { resolveWeekCreatorSafetyConstraints } from '../WeekCreatorLocalHydrator'

const TARGET_WEEK = '2026-09-07'

function profile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'athlete-safety',
    updatedAt: 1,
    sportContext: { enabledSports: ['strength'], primarySport: 'strength' },
    planWizardConfig: {
      goalEventId: 'goal-safety',
      trainingDays: ['monday'],
      sessionsPerWeek: 1,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: [],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    ...overrides,
  }
}

function context(athleteProfile: AthleteProfile): ChatContext {
  return { athleteProfile, recentSessions: [], plannedSessions: [], historicalSessions: [] }
}

function providerWithStrengthWeek(call = vi.fn()): AIProvider {
  return {
    name: 'gemini',
    call: async (request) => {
      call(request)
      return {
        provider: 'gemini',
        traceId: request.traceId,
        requestClass: request.requestClass,
        text: `<actions>${JSON.stringify([{
          type: 'create_week',
          reason: 'Semana de fuerza',
          targetDate: TARGET_WEEK,
          sessions: [{
            date: TARGET_WEEK,
            timeBlock: 'AM',
            sessionType: 'strength',
            title: 'Fuerza',
            durationMin: 60,
            objective: 'Fuerza general',
            exercises: [
              { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' },
              { name: 'Press inclinado con mancuernas', sets: 3, reps: 8, group: 'push' },
              { name: 'Remo con pecho apoyado', sets: 3, reps: 10, group: 'pull' },
            ],
          }],
        }])}</actions>`,
      }
    },
  }
}

beforeEach(() => useAIDebugStore.getState().clear())

describe('Week Creator strength safety', () => {
  it('resolves persisted sources and the triggering message, never the transported config note', () => {
    const athleteProfile = profile({
      planWizardConfig: {
        ...profile().planWizardConfig!,
        injuryNotes: 'dolor de rodilla',
      },
    })
    const config = {
      ...resolveWeekCreatorConfig(athleteProfile),
      // This config field is a transport projection and must not become a
      // second medical source for Week Creator safety.
      injuryNotes: 'dolor lumbar',
    }

    const constraints = resolveWeekCreatorSafetyConstraints(
      context(athleteProfile),
      config,
      'Por favor evitar ejercicios de impacto',
    )

    expect(constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'region', region: 'knee' }),
      expect.objectContaining({ kind: 'load_pattern', pattern: 'impact' }),
    ]))
    expect(constraints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'region', region: 'lumbar' }),
    ]))
  })

  it('replaces a lumbar-loaded fallback/provider exercise from a viable pool', async () => {
    const calls = vi.fn()
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una sesión de pesas',
      context(profile({ recoveryProfile: { currentInjuries: 'dolor lumbar' } })),
      { targetWeekStart: TARGET_WEEK, provider: providerWithStrengthWeek(calls) },
    )

    expect(calls).toHaveBeenCalledTimes(1)
    expect(response.meta?.outcome).not.toBe('safety_blocked')
    const strength = response.actions?.[0]?.sessions?.find((session) => session.sessionType === 'strength')
    expect(strength?.exercises?.map((exercise) => exercise.name)).not.toContain('Peso muerto rumano')
    expect(strength?.metadata?.strengthSafetyFinalization).toBeDefined()
  })

  it('terminates a safe decline from deterministic fallback without a retry or proposal', async () => {
    const calls = vi.fn()
    const invalidProvider: AIProvider = {
      name: 'gemini',
      call: async (request) => {
        calls(request)
        return { provider: 'gemini', traceId: request.traceId, requestClass: request.requestClass, text: '<actions>[]</actions>' }
      },
    }
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una sesión de pesas',
      context(profile({
        sportContext: { enabledSports: ['strength'], primarySport: 'strength', trainingPriority: 'return_to_play' },
      })),
      { targetWeekStart: TARGET_WEEK, provider: invalidProvider },
    )

    expect(calls).toHaveBeenCalledTimes(1)
    expect(response.actions).toEqual([])
    expect(response.meta?.outcome).toBe('safety_blocked')
    expect(response.message).toBe('No pude verificar una sesión de fuerza compatible con la restricción registrada.')
    const request = useAIDebugStore.getState().requests[0]
    expect(request).toMatchObject({
      status: 'completed',
      outcome: 'safety_blocked',
      proposalCreated: false,
      generationOutcome: 'safe_decline',
    })
  })

  it('terminates a provider week blocked by Plan Builder without retry or fallback', async () => {
    const calls = vi.fn()
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una sesión de pesas',
      context(profile({
        sportContext: {
          enabledSports: ['strength'],
          primarySport: 'strength',
          trainingPriority: 'return_to_play',
        },
      })),
      { targetWeekStart: TARGET_WEEK, provider: providerWithStrengthWeek(calls) },
    )

    expect(calls).toHaveBeenCalledTimes(1)
    expect(response.actions).toEqual([])
    expect(response.fallbackUsed).toBe(false)
    expect(response.meta?.outcome).toBe('safety_blocked')
  })
})
