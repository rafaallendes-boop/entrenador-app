import { expect, it, vi } from 'vitest'
import { generateWeek } from '../generateWeek'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from '../planBuilderResponseSchema'
import type { AIProvider } from '../../ai/types'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

function makeMinimalPlan(): TrainingPlan {
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'shell',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-06-14', totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    wizardConfig: {} as PlanWizardConfig,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-06-14', currentPhase: 'build', weeksRemaining: 2,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function makeMinimalWeek(): TrainingPlanWeek {
  return {
    id: 'w1', planId: 'p1', weekIndex: 0, weekStartDate: '2026-06-01', phase: 'build',
    status: 'pending', sessions: [], weekObjectives: [{ goal: 'test' }],
    targetLoadBySport: { squash: 50, running: 25, strength: 25, mobility: 25 },
    validationIssues: [],
    generationMeta: { attempts: 0, provider: '', model: '' },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

it('generateWeek passes responseSchema and responseMimeType=application/json to the provider', async () => {
  const callSpy = vi.fn(async (request: {
    responseMimeType?: string
    responseSchema?: Record<string, unknown>
    systemPrompt: string
    userMessage: string
    onChunk?: (chunk: string) => void
  }) => ({
    ...request,
    text: '<actions>[{"type":"create_week","targetDate":"2026-06-01","reason":"x","sessions":[],"weekObjectives":[]}]</actions>',
    provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 100, traceId: 't', text_length: 0,
  } as never))
  const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider

  const result = await generateWeek({
    provider,
    plan: makeMinimalPlan(),
    week: makeMinimalWeek(),
    profile: { id: 'default', updatedAt: 0 } as AthleteProfile,
    wizardConfig: {
      goalEventId: 'e1', trainingDays: ['monday','tuesday','wednesday','thursday','friday','saturday'],
      doubleSessionDays: [], sessionsPerWeek: 6, sessionDurationMins: 60,
      allowDoubleSession: false, complementarySports: ['running','strength'],
      currentFitnessLevel: 'fit', currentFatigue: 'fresh',
      createdAt: '', updatedAt: '',
    },
  })

  expect(callSpy).toHaveBeenCalledTimes(1)
  const callArgs = callSpy.mock.calls[0]?.[0]
  if (!callArgs) throw new Error('Expected provider call')
  expect(callArgs.responseMimeType).toBe('application/json')
  expect(callArgs.responseSchema).toEqual(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA)
  expect(callArgs.onChunk).toEqual(expect.any(Function))
  expect(callArgs.systemPrompt).not.toContain('<actions>')
  expect(callArgs.userMessage).not.toContain('<actions>')
  expect(callArgs.userMessage).toContain('objeto JSON create_week')
  expect(callArgs.userMessage).toContain('running/cycling son soporte')
  expect(callArgs.userMessage).toContain('No uses tempo, intervalos, long run')
  expect(result.meta).toMatchObject({
    repairTaxonomyVersion: 2,
    hydrationActionCount: 0,
    correctiveActionCount: 0,
    structuralActionCount: 0,
    hydratedSessionsAffected: 0,
    correctedSessionsAffected: 0,
    structurallyRepairedSessionsAffected: 0,
  })
})
