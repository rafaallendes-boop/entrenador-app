import { describe, it, expect } from 'vitest'
import { repairGeneratedWeek } from '../planBuilder/repairWeek'
import type { RepairContext } from '../planBuilder/repairWeek'

// Minimal context builder for taper week
function makeTaperContext(): RepairContext {
  return {
    plan: {
      id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
      title: 'Test', startDate: '2026-06-29', endDate: '2026-07-24', totalWeeks: 9,
      phases: [{ phase: 'taper', startWeekIndex: 7, endWeekIndex: 8, blockFocus: 'taper', intentBySport: {} }],
      wizardConfig: {} as never,
      macroSnapshot: {
        goalEventId: 'e1', goalEventDate: '2026-07-24', currentPhase: 'taper', weeksRemaining: 1,
        blockFocus: 'taper', headline: '', timeline: [],
        sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
        secondaryEvents: [], computedAt: 0,
      },
      createdAt: 0, updatedAt: 0,
    } as never,
    week: {
      id: 'w7', planId: 'p1', weekIndex: 7, weekStartDate: '2026-06-29', phase: 'taper',
      status: 'pending', sessions: [], weekObjectives: [],
      targetLoadBySport: { squash: 40, strength: 20 },
      validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0, updatedAt: 0,
    } as never,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: {
      goalEventId: 'e1', trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      doubleSessionDays: [], sessionsPerWeek: 5, sessionDurationMins: 60,
      allowDoubleSession: false, complementarySports: ['strength'],
      currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '',
    } as never,
  }
}

describe('taper load capping', () => {
  it('caps targetPercent1RM to 70 for strength exercises in taper week', () => {
    const context = makeTaperContext()
    const sessions = [
      {
        date: '2026-06-30', timeBlock: 'AM', sessionType: 'strength',
        title: 'Fuerza taper', durationMin: 40, rpe: 5,
        exercises: [
          { name: 'Hip Thrust', sets: 3, reps: 5, group: 'legs', targetPercent1RM: 80, weight: 115 },
          { name: 'Sentadilla', sets: 3, reps: 5, group: 'legs', targetPercent1RM: 75, weight: 95 },
          { name: 'Control de tronco dead bug', sets: 2, reps: 10, group: 'core' },
        ],
      },
    ] as never

    const result = repairGeneratedWeek(sessions, context)
    const strength = result.sessions.find((s) => s.sessionType === 'strength')!

    const hipThrust = strength.exercises!.find((e: { name: string }) => e.name === 'Hip Thrust')!
    expect(hipThrust.targetPercent1RM).toBe(70)
    // weight reduced proportionally: 115 * (70/80) = ~100.625 → rounds to 100
    expect(hipThrust.weight).toBeLessThan(115)

    const sentadilla = strength.exercises!.find((e: { name: string }) => e.name === 'Sentadilla')!
    expect(sentadilla.targetPercent1RM).toBe(70)
    // weight: 95 * (70/75) = ~88.67 → rounds to 87.5
    expect(sentadilla.weight).toBeLessThan(95)

    // Core exercise unaffected (no targetPercent1RM)
    const core = strength.exercises!.find((e) => e.group === 'core')!
    expect(core.targetPercent1RM).toBeUndefined()

    // Warning emitted
    expect(result.meta.warnings.some((w) => w.code === 'taper_load_capped')).toBe(true)
  })

  it('does not cap exercises already at 70% or below', () => {
    const context = makeTaperContext()
    const sessions = [
      {
        date: '2026-06-30', timeBlock: 'AM', sessionType: 'strength',
        title: 'Fuerza taper light', durationMin: 40, rpe: 4,
        exercises: [
          { name: 'Sentadilla', sets: 3, reps: 8, group: 'legs', targetPercent1RM: 65, weight: 80 },
        ],
      },
    ] as never

    const result = repairGeneratedWeek(sessions, context)
    const strength = result.sessions.find((s) => s.sessionType === 'strength')!
    const sentadilla = strength.exercises!.find((e: { name: string }) => e.name === 'Sentadilla')
    expect(sentadilla?.targetPercent1RM).toBe(65) // unchanged
    expect(sentadilla?.weight).toBe(80) // unchanged
  })

  it('does not cap non-strength sessions', () => {
    const context = makeTaperContext()
    const sessions = [
      {
        date: '2026-06-30', timeBlock: 'AM', sessionType: 'squash',
        title: 'Squash taper', durationMin: 50, rpe: 5,
      },
    ] as never

    const result = repairGeneratedWeek(sessions, context)
    expect(result.meta.warnings.some((w) => w.code === 'taper_load_capped')).toBe(false)
  })
})
