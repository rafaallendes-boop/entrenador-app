import { describe, it, expect } from 'vitest'
import { repairGeneratedWeek } from '../planBuilder/repairWeek'
import type { RepairContext } from '../planBuilder/repairWeek'

function makeBuildContext(previousWeekExercises: string[]): RepairContext {
  const previousSessions = previousWeekExercises.length > 0 ? [
    {
      date: '2026-06-22', timeBlock: 'AM', sessionType: 'strength',
      title: 'Fuerza semana anterior', durationMin: 60, rpe: 6,
      exercises: previousWeekExercises.map((name) => ({ name, sets: 3, reps: 5, group: 'legs' as never })),
    }
  ] : []

  return {
    plan: {
      id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
      title: 'Test', startDate: '2026-06-01', endDate: '2026-07-24', totalWeeks: 9,
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 8, blockFocus: 'build', intentBySport: {} }],
      wizardConfig: {} as never,
      macroSnapshot: {
        goalEventId: 'e1', goalEventDate: '2026-07-24', currentPhase: 'build', weeksRemaining: 5,
        blockFocus: 'build', headline: '', timeline: [],
        sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
        secondaryEvents: [], computedAt: 0,
      },
      createdAt: 0, updatedAt: 0,
    } as never,
    week: {
      id: 'w4', planId: 'p1', weekIndex: 4, weekStartDate: '2026-06-29', phase: 'build',
      status: 'pending', sessions: [], weekObjectives: [],
      targetLoadBySport: { squash: 50, strength: 30 },
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
    previousWeek: {
      id: 'w3', planId: 'p1', weekIndex: 3, weekStartDate: '2026-06-22', phase: 'build',
      status: 'draft', sessions: previousSessions,
      weekObjectives: [], targetLoadBySport: { squash: 50, strength: 30 },
      validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0, updatedAt: 0,
    } as never,
  }
}

describe('normalización de fuerza heredada', () => {
  it('reemplaza el warning legacy por la taxonomía de normalización', () => {
    const clonedExercises = ['Sentadilla', 'Hip Thrust', 'Peso Muerto', 'Press de Banca', 'Dominadas']
    const context = makeBuildContext(clonedExercises)

    const result = repairGeneratedWeek([
      {
        date: '2026-06-30', timeBlock: 'AM', sessionType: 'strength',
        title: 'Fuerza clon', durationMin: 60, rpe: 6,
        exercises: clonedExercises.map((name) => ({ name, sets: 3, reps: 5, group: 'legs' as never })),
      },
    ] as never, context)

    expect(result.meta.warnings.some((w) => w.code === 'strength_duplicate_exercises_repaired')).toBe(false)
  })

  it('does not regenerate when session has 3 or fewer matches with previous week', () => {
    const prevExercises = ['Sentadilla', 'Hip Thrust', 'Peso Muerto', 'Press de Banca']
    const context = makeBuildContext(prevExercises)

    const result = repairGeneratedWeek([
      {
        date: '2026-06-30', timeBlock: 'AM', sessionType: 'strength',
        title: 'Fuerza parcial', durationMin: 60, rpe: 6,
        exercises: [
          { name: 'Sentadilla', sets: 3, reps: 5, group: 'legs' },      // match
          { name: 'Hip Thrust', sets: 3, reps: 5, group: 'legs' },       // match
          { name: 'Zancadas', sets: 3, reps: 10, group: 'legs' },        // new
          { name: 'Press Hombros', sets: 3, reps: 8, group: 'push' },    // new
        ],
      },
    ] as never, context)

    expect(result.meta.warnings.some((w) => w.code === 'strength_duplicate_exercises_repaired')).toBe(false)
  })

  it('does not run when there is no previous week', () => {
    const context = makeBuildContext([])
    context.previousWeek = undefined

    const result = repairGeneratedWeek([
      {
        date: '2026-06-30', timeBlock: 'AM', sessionType: 'strength',
        title: 'Primera semana', durationMin: 60, rpe: 6,
        exercises: [{ name: 'Sentadilla', sets: 3, reps: 5, group: 'legs' }],
      },
    ] as never, context)

    expect(result.meta.warnings.some((w) => w.code === 'strength_duplicate_exercises_repaired')).toBe(false)
  })
})
