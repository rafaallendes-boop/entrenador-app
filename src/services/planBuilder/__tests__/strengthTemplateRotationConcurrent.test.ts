import { describe, it, expect } from 'vitest'
import { repairGeneratedWeek } from '../repairWeek'
import type { RepairContext } from '../repairWeek'
import type { CoachExerciseProposal, CoachSessionProposal, TrainingPlanWeek } from '../../../types'
import { collectAllStrengthKeys, collectCountableKeys } from '../strengthRoleContract'

/**
 * Hallazgo 5 de la QA deportiva del 2026-08-13: dos semanas del mismo bloque de
 * peak compartieron 5 de 8-9 ejercicios y `quality.strength.repeated_template`
 * solo lo reportó.
 *
 * Reproduce la condición real de generación: con `DEFAULT_CONCURRENCY = 3` las
 * semanas de un bloque se reparan en paralelo, así que la anterior todavía no
 * es `isReadyWeek` cuando la siguiente se normaliza. El modelo, además, tiende a
 * devolver la misma plantilla de fuerza para todas las semanas del bloque.
 */

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

/** La plantilla clonada que el modelo devolvió en el arquetipo 1. */
function clonedStrengthTemplate(date: string): CoachSessionProposal {
  const exercises: CoachExerciseProposal[] = [
    { name: 'Sentadilla trasera', sets: 4, reps: 5, group: 'legs' },
    { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' },
    { name: 'Press vertical', sets: 4, reps: 6, group: 'push' },
    { name: 'Remo con barra', sets: 3, reps: 8, group: 'pull' },
    { name: 'Dead bug — control de tronco', sets: 3, reps: 10, group: 'core' },
    { name: 'Lanzamiento rotacional', sets: 3, reps: 6, group: 'core' },
  ]
  return {
    date, timeBlock: 'AM', sessionType: 'strength',
    title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises,
  }
}

/**
 * Semana anterior tal como la ve un worker concurrente: la fila existe pero
 * todavía no tiene sesiones, así que `isReadyWeek` es false.
 */
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
      { weekIndex: 0, phase: 'peak' },
      { weekIndex: 1, phase: 'peak' },
      { weekIndex: 2, phase: 'peak' },
      { weekIndex: 3, phase: 'peak' },
    ],
  }
}

function repairWeekAt(weekIndex: number): CoachSessionProposal[] {
  return repairGeneratedWeek(
    [clonedStrengthTemplate(SESSION_DATES[weekIndex]!)] as never,
    makeContext(weekIndex),
  ).sessions
}

describe('rotación de fuerza entre semanas reparadas en paralelo', () => {
  it('no deja 3+ accesorios contables compartidos entre semanas del mismo bloque', () => {
    const repaired = [0, 1, 2].map(repairWeekAt)

    // Mismo predicado que `quality.strength.repeated_template`: los contables de
    // la semana posterior contra todos los ejercicios de fuerza de la anterior.
    const overlaps: Array<{ pair: string; shared: string[] }> = []
    for (let later = 1; later < repaired.length; later++) {
      for (let earlier = 0; earlier < later; earlier++) {
        const earlierKeys = collectAllStrengthKeys(repaired[earlier]! as never)
        const shared = [...collectCountableKeys(repaired[later]! as never)]
          .filter((key) => earlierKeys.has(key))
        overlaps.push({ pair: `${earlier}->${later}`, shared })
      }
    }

    const offending = overlaps.filter((entry) => entry.shared.length >= 3)
    expect(offending).toEqual([])
  })

  it('propaga el índice del bloque al primer enriquecimiento y rota el core inyectado', () => {
    const withoutCore = (date: string): CoachSessionProposal => ({
      ...clonedStrengthTemplate(date),
      exercises: [
        ...(clonedStrengthTemplate(date).exercises?.filter((exercise) => exercise.group !== 'core') ?? []),
        { name: 'Sentadilla frontal', sets: 3, reps: 8, group: 'legs' },
        { name: 'Press banca', sets: 3, reps: 8, group: 'push' },
        { name: 'Dominada', sets: 3, reps: 8, group: 'pull' },
      ],
    })

    const selectedIds = ['dead_bug', 'plank', 'side_plank', 'stability_ball_front_plank']
    const injectedCoreOccurrences = [0, 1, 2, 3].map((weekIndex) => {
      const repaired = repairGeneratedWeek(
        [withoutCore(SESSION_DATES[weekIndex]!)] as never,
        makeContext(weekIndex),
      ).sessions
      return repaired[0]?.exercises?.filter(
        (exercise) => exercise.libraryRef?.id === selectedIds[weekIndex],
      ).length
    })

    expect(injectedCoreOccurrences).toEqual([1, 1, 1, 1])
  })
})
