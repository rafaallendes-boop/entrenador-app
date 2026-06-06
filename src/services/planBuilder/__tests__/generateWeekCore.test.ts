import { describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { AIRawResponse } from '../../ai/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { generateWeekCore } from '../generateWeekCore'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from '../planBuilderResponseSchema'

function makeRaw(text: string): AIRawResponse {
  return {
    text,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    traceId: 'trace-1',
    durationMs: 100,
  }
}

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'tuesday'],
    sessionsPerWeek: 2,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

function makePlan(wizardConfig = makeWizardConfig()): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan test',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
    totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: 'build', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-06-14',
      currentPhase: 'build',
      weeksRemaining: 2,
      blockFocus: 'build',
      headline: 'Plan test',
      timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: 'build', weeklyIntent: 'technical', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeWeek(): TrainingPlanWeek {
  return {
    id: 'week-1',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-06-01',
    phase: 'build',
    status: 'pending',
    sessions: [],
    weekObjectives: [{ sport: 'squash', goal: 'Technical rhythm' }],
    targetLoadBySport: { squash: 60, running: 20, strength: 20 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 0,
    sportContext: {
      enabledSports: ['squash', 'running', 'strength'],
      primarySport: 'squash',
    },
  }
}

describe('generateWeekCore', () => {
  it('builds the expected LLM request contract', async () => {
    const callLLM = vi.fn(async () => makeRaw(JSON.stringify({
      type: 'create_week',
      targetDate: '2026-06-01',
      sessions: [],
    })))

    await generateWeekCore({
      plan: makePlan(),
      week: makeWeek(),
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      retryInstruction: 'Corrige el conteo de sesiones.',
      traceId: 'trace-1',
      maxTokens: 3500,
      temperature: 0.2,
      callLLM,
    })

    expect(callLLM).toHaveBeenCalledOnce()
    const request = callLLM.mock.calls[0]?.[0]
    expect(request?.requestClass).toBe('plan_builder_week')
    expect(request?.traceId).toBe('trace-1')
    expect(request?.maxTokens).toBe(3500)
    expect(request?.temperature).toBe(0.2)
    expect(request?.responseMimeType).toBe('application/json')
    expect(request?.responseSchema).toEqual(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA)
    expect(request?.userMessage).toContain('Corrige el conteo de sesiones.')
  })

  it('returns an error result when the model emits an empty week', async () => {
    const callLLM = vi.fn(async () => makeRaw(JSON.stringify({
      type: 'create_week',
      targetDate: '2026-06-01',
      sessions: [],
    })))

    const result = await generateWeekCore({
      plan: makePlan(),
      week: makeWeek(),
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      traceId: 'trace-1',
      callLLM,
    })

    expect(result.sessions).toHaveLength(0)
    expect(result.meta.provider).toBe('claude')
    expect(result.meta.model).toBe('claude-sonnet-4-6')
    expect(result.meta.lastError).toContain('no devolvió sesiones válidas')
  })
})
