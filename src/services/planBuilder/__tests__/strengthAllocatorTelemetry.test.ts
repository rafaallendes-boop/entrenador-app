import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, CoachSessionProposal, TrainingPlanWeek } from '../../../types'
import { repairGeneratedWeek, type RepairContext } from '../repairWeek'

const PLAN = {
  id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'generating',
  title: 'Test', startDate: '2026-06-01', endDate: '2026-08-30', totalWeeks: 12,
  phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 11, blockFocus: 'peak', intentBySport: {} }],
  wizardConfig: {} as never,
  macroSnapshot: {
    goalEventId: 'e1', goalEventDate: '2026-08-30', currentPhase: 'peak', weeksRemaining: 8,
    blockFocus: 'peak', headline: '', timeline: [], sportDetails: [], secondaryEvents: [], computedAt: 0,
  },
  createdAt: 0, updatedAt: 0,
} as never

const WIZARD_CONFIG = {
  goalEventId: 'e1', trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  doubleSessionDays: [], sessionsPerWeek: 5, sessionDurationMins: 60,
  allowDoubleSession: false, complementarySports: ['strength'],
  currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '',
} as never

const TEMPLATE: CoachExerciseProposal[] = [
  { name: 'Sentadilla trasera', sets: 4, reps: 5, group: 'legs' },
  { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' },
  { name: 'Press vertical', sets: 4, reps: 6, group: 'push' },
  { name: 'Remo con barra', sets: 3, reps: 8, group: 'pull' },
  { name: 'Dead bug — control de tronco', sets: 3, reps: 10, group: 'core' },
  { name: 'Lanzamiento rotacional con balón medicinal', sets: 3, reps: 6, group: 'core' },
]

function strengthTemplate(exercises = TEMPLATE): CoachSessionProposal {
  return {
    date: '2026-06-16', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises: exercises.map((exercise) => ({ ...exercise })),
  }
}

function context(): RepairContext {
  return {
    plan: PLAN,
    week: {
      id: 'w1', planId: 'p1', weekIndex: 1, weekStartDate: '2026-06-15',
      phase: 'peak', status: 'draft', sessions: [], weekObjectives: [],
      targetLoadBySport: { strength: 30 }, validationIssues: [],
      generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' }, createdAt: 0, updatedAt: 0,
    } as TrainingPlanWeek,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: WIZARD_CONFIG,
    planWeekDescriptors: [0, 1, 2, 3].map((weekIndex) => ({ weekIndex, phase: 'peak' })),
  }
}

describe('telemetría local del allocator de fuerza', () => {
  it('cuenta sólo la columna local, no la matriz completa', () => {
    const meta = repairGeneratedWeek([strengthTemplate()], context()).meta

    expect(meta.strengthAllocator).toEqual({
      slotCount: 4,
      assignedCount: 4,
      infeasibleIntraWeekCount: 0,
      insufficientPoolCount: 0,
      unresolvedIdentityCount: 0,
      searchExhaustedCount: 0,
      unmaterializedCount: 0,
    })
  })

  it('cuenta cada causa de degradación por separado', () => {
    const meta = repairGeneratedWeek([
      strengthTemplate([...TEMPLATE, { name: 'Accesorio sin catálogo', sets: 3, reps: 8, group: 'pull' }]),
    ], context()).meta

    expect(meta.strengthAllocator).toMatchObject({
      slotCount: 5,
      assignedCount: 4,
      unresolvedIdentityCount: 1,
      insufficientPoolCount: 0,
      infeasibleIntraWeekCount: 0,
    })
  })

  it('no cuenta la columna 0 como una asignación materializada', () => {
    const base = context()
    const meta = repairGeneratedWeek([strengthTemplate()], {
      ...base,
      week: { ...base.week, weekIndex: 0, weekStartDate: '2026-06-01' },
    }).meta

    expect(meta.strengthAllocator).toMatchObject({
      slotCount: 4,
      assignedCount: 0,
      unmaterializedCount: 0,
    })
  })

  it('strengthAllocator viaja por los mismos call sites que el contador de rotación', () => {
    const files = [
      'src/services/planBuilder/generateWeekCore.ts',
      'src/services/planBuilder/generateWeek.ts',
      'src/services/planBuilder/generatePlan.ts',
      'src/services/planBuilder/asyncGenerationLoop.ts',
    ]
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const rotationLines = source.split('\n')
        .filter((line) => line.includes('strengthAccessoryRotationActionCount')).length
      const allocatorLines = source.split('\n')
        .filter((line) => line.includes('strengthAllocator')).length
      expect(allocatorLines, `${file} olvidó propagar strengthAllocator`).toBe(rotationLines)
    }
  })
})
