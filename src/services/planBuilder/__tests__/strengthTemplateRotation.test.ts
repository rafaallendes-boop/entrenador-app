import { describe, it, expect } from 'vitest'
import { repairGeneratedWeek } from '../repairWeek'
import type { RepairContext } from '../repairWeek'
import type { CoachExerciseProposal, CoachSessionProposal } from '../../../types'

// Mirrors qualityReview.normalizeExerciseName so the assertion matches the rule
// that emits `quality.strength.repeated_template`.
function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function strengthKeys(sessions: CoachSessionProposal[]): Set<string> {
  return new Set(
    sessions
      .filter((s) => s.sessionType === 'strength')
      .flatMap((s) => s.exercises ?? [])
      .map((e) => normalizeExerciseName(e.name))
      .filter(Boolean),
  )
}

function makePeakContext(previousExercises: string[]): RepairContext {
  const previousSessions: CoachSessionProposal[] = previousExercises.length > 0 ? [
    {
      date: '2026-06-22', timeBlock: 'AM', sessionType: 'strength',
      title: 'Fuerza semana anterior', durationMin: 60, rpe: 6,
      exercises: previousExercises.map((name) => ({ name, sets: 3, reps: 5, group: 'legs' as never })),
    },
  ] : []

  const plan = {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-08-30', totalWeeks: 12,
    phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 11, blockFocus: 'peak', intentBySport: {} }],
    wizardConfig: {} as never,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-08-30', currentPhase: 'peak', weeksRemaining: 8,
      blockFocus: 'peak', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'reduce', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as never

  return {
    plan,
    week: {
      id: 'w4', planId: 'p1', weekIndex: 4, weekStartDate: '2026-06-29', phase: 'peak',
      status: 'draft', sessions: [], weekObjectives: [],
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
      id: 'w3', planId: 'p1', weekIndex: 3, weekStartDate: '2026-06-22', phase: 'peak',
      status: 'draft', sessions: previousSessions,
      weekObjectives: [], targetLoadBySport: { squash: 50, strength: 30 },
      validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0, updatedAt: 0,
    } as never,
    planWeekDescriptors: [
      { weekIndex: 3, phase: 'peak' },
      { weekIndex: 4, phase: 'peak' },
    ],
  }
}

describe('strength template rotation across consecutive weeks', () => {
  it('keeps consecutive strength weeks from sharing 3+ exercises', () => {
    const previousExercises = ['Sentadilla', 'Press de Banca', 'Peso Muerto']
    const context = makePeakContext(previousExercises)

    const currentExercises: CoachExerciseProposal[] = [
      { name: 'Sentadilla', sets: 4, reps: 5, group: 'legs' },       // shared
      { name: 'Press de Banca', sets: 4, reps: 5, group: 'push' },   // shared
      { name: 'Peso Muerto', sets: 3, reps: 5, group: 'legs' },      // shared
      { name: 'Zancadas con Mancuernas', sets: 3, reps: 10, group: 'legs' },
      { name: 'Press Militar', sets: 3, reps: 8, group: 'push' },
      { name: 'Remo con Barra', sets: 3, reps: 8, group: 'pull' },
    ]

    const result = repairGeneratedWeek([
      {
        date: '2026-06-30', timeBlock: 'AM', sessionType: 'strength',
        title: 'Fuerza clon parcial', durationMin: 60, rpe: 6,
        exercises: currentExercises,
      },
    ] as never, context)

    const previousKeys = strengthKeys(context.previousWeek!.sessions)
    const currentKeys = strengthKeys(result.sessions)
    const overlap = [...currentKeys].filter((key) => previousKeys.has(key)).length
    expect(overlap).toBeLessThan(3)
  })
})
