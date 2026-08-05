import { describe, expect, it, vi } from 'vitest'
import { generateWeek } from '../generateWeek'
import type { AIProvider } from '../../ai/types'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { useAIDebugStore } from '../../../store/useAIDebugStore'

function makePlan(wizardConfig: PlanWizardConfig): TrainingPlan {
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'shell',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-06-07', totalWeeks: 1,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-06-07', currentPhase: 'build', weeksRemaining: 1,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function makeWeek(): TrainingPlanWeek {
  return {
    id: 'w1', planId: 'p1', weekIndex: 0, weekStartDate: '2026-06-01', phase: 'build',
    status: 'pending', sessions: [], weekObjectives: [],
    targetLoadBySport: { squash: 50 }, validationIssues: [],
    generationMeta: { attempts: 0 }, createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

function makeWizard(): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday'],
    sessionsPerWeek: 1,
    sessionDurationMins: 45,
    allowDoubleSession: false,
    complementarySports: [],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
}

function makeProvider(chunks: string[], streamed?: boolean): AIProvider {
  return {
    name: 'mock',
    async call(request) {
      for (const chunk of chunks) request.onChunk?.(chunk)
      return {
        text: JSON.stringify({
          actions: [{
            type: 'create_week',
            targetDate: '2026-06-01',
            reason: 'ok',
            weekObjectives: [],
            sessions: [{
              date: '2026-06-01',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Squash control',
              objective: 'Control tecnico',
              durationMin: 45,
              rpe: 5,
            }],
          }],
        }),
        provider: 'mock',
        streamed,
        model: 'mock-1',
        durationMs: 100,
        traceId: request.traceId,
        requestClass: request.requestClass,
        retryUsed: false,
        fallbackUsed: false,
        finishReason: 'stop',
      }
    },
  }
}

describe('generateWeek streaming chunk accounting', () => {
  it('propagates provider chunks and stores chunkCount', async () => {
    const onChunk = vi.fn()
    const wizardConfig = makeWizard()

    const result = await generateWeek({
      provider: makeProvider(['hello', ' world']),
      plan: makePlan(wizardConfig),
      week: makeWeek(),
      profile: { id: 'a1', updatedAt: 0, sportContext: { primarySport: 'squash' } } as AthleteProfile,
      wizardConfig,
      onChunk,
    })

    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(onChunk).toHaveBeenNthCalledWith(1, 'hello')
    expect(result.meta.chunkCount).toBe(2)
  })

  it('reports chunkCount=0 when provider emits no chunks', async () => {
    const wizardConfig = makeWizard()

    const result = await generateWeek({
      provider: makeProvider([]),
      plan: makePlan(wizardConfig),
      week: makeWeek(),
      profile: { id: 'a1', updatedAt: 0, sportContext: { primarySport: 'squash' } } as AthleteProfile,
      wizardConfig,
    })

    expect(result.meta.chunkCount).toBe(0)
  })

  it.each([true, false])('stores the effective terminal transport streamed=%s', async (streamed) => {
    useAIDebugStore.getState().clear()
    const wizardConfig = makeWizard()

    const result = await generateWeek({
      provider: makeProvider([], streamed),
      plan: makePlan(wizardConfig),
      week: makeWeek(),
      profile: { id: 'a1', updatedAt: 0, sportContext: { primarySport: 'squash' } } as AthleteProfile,
      wizardConfig,
    })

    const telemetry = useAIDebugStore.getState().requests.find(
      (request) => request.traceId === result.meta.traceId,
    )
    expect(telemetry).toMatchObject({ status: 'completed', streamed })
  })

  it('preserves terminal transport when processing fails after the provider response', async () => {
    useAIDebugStore.getState().clear()
    const wizardConfig = makeWizard()
    const provider: AIProvider = {
      name: 'mock',
      async call(request) {
        const raw = {
          provider: 'mock',
          model: 'mock-1',
          streamed: false,
          traceId: request.traceId,
        }
        Object.defineProperty(raw, 'text', {
          get: () => { throw new Error('response decoding failed') },
        })
        return raw as Awaited<ReturnType<AIProvider['call']>>
      },
    }

    const result = await generateWeek({
      provider,
      plan: makePlan(wizardConfig),
      week: makeWeek(),
      profile: { id: 'a1', updatedAt: 0, sportContext: { primarySport: 'squash' } } as AthleteProfile,
      wizardConfig,
    })

    expect(useAIDebugStore.getState().requests.find(
      (request) => request.traceId === result.meta.traceId,
    )).toMatchObject({ status: 'failed', streamed: false })
  })
})
