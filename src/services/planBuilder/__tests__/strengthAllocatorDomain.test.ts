import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, CoachSessionProposal, TrainingPlanWeek } from '../../../types'
import { resolveStrengthExercise } from '../../training/exerciseLibrary'
import { collectAllStrengthKeys, collectCountableKeys, isCountableRole } from '../strengthRoleContract'
import { repairGeneratedWeek, resolveStrengthBlockAllocation, type RepairContext } from '../repairWeek'

const WEEK_COUNT = 12
const WEEK_START_DATES = Array.from({ length: WEEK_COUNT }, (_, weekIndex) =>
  new Date(Date.UTC(2026, 5, 1 + weekIndex * 7)).toISOString().slice(0, 10),
)
const SESSION_DATES = Array.from({ length: WEEK_COUNT }, (_, weekIndex) =>
  new Date(Date.UTC(2026, 5, 2 + weekIndex * 7)).toISOString().slice(0, 10),
)

const PLAN = {
  id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'generating',
  title: 'Test', startDate: '2026-06-01', endDate: '2026-08-30', totalWeeks: WEEK_COUNT,
  phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: WEEK_COUNT - 1, blockFocus: 'peak', intentBySport: {} }],
  wizardConfig: {} as never,
  macroSnapshot: {
    goalEventId: 'e1', goalEventDate: '2026-08-30', currentPhase: 'peak', weeksRemaining: WEEK_COUNT,
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

function strengthTemplate(weekIndex: number): CoachSessionProposal {
  return {
    date: SESSION_DATES[weekIndex]!, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises: TEMPLATE.map((exercise) => ({ ...exercise })),
  }
}

function shellWeek(weekIndex: number): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: WEEK_START_DATES[weekIndex]!,
    phase: 'peak', status: 'generating', sessions: [], weekObjectives: [],
    targetLoadBySport: { strength: 30 }, validationIssues: [],
    generationMeta: { attempts: 0, provider: 'gemini', model: 'flash' }, createdAt: 0, updatedAt: 0,
  } as never
}

function readyWeekWithTemplateSignature(templateSignature: string): TrainingPlanWeek {
  return {
    ...shellWeek(0),
    status: 'draft',
    sessions: [{
      ...strengthTemplate(0),
      metadata: { planBuilderStrengthRotation: { blockId: 'peak:0', signature: 'post', templateSignature } },
    }],
  } as never
}

function context(weekIndex: number, previousWeek?: TrainingPlanWeek): RepairContext {
  return {
    plan: PLAN,
    week: {
      ...shellWeek(weekIndex), status: 'draft',
      generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
    } as TrainingPlanWeek,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: WIZARD_CONFIG,
    previousWeek,
    planWeekDescriptors: Array.from({ length: WEEK_COUNT }, (_, index) => ({ weekIndex: index, phase: 'peak' })),
  }
}

function repairWeekAt(weekIndex: number, previousWeek?: TrainingPlanWeek) {
  return repairGeneratedWeek([strengthTemplate(weekIndex)], context(weekIndex, previousWeek))
}

function allIdsOf(sessions: CoachSessionProposal[]): string[] {
  return sessions
    .filter((session) => session.sessionType === 'strength')
    .flatMap((session) => session.exercises ?? [])
    .map((exercise) => resolveStrengthExercise(exercise)?.definition?.id)
    .filter((id): id is string => id != null)
}

function hasWarning(meta: { warnings: Array<{ code: string }> }, code: string): boolean {
  return meta.warnings.some((warning) => warning.code === code)
}

function expectFinalPairBudget(repaired: Array<ReturnType<typeof repairWeekAt>>): void {
  for (let later = 1; later < repaired.length; later++) {
    for (let earlier = 0; earlier < later; earlier++) {
      const earlierKeys = collectAllStrengthKeys(repaired[earlier]!.sessions as never)
      const shared = [...collectCountableKeys(repaired[later]!.sessions as never)]
        .filter((key) => earlierKeys.has(key))
      expect(shared.length, `par final ${earlier}->${later}: ${JSON.stringify(shared)}`).toBeLessThan(3)
    }
  }
}

describe('dominio y firma del allocator de fuerza', () => {
  it('el main lift no recibe asignación pero conserva su identidad y presupuesto', () => {
    const allocation = resolveStrengthBlockAllocation([strengthTemplate(1)], context(1))
    const sessions = repairWeekAt(1).sessions

    expect([...allocation.matrix[1]!.keys()]).not.toContain('0:back_squat:0')
    expect(allIdsOf(sessions).filter((id) => id === 'back_squat')).toEqual(['back_squat'])
  })

  it('un bloque de 12 semanas con pools reales respeta el presupuesto por par en la proyección controlada', () => {
    const allocation = resolveStrengthBlockAllocation([strengthTemplate(0)], context(0))
    const mainLiftIds = allocation.snapshot.slots
      .filter((slot) => !isCountableRole(slot.role))
      .map((slot) => slot.canonicalId ?? `unresolved:${slot.name}`)

    for (let later = 1; later < WEEK_COUNT; later++) {
      for (let earlier = 0; earlier < later; earlier++) {
        const earlierAll = new Set([
          ...mainLiftIds,
          ...(allocation.matrix[earlier]?.values() ?? []),
          ...[...(allocation.structuralCoreByWeek[earlier]?.values() ?? [])].map((core) => core.coreId),
        ])
        const laterCountable = new Set([
          ...(allocation.matrix[later]?.values() ?? []),
          ...[...(allocation.structuralCoreByWeek[later]?.values() ?? [])].map((core) => core.coreId),
        ])
        const shared = [...laterCountable].filter((key) => earlierAll.has(key))
        expect(shared.length, `par ${earlier}->${later}: ${JSON.stringify(shared)}`).toBeLessThan(3)
      }
    }
  })

  it('la densidad sigue siendo best-effort y conserva el mínimo de fuerza en las 12 semanas', () => {
    const sparse = TEMPLATE.slice(0, 2)
    const counts = Array.from({ length: WEEK_COUNT }, (_, weekIndex) => {
      const raw = { ...strengthTemplate(weekIndex), durationMin: 70, exercises: sparse.map((exercise) => ({ ...exercise })) }
      const repaired = repairGeneratedWeek([raw], context(weekIndex)).sessions
      return repaired.find((session) => session.sessionType === 'strength')?.exercises?.length ?? 0
    })

    expect(counts.every((count) => count >= 5), JSON.stringify(counts)).toBe(true)
  })

  it('la densidad no agota el margen I1 en las sesiones finales, incluso con template esparso', () => {
    const complete = Array.from({ length: WEEK_COUNT }, (_, weekIndex) => repairWeekAt(weekIndex))
    expectFinalPairBudget(complete)

    const sparse = TEMPLATE.slice(0, 2)
    const repairedSparse = Array.from({ length: WEEK_COUNT }, (_, weekIndex) =>
      repairGeneratedWeek([
        { ...strengthTemplate(weekIndex), durationMin: 70, exercises: sparse.map((exercise) => ({ ...exercise })) },
      ], context(weekIndex)),
    )
    expectFinalPairBudget(repairedSparse)
    const sparseCounts = repairedSparse.map((result) =>
      result.sessions.find((session) => session.sessionType === 'strength')?.exercises?.length ?? 0,
    )
    expect(sparseCounts.every((count) => count >= 5), JSON.stringify(sparseCounts)).toBe(true)
  })

  it('guarda una firma del template pre-rotación, distinta de la firma posterior', () => {
    const strength = repairWeekAt(1).sessions.find((session) => session.sessionType === 'strength')
    const marker = strength?.metadata?.planBuilderStrengthRotation

    expect(marker?.templateSignature).toBeDefined()
    expect(marker?.templateSignature).not.toBe(marker?.signature)
  })

  it('no emite divergent_template cuando la hermana anterior todavía es shell', () => {
    const meta = repairWeekAt(1, shellWeek(0)).meta

    expect(hasWarning(meta, 'allocator.divergent_template')).toBe(false)
  })

  it('emite divergent_template cuando una hermana lista usó otro template', () => {
    const meta = repairWeekAt(1, readyWeekWithTemplateSignature('firma-distinta')).meta

    expect(hasWarning(meta, 'allocator.divergent_template')).toBe(true)
  })

  it('no emite divergent_template cuando una hermana lista usó el mismo template', () => {
    const expectedSignature = resolveStrengthBlockAllocation([strengthTemplate(1)], context(1)).templateSignature
    const meta = repairWeekAt(1, readyWeekWithTemplateSignature(expectedSignature)).meta

    expect(hasWarning(meta, 'allocator.divergent_template')).toBe(false)
  })
})
