// src/services/__tests__/doubleSessionUtilization.test.ts
import { describe, it, expect } from 'vitest'
import { repairGeneratedWeek } from '../planBuilder/repairWeek'
import type { RepairContext } from '../planBuilder/repairWeek'

function makeDoubleSessionContext(): RepairContext {
  return {
    plan: {
      id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
      title: 'Test', startDate: '2026-06-01', endDate: '2026-07-24', totalWeeks: 9,
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 8, blockFocus: 'build', intentBySport: {} }],
      wizardConfig: {} as never,
      macroSnapshot: {
        goalEventId: 'e1', goalEventDate: '2026-07-24', currentPhase: 'build', weeksRemaining: 6,
        blockFocus: 'build', headline: '', timeline: [],
        sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
        secondaryEvents: [], computedAt: 0,
      },
      createdAt: 0, updatedAt: 0,
    } as never,
    week: {
      id: 'w2', planId: 'p1', weekIndex: 2, weekStartDate: '2026-06-15', phase: 'build',
      status: 'pending', sessions: [], weekObjectives: [],
      targetLoadBySport: { squash: 50, strength: 25 },
      validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0, updatedAt: 0,
    } as never,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: {
      goalEventId: 'e1',
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      doubleSessionDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 8,
      sessionDurationMins: 60,
      allowDoubleSession: true,
      complementarySports: ['strength', 'running'],
      currentFitnessLevel: 'fit',
      currentFatigue: 'fresh',
      createdAt: '', updatedAt: '',
    } as never,
  }
}

describe('double session utilization', () => {
  it('emits warning when double days are underutilized (no doubles in week)', () => {
    const context = makeDoubleSessionContext()
    // All 5 training days have 1 session each — no doubles used
    const sessions = [
      { date: '2026-06-15', timeBlock: 'AM', sessionType: 'squash', title: 'Squash lun', durationMin: 60, rpe: 6 },   // monday
      { date: '2026-06-16', timeBlock: 'AM', sessionType: 'running', title: 'Running mar', durationMin: 45, rpe: 5 },  // tuesday
      { date: '2026-06-17', timeBlock: 'AM', sessionType: 'squash', title: 'Squash mie', durationMin: 60, rpe: 6 },   // wednesday
      { date: '2026-06-18', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza jue', durationMin: 60, rpe: 6 }, // thursday
      { date: '2026-06-19', timeBlock: 'AM', sessionType: 'squash', title: 'Squash vie', durationMin: 60, rpe: 6 },   // friday
    ] as never

    const result = repairGeneratedWeek(sessions, context)
    expect(result.meta.warnings.some((w) => w.code === 'double_session_underutilized')).toBe(true)
  })

  it('does NOT emit warning when enough double days are utilized (≥50%)', () => {
    const context = makeDoubleSessionContext()
    // Monday and Wednesday have doubles (2/3 = 66% ≥ 50%)
    const sessions = [
      { date: '2026-06-15', timeBlock: 'AM', sessionType: 'squash', title: 'S1', durationMin: 60, rpe: 6 },    // monday AM
      { date: '2026-06-15', timeBlock: 'PM', sessionType: 'strength', title: 'S2', durationMin: 60, rpe: 5 },  // monday PM (double!)
      { date: '2026-06-17', timeBlock: 'AM', sessionType: 'squash', title: 'S3', durationMin: 60, rpe: 6 },    // wednesday AM
      { date: '2026-06-17', timeBlock: 'PM', sessionType: 'running', title: 'S4', durationMin: 45, rpe: 4 },   // wednesday PM (double!)
      { date: '2026-06-18', timeBlock: 'AM', sessionType: 'strength', title: 'S5', durationMin: 60, rpe: 6 },  // thursday
    ] as never

    const result = repairGeneratedWeek(sessions, context)
    expect(result.meta.warnings.some((w) => w.code === 'double_session_underutilized')).toBe(false)
  })

  it('does NOT emit warning when allowDoubleSession is false', () => {
    const context = makeDoubleSessionContext()
    context.wizardConfig = { ...context.wizardConfig, allowDoubleSession: false }

    const sessions = [
      { date: '2026-06-15', timeBlock: 'AM', sessionType: 'squash', title: 'S1', durationMin: 60, rpe: 6 },
    ] as never

    const result = repairGeneratedWeek(sessions, context)
    expect(result.meta.warnings.some((w) => w.code === 'double_session_underutilized')).toBe(false)
  })
})
