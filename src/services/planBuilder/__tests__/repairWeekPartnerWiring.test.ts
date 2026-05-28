import { describe, expect, it } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { repairGeneratedWeek, type RepairContext } from '../repairWeek'

function wizard(partnerAvailability?: PlanWizardConfig['partnerAvailability']): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday'],
    sessionsPerWeek: 1,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    partnerAvailability,
    complementarySports: [],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
}

function context(partnerAvailability?: PlanWizardConfig['partnerAvailability']): RepairContext {
  const wizardConfig = wizard(partnerAvailability)
  const plan = {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'shell',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-06-07', totalWeeks: 1,
    phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-06-07', currentPhase: 'peak', weeksRemaining: 1,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
  const week = {
    id: 'w1', planId: 'p1', weekIndex: 0, weekStartDate: '2026-06-01', phase: 'peak',
    status: 'pending', sessions: [], weekObjectives: [], targetLoadBySport: { squash: 100 },
    validationIssues: [], generationMeta: { attempts: 0 }, createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
  const profile = { id: 'a1', updatedAt: 0, sportContext: { primarySport: 'squash' }, mainGoal: 'Squash competitivo' } as AthleteProfile
  return { plan, week, profile, wizardConfig }
}

describe('repairWeek partnerAvailability wiring', () => {
  it('redirects match content away from match drills when wizard says solo', () => {
    const result = repairGeneratedWeek([{
      date: '2026-06-01',
      timeBlock: 'AM',
      sessionType: 'squash',
      subtype: 'match',
      title: 'Partido de squash',
      objective: 'match',
      durationMin: 60,
      rpe: 7,
    }], context('solo'))

    expect(result.sessions[0]?.squashDetails?.sessionKind).not.toBe('match')
    expect(result.sessions[0]?.squashDetails?.blocks?.some((block) => block.kind === 'match')).not.toBe(true)
  })

  it('defaults to either when wizard omits partnerAvailability', () => {
    const result = repairGeneratedWeek([{
      date: '2026-06-01',
      timeBlock: 'AM',
      sessionType: 'squash',
      subtype: 'match',
      title: 'Partido de squash',
      objective: 'match',
      durationMin: 60,
      rpe: 7,
    }], context())

    expect(result.sessions[0]?.squashDetails?.drills.length).toBeGreaterThan(0)
  })
})
