import { describe, expect, it } from 'vitest'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import { buildPlanShell } from '../planBuilder/buildPlanShell'
import { validatePlan } from '../planBuilder/validator'

function makeProfile(eventDate: string): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: Date.now(),
    name: 'Test',
    sportContext: {
      enabledSports: ['squash', 'running', 'strength'],
      primarySport: 'squash',
    },
    goalEvents: [
      {
        id: 'evt-1',
        title: 'Regional',
        date: eventDate,
        sport: 'squash',
        priority: 'primary',
      },
    ],
  }
}

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'evt-1',
    trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function eventNWeeksFromNow(weeks: number): string {
  const d = new Date()
  d.setDate(d.getDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

describe('planBuilder', () => {
  it('buildPlanShell creates one week per calendar week until event', () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    expect(plan.totalWeeks).toBeGreaterThanOrEqual(8)
    expect(plan.totalWeeks).toBeLessThanOrEqual(10)
    expect(weeks).toHaveLength(plan.totalWeeks)
    expect(weeks[0].weekIndex).toBe(0)
    expect(weeks[weeks.length - 1].weekIndex).toBe(plan.totalWeeks - 1)
    expect(plan.phases.length).toBeGreaterThan(0)
  })

  it('buildPlanShell caps at 20 weeks for far events', () => {
    const profile = makeProfile(eventNWeeksFromNow(40))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    expect(plan.totalWeeks).toBe(20)
    expect(weeks).toHaveLength(20)
  })

  it('validatePlan reports empty weeks as warnings without erroring', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    // Mark one as draft with zero sessions to trigger warning branch
    weeks[0].status = 'draft'
    const issues = validatePlan({ plan, weeks })
    expect(issues.some((i) => i.code === 'week.sessions.empty')).toBe(true)
    expect(issues.every((i) => i.severity !== 'error' || i.code !== 'plan.structure.weeks_mismatch')).toBe(true)
  })

  it('validatePlan detects day+timeBlock collisions within a week', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    const date = weeks[0].weekStartDate
    weeks[0].status = 'draft'
    weeks[0].sessions = [
      { date, timeBlock: 'AM', sessionType: 'squash', title: 'A', durationMin: 60 },
      { date, timeBlock: 'AM', sessionType: 'running', title: 'B', durationMin: 45 },
    ]
    const issues = validatePlan({ plan, weeks })
    expect(issues.some((i) => i.code === 'week.sessions.collision')).toBe(true)
  })
})
