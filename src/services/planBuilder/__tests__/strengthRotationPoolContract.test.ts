import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, CoachSessionProposal, TrainingPlanWeek } from '../../../types'
import { resolveStrengthExercise } from '../../training/exerciseLibrary'
import { INJECTED_CORE_ROTATION } from '../../training/strengthSessionStructure'
import { collectAllStrengthKeys, collectCountableKeys } from '../strengthRoleContract'
import { repairGeneratedWeek, resolveStrengthBlockAllocation, type RepairContext } from '../repairWeek'

/**
 * Contrato de la proyección coordinada bajo concurrencia. La ruta de producción
 * ya no llama al selector escalar: cada worker resuelve la misma matriz y sólo
 * aplica su columna. Por eso este test observa el coordinador puro y sus
 * `slotKey`, no un mock de `selectStrengthReplacement`.
 */

const SIBLING_WEEKS = 3
const EXPECTED_SLOTS = [
  'Peso muerto rumano',
  'Press vertical',
  'Remo con barra',
  'Lanzamiento rotacional con balón medicinal',
]

const PLAN = {
  id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'generating',
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

const WIZARD_CONFIG = {
  goalEventId: 'e1', trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  doubleSessionDays: [], sessionsPerWeek: 5, sessionDurationMins: 60,
  allowDoubleSession: false, complementarySports: ['strength'],
  currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '',
} as never

const WEEK_START_DATES = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']
const SESSION_DATES = ['2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30']

const TEMPLATE_EXERCISES: CoachExerciseProposal[] = [
  { name: 'Sentadilla trasera', sets: 4, reps: 5, group: 'legs' },
  { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' },
  { name: 'Press vertical', sets: 4, reps: 6, group: 'push' },
  { name: 'Remo con barra', sets: 3, reps: 8, group: 'pull' },
  { name: 'Dead bug — control de tronco', sets: 3, reps: 10, group: 'core' },
  { name: 'Lanzamiento rotacional con balón medicinal', sets: 3, reps: 6, group: 'core' },
]

function clonedStrengthTemplate(date: string): CoachSessionProposal {
  return {
    date, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises: TEMPLATE_EXERCISES.map((exercise) => ({ ...exercise })),
  }
}

function pendingWeek(weekIndex: number): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: WEEK_START_DATES[weekIndex]!,
    phase: 'peak', status: 'generating', sessions: [], weekObjectives: [],
    targetLoadBySport: { squash: 50, strength: 30 },
    validationIssues: [], generationMeta: { attempts: 0, provider: 'gemini', model: 'flash' },
    createdAt: 0, updatedAt: 0,
  } as never
}

function makeContext(weekIndex: number): RepairContext {
  return {
    plan: PLAN,
    week: {
      id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: WEEK_START_DATES[weekIndex]!,
      phase: 'peak', status: 'draft', sessions: [], weekObjectives: [],
      targetLoadBySport: { squash: 50, strength: 30 },
      validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0, updatedAt: 0,
    } as never,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: WIZARD_CONFIG,
    previousWeek: weekIndex > 0 ? pendingWeek(weekIndex - 1) : undefined,
    planWeekDescriptors: [
      { weekIndex: 0, phase: 'peak' }, { weekIndex: 1, phase: 'peak' },
      { weekIndex: 2, phase: 'peak' }, { weekIndex: 3, phase: 'peak' },
    ],
  }
}

function allocationAt(weekIndex: number) {
  return resolveStrengthBlockAllocation(
    [clonedStrengthTemplate(SESSION_DATES[weekIndex]!)],
    makeContext(weekIndex),
  )
}

function repairWeekAt(weekIndex: number): CoachSessionProposal[] {
  return repairGeneratedWeek(
    [clonedStrengthTemplate(SESSION_DATES[weekIndex]!)] as never,
    makeContext(weekIndex),
  ).sessions
}

function slotNamesAt(weekIndex: number): string[] {
  const allocation = allocationAt(weekIndex)
  const localKeys = new Set(allocation.matrix[allocation.localWeek]?.keys() ?? [])
  return allocation.snapshot.slots
    .filter((slot) => localKeys.has(slot.slotKey))
    .map((slot) => slot.name)
}

function allIdsOf(sessions: CoachSessionProposal[]): string[] {
  return sessions
    .filter((session) => session.sessionType === 'strength')
    .flatMap((session) => session.exercises ?? [])
    .map((exercise) => resolveStrengthExercise(exercise)?.definition?.id)
    .filter((id): id is string => id != null)
}

describe('contrato del dominio de rotación de fuerza bajo concurrencia', () => {
  it('el fixture resuelve y las cuatro celdas asignables entran a la matriz', () => {
    for (const exercise of TEMPLATE_EXERCISES) {
      expect(resolveStrengthExercise({ name: exercise.name })?.definition, exercise.name).toBeDefined()
    }

    for (let weekIndex = 0; weekIndex < SIBLING_WEEKS; weekIndex++) {
      expect(slotNamesAt(weekIndex).sort()).toEqual([...EXPECTED_SLOTS].sort())
    }
  })

  it('Dead bug se verifica por la proyección estructural, no como slot del allocator', () => {
    const ids = [0, 1, 2, 3].map((weekIndex) =>
      allIdsOf(repairWeekAt(weekIndex)).find((id) => (INJECTED_CORE_ROTATION as readonly string[]).includes(id)),
    )
    expect(ids).toEqual([...INJECTED_CORE_ROTATION])
  })

  it('los agregados por densidad quedan fuera del dominio del allocator', () => {
    const slots = slotNamesAt(2)
    expect(slots).not.toContain('Subida al cajón con salto alternado')
    expect(slots).not.toContain('Dominada')
  })

  it('el solape contable final respeta el umbral en todos los pares', () => {
    const repaired = Array.from({ length: SIBLING_WEEKS }, (_, weekIndex) => repairWeekAt(weekIndex))

    for (let later = 1; later < repaired.length; later++) {
      for (let earlier = 0; earlier < later; earlier++) {
        const earlierKeys = collectAllStrengthKeys(repaired[earlier]! as never)
        const shared = [...collectCountableKeys(repaired[later]! as never)]
          .filter((key) => earlierKeys.has(key))
        expect(shared.length, `${earlier}->${later}: ${JSON.stringify(shared)}`).toBeLessThan(3)
      }
    }
  })
})
