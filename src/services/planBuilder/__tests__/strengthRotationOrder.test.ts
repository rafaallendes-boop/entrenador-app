import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, CoachSessionProposal, TrainingPlanWeek } from '../../../types'
import { resolveStrengthExercise } from '../../training/exerciseLibrary'
import { INJECTED_CORE_ROTATION } from '../../training/strengthSessionStructure'
import { repairGeneratedWeek, resolveStrengthBlockAllocation, type RepairContext } from '../repairWeek'

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

const DATES = ['2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30']

const TEMPLATE: CoachExerciseProposal[] = [
  { name: 'Sentadilla trasera', sets: 4, reps: 5, group: 'legs' },
  { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' },
  { name: 'Press vertical', sets: 4, reps: 6, group: 'push' },
  { name: 'Remo con barra', sets: 3, reps: 8, group: 'pull' },
  { name: 'Dead bug — control de tronco', sets: 3, reps: 10, group: 'core' },
  { name: 'Lanzamiento rotacional con balón medicinal', sets: 3, reps: 6, group: 'core' },
]

function template(date: string, exercises = TEMPLATE): CoachSessionProposal {
  return {
    date, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises: exercises.map((exercise) => ({ ...exercise })),
  }
}

function context(weekIndex: number): RepairContext {
  return {
    plan: PLAN,
    week: {
      id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: DATES[weekIndex]!,
      phase: 'peak', status: 'draft', sessions: [], weekObjectives: [],
      targetLoadBySport: { squash: 50, strength: 30 },
      validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0, updatedAt: 0,
    } as TrainingPlanWeek,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: WIZARD_CONFIG,
    planWeekDescriptors: [0, 1, 2, 3].map((index) => ({ weekIndex: index, phase: 'peak' })),
  }
}

function idOf(exercise: { name: string; libraryRef?: { source: 'strength_exercise'; id: string } }): string | undefined {
  return resolveStrengthExercise(exercise)?.definition?.id
}

function allIds(sessions: CoachSessionProposal[]): string[] {
  return sessions.flatMap((session) => (session.exercises ?? []).map(idOf).filter((id): id is string => id != null))
}

describe('orden congelado de rotación de fuerza', () => {
  it('la resonancia por deriva de posición ya no puede producir el mismo id', () => {
    const weekOne = resolveStrengthBlockAllocation([template(DATES[1]!)], context(1))
    const weekTwo = resolveStrengthBlockAllocation([template(DATES[2]!)], context(2))

    expect(weekOne.matrix[1]?.get('0:overhead_press:0'))
      .not.toBe(weekTwo.matrix[2]?.get('0:overhead_press:0'))
  })

  it('la cascada de exclusiones ya no puede converger', () => {
    const weekOne = resolveStrengthBlockAllocation([template(DATES[1]!)], context(1))
    const weekTwo = resolveStrengthBlockAllocation([template(DATES[2]!)], context(2))

    expect(weekOne.matrix[1]?.get('0:rotational_med_ball_throw:0'))
      .not.toBe(weekTwo.matrix[2]?.get('0:rotational_med_ball_throw:0'))
  })

  it('resuelve el dominio por slot estable y deja fuera main lift/core estructural', () => {
    const allocation = resolveStrengthBlockAllocation([template(DATES[0]!)], context(1))

    expect([...allocation.matrix[1]!.keys()].sort()).toEqual([
      '0:overhead_press:0',
      '0:rotational_med_ball_throw:0',
      '0:romanian_deadlift:0',
      '0:bent_over_row:0',
    ].sort())
    expect(allocation.matrix[1]?.has('0:back_squat:0')).toBe(false)
    expect(allocation.matrix[1]?.has('0:dead_bug:0')).toBe(false)
  })

  it('proyecta el core estructural fuera de la matriz y por la allowlist', () => {
    const ids = [0, 1, 2, 3].map((week) => {
      const sessions = repairGeneratedWeek([template(DATES[week]!)], context(week)).sessions
      return allIds(sessions).find((id) => (INJECTED_CORE_ROTATION as readonly string[]).includes(id))
    })
    expect(ids).toEqual([...INJECTED_CORE_ROTATION])
  })

  it('localiza por identidad tras anteponer un core virtual y ningún mutador pisa una celda asignada', () => {
    const withoutFoundation = TEMPLATE.filter((exercise) => exercise.name !== 'Dead bug — control de tronco')
    const allocation = resolveStrengthBlockAllocation([template(DATES[1]!, withoutFoundation)], context(1))
    const repaired = repairGeneratedWeek([template(DATES[1]!, withoutFoundation)], context(1)).sessions
    const ids = allIds(repaired)
    const romanianAssignment = allocation.matrix[1]?.get('0:romanian_deadlift:0')
    const assignedIds = [...(allocation.matrix[1]?.entries() ?? [])]
      .filter(([slotKey, id]) => id !== allocation.snapshot.slots.find((slot) => slot.slotKey === slotKey)?.canonicalId)
      .map(([, id]) => id)

    expect(ids).toContain('plank')
    expect(ids).toContain('back_squat')
    expect(ids).toContain(romanianAssignment)
    for (const id of assignedIds) expect(ids).toContain(id)
  })
})
