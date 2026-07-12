import { describe, expect, it } from 'vitest'
import {
  buildWeekStructuredSystemPromptMinimal,
  buildWeekBatchStructuredSystemPromptMinimal,
  buildWeekBatchUserPrompt,
  buildWeekUserPrompt,
} from '../prompts/weekPrompt'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from '../../planBuilder/planBuilderResponseSchema'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function makePlan(): TrainingPlan {
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'shell',
    title: 'Plan Test', startDate: '2026-06-01', endDate: '2026-06-14', totalWeeks: 9,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 8, blockFocus: 'Focus block', intentBySport: {} }],
    wizardConfig: {} as PlanWizardConfig,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-07-24', currentPhase: 'build', weeksRemaining: 9,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'build', intensityBias: 'build', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function makeWeek(weekStart: string, idx: number, withStrength: boolean): TrainingPlanWeek {
  return {
    id: `w${idx}`, planId: 'p1', weekIndex: idx, weekStartDate: weekStart,
    phase: 'build', status: 'pending', sessions: [],
    weekObjectives: [{ goal: `objetivo ${idx}` }],
    targetLoadBySport: { squash: 75, running: 41, strength: withStrength ? 41 : 0, mobility: 41 },
    validationIssues: [],
    generationMeta: { attempts: 0, provider: '', model: '' },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

function makeProfile(): AthleteProfile {
  return {
    id: 'default', updatedAt: 0, name: 'Rafa', age: 34, weightKg: 78,
    mainGoal: 'Compete', primarySport: 'squash',
    strengthProfile: { squat1RM: 120, deadlift1RM: 140, benchPress1RM: 90, overheadPress1RM: 65 },
  } as AthleteProfile
}

function makeWizard(): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    doubleSessionDays: ['monday', 'wednesday', 'friday'],
    sessionsPerWeek: 6, sessionDurationMins: 60, allowDoubleSession: true,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'fit', currentFatigue: 'fresh',
    createdAt: '', updatedAt: '',
  } as PlanWizardConfig
}

describe('weekPrompt batch compaction (Phase 1)', () => {
  it('batch system prompt minimal stays under 700 estimated tokens', () => {
    const sys = buildWeekBatchStructuredSystemPromptMinimal()
    expect(estimateTokens(sys)).toBeLessThan(700)
  })

  it('batch user prompt for 2 weeks stays under 2000 estimated tokens', () => {
    const plan = makePlan()
    const weeks: [TrainingPlanWeek, TrainingPlanWeek] = [
      makeWeek('2026-06-01', 0, true),
      makeWeek('2026-06-08', 1, true),
    ]
    const userPrompt = buildWeekBatchUserPrompt({
      plan, weeks, profile: makeProfile(), wizardConfig: makeWizard(), outputFormat: 'json',
    })
    expect(estimateTokens(userPrompt)).toBeLessThan(2000)
  })

  it('strength pack is omitted when no week of the batch uses strength', () => {
    const plan = makePlan()
    const weeks: [TrainingPlanWeek, TrainingPlanWeek] = [
      makeWeek('2026-06-01', 0, false),
      makeWeek('2026-06-08', 1, false),
    ]
    const userPrompt = buildWeekBatchUserPrompt({
      plan, weeks, profile: makeProfile(), wizardConfig: makeWizard(),
    })
    // Heuristic: if strength pack is included, it would contain the literal "1RM" or "%1RM".
    expect(userPrompt).not.toMatch(/1RM/)
  })

  it('omits the strength detail pack from structured JSON requests', () => {
    const plan = makePlan()
    const weeks: [TrainingPlanWeek, TrainingPlanWeek] = [
      makeWeek('2026-06-01', 0, true),
      makeWeek('2026-06-08', 1, false),
    ]
    const userPrompt = buildWeekBatchUserPrompt({
      plan, weeks, profile: makeProfile(), wizardConfig: makeWizard(), outputFormat: 'json',
    })
    expect(userPrompt).not.toMatch(/1RM/)
  })

  it('asks Claude for a compact skeleton that repairWeek can hydrate', () => {
    const systemPrompt = buildWeekStructuredSystemPromptMinimal()
    const userPrompt = buildWeekUserPrompt({
      plan: makePlan(),
      week: makeWeek('2026-06-01', 0, true),
      profile: makeProfile(),
      wizardConfig: makeWizard(),
      outputFormat: 'json',
    })

    expect(systemPrompt).toContain('esqueleto semanal compacto')
    expect(systemPrompt).toContain('No incluyas exercises')
    expect(userPrompt).not.toMatch(/1RM/)
  })

  it('keeps sport-specific detail fields out of the Plan Builder tool schema', () => {
    const serialized = JSON.stringify(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA)
    expect(serialized).not.toContain('exercises')
    expect(serialized).not.toContain('squashDetails')
    expect(serialized).not.toContain('warmupSets')
  })
})
