import { describe, it, expect } from 'vitest'
import { repairGeneratedWeek } from '../repairWeek'
import type { RepairContext } from '../repairWeek'
import { validatePlanWeek } from '../validator'
import type { CoachSessionProposal } from '../../../types'
import type { TrainingPlanWeek } from '../../../types/planBuilder'

function makePeakSquashContext(): RepairContext {
  const plan = {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-08-30', totalWeeks: 12,
    phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 11, blockFocus: 'peak', intentBySport: {} }],
    wizardConfig: {
      goalEventId: 'e1', trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      doubleSessionDays: [], sessionsPerWeek: 6, sessionDurationMins: 60,
      allowDoubleSession: false, complementarySports: ['strength', 'running'],
      currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '',
    },
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-08-30', currentPhase: 'peak', weeksRemaining: 8,
      blockFocus: 'peak', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'reduce', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as never

  const week = {
    id: 'w4', planId: 'p1', weekIndex: 4, weekStartDate: '2026-06-29', phase: 'peak',
    status: 'draft', sessions: [], weekObjectives: [],
    targetLoadBySport: { squash: 70, strength: 20, running: 15, mobility: 10 },
    validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
    createdAt: 0, updatedAt: 0,
  } as never

  return {
    plan,
    week,
    profile: { id: 'default', updatedAt: 0, mainGoal: 'Nacional de squash' } as never,
    wizardConfig: (plan as { wizardConfig: unknown }).wizardConfig as never,
    previousWeek: undefined,
    planWeekDescriptors: [{ weekIndex: 4, phase: 'peak' }],
  }
}

describe('primary sport dominance in build/peak', () => {
  it('repairs an underweighted primary squash week so squash dominates', () => {
    const context = makePeakSquashContext()
    const rawSessions: CoachSessionProposal[] = [
      { date: '2026-06-29', timeBlock: 'AM', sessionType: 'squash', title: 'Squash', durationMin: 60, rpe: 6, subtype: 'match' },
      { date: '2026-06-30', timeBlock: 'AM', sessionType: 'squash', title: 'Squash', durationMin: 60, rpe: 6, subtype: 'technical' },
      { date: '2026-07-01', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6 },
      { date: '2026-07-02', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6 },
      { date: '2026-07-03', timeBlock: 'AM', sessionType: 'running', title: 'Z2', durationMin: 40, rpe: 5 },
      { date: '2026-07-04', timeBlock: 'AM', sessionType: 'mobility', title: 'Movilidad', durationMin: 30, rpe: 3 },
    ]

    const result = repairGeneratedWeek(rawSessions as never, context)

    expect(result.failure).toBeUndefined()
    const primaryCount = result.sessions.filter((s) => s.sessionType === 'squash').length
    const supportCount = result.sessions.filter((s) => s.sessionType !== 'squash').length
    expect(primaryCount).toBeGreaterThan(supportCount)

    const repairedWeek = { ...(context.week as TrainingPlanWeek), sessions: result.sessions }
    const issues = validatePlanWeek(context.plan, repairedWeek)
    expect(issues.some((i) => i.code === 'week.primary_sport.underweighted')).toBe(false)
  })
})
