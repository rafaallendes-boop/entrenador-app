import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal } from '../../../types'
import type { TrainingPlanWeek } from '../../../types/planBuilder'
import { findStrengthExerciseByName } from '../../training/exerciseLibrary'
import { selectStrengthSession } from '../../training/strengthSelector'
import { repairGeneratedWeek, resolveStrengthBlockAllocation } from '../repairWeek'
import { summarizeTaxonomy } from '../repairTaxonomy'
import { resolveSessionStrengthRoles } from '../strengthRoleContract'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

const SELECTED_EXERCISES = selectStrengthSession({
  fatigueLevel: 2,
  phase: 'base',
  recentExercises: [],
  goal: 'fuerza',
  sportProfile: 'strength_primary',
  primarySport: 'strength',
  experienceLevel: 'advanced',
  sessionDurationMin: 45,
  weekIndexInBlock: 1,
}).exercises
const NAMES = SELECTED_EXERCISES.map((exercise) => exercise.name)

function strengthSession(date = '2026-08-03', names = NAMES): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    sessionType: 'strength',
    title: 'Fuerza',
    durationMin: 45,
    rpe: 5,
    exercises: names.map((name) => {
      const selected = SELECTED_EXERCISES.find((exercise) => exercise.name === name)
      return selected
        ? {
            name,
            sets: selected.sets,
            reps: selected.reps,
            group: selected.group,
            notes: selected.notes,
            targetPercent1RM: selected.targetPercent1RM,
            targetRpe: selected.targetRpe,
          }
        : { name, sets: 3, reps: '8' }
    }),
  })
}

function contextFor(options: {
  weekIndex?: number
  previous?: TrainingPlanWeek
  descriptors?: Array<{ weekIndex: number; phase: string }>
} = {}) {
  const context = buildRepairContextForTest({ sessionsPerWeek: 1, primarySport: 'strength' })
  const weekIndex = options.weekIndex ?? 1
  context.plan = {
    ...context.plan,
    totalWeeks: 2,
    phases: [{ phase: 'base', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
  }
  context.week = { ...context.week, weekIndex, phase: 'base', status: 'draft' }
  context.previousWeek = options.previous
  context.planWeekDescriptors = options.descriptors ?? [
    { weekIndex: 0, phase: 'base' },
    { weekIndex: 1, phase: 'base' },
  ]
  return context
}

function readyPrevious(names = NAMES, weekIndex = 0, phase: TrainingPlanWeek['phase'] = 'base'): TrainingPlanWeek {
  return {
    ...contextFor().week,
    id: `previous-${weekIndex}`,
    weekIndex,
    phase,
    status: 'draft',
    sessions: [strengthSession('2026-07-27', names)],
  }
}

describe('normalización única de fuerza', () => {
  it('ancla los slots al date|timeBlock cuando el balance elimina sesiones del template', () => {
    const context = buildRepairContextForTest({
      primarySport: 'squash',
      phase: 'peak',
      sessionsPerWeek: 2,
      targetLoadBySport: { squash: 60, strength: 30 },
    })
    context.wizardConfig.complementarySports = ['strength']
    context.plan = {
      ...context.plan,
      totalWeeks: 2,
      endDate: '2026-08-16',
      wizardConfig: context.wizardConfig,
      phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    }
    context.week = {
      ...context.week,
      weekIndex: 1,
      weekStartDate: '2026-08-10',
      phase: 'peak',
      targetLoadBySport: { squash: 60, strength: 30 },
    }
    context.planWeekDescriptors = [
      { weekIndex: 0, phase: 'peak' },
      { weekIndex: 1, phase: 'peak' },
    ]

    const result = repairGeneratedWeek([
      strengthSession('2026-08-10'),
      strengthSession('2026-08-11'),
      buildSkeletonSessionForTest({
        date: '2026-08-12', sessionType: 'squash', title: 'Squash', durationMin: 45,
      }),
    ], context)

    // En peak el balance conserva squash y una fuerza, después la dominancia
    // convierte la fuerza restante. Antes el ordinal congelado lanzaba aquí.
    expect(result.sessions.some((session) => session.sessionType === 'strength')).toBe(false)
    expect(result.meta.strengthAllocator?.unmaterializedCount).toBeGreaterThan(0)
  })

  it('materializa cada ocurrencia duplicada antes de mutar la primera', () => {
    const raw = strengthSession('2026-08-03', [
      'Sentadilla trasera',
      'Remo con barra',
      'Remo con barra',
      'Press vertical',
      'Dead bug — control de tronco',
    ])
    const context = contextFor({ weekIndex: 1 })
    const allocation = resolveStrengthBlockAllocation([raw], context)
    const duplicatedSlots = allocation.snapshot.slots.filter((slot) => slot.canonicalId === 'bent_over_row')
    const assignedIds = duplicatedSlots.map((slot) => allocation.matrix[1]?.get(slot.slotKey))

    const result = repairGeneratedWeek([raw], context)
    const ids = result.sessions[0]?.exercises
      ?.map((exercise) => findStrengthExerciseByName(exercise.name)?.id)
      .filter((id): id is string => id != null) ?? []

    expect(duplicatedSlots).toHaveLength(2)
    expect(new Set(assignedIds).size).toBe(2)
    for (const id of assignedIds) expect(ids).toContain(id)
    expect(result.meta.strengthAllocator).toMatchObject({
      assignedCount: allocation.matrix[1]?.size,
      unmaterializedCount: 0,
    })
  })

  it('conserva el main lift programado cuando otro lift del mismo bloque ordena antes alfabéticamente', () => {
    const programmedMainLift = 'Sentadilla trasera con barra'
    const result = repairGeneratedWeek([
      strengthSession('2026-08-03', [
        programmedMainLift,
        'Empuje de cadera',
        'Remo inclinado',
      ]),
    ], contextFor({ weekIndex: 1 }))
    const exercises = result.sessions[0]?.exercises ?? []
    const mainLiftIndex = resolveSessionStrengthRoles(exercises).indexOf('main_lift')

    expect(exercises[mainLiftIndex]?.name).toBe(programmedMainLift)
  })

  it('no depende de una semana anterior lista para conservar el main lift', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    const result = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0, previous: readyPrevious() }))
    const getMainLift = (session: CoachSessionProposal | undefined) => {
      const exercises = session?.exercises ?? []
      const mainLiftIndex = resolveSessionStrengthRoles(exercises).indexOf('main_lift')
      return exercises[mainLiftIndex]?.name
    }
    expect(getMainLift(result.sessions[0])).toBe(getMainLift(baseline.sessions[0]))
  })

  it('no reconstruye la sesión completa', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    const result = repairGeneratedWeek([strengthSession()], contextFor())
    expect(result.sessions[0]?.exercises).toHaveLength(baseline.sessions[0]?.exercises?.length ?? 0)
  })

  it('semana 0 sin colisión deja política no aplicable', () => {
    const result = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    expect(result.meta.strengthAccessoryRotationActionCount).toBeUndefined()
    expect(result.meta.strengthAccessoryRotationSessionsAffected).toBeUndefined()
  })

  it('la columna 0 no reabre una corrección desde la semana anterior', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    const result = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0, previous: readyPrevious() }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount)
    expect(result.meta.strengthAccessoryRotationActionCount).toBeUndefined()
  })

  it('no deriva decisiones de una semana anterior de otro bloque', () => {
    const previous = readyPrevious(NAMES, 2, 'peak')
    const baseline = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    const result = repairGeneratedWeek([strengthSession()], contextFor({
      weekIndex: 0,
      previous,
      descriptors: [{ weekIndex: 0, phase: 'base' }, { weekIndex: 2, phase: 'peak' }],
    }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount)
  })

  it('no usa shells como contexto de asignación', () => {
    const previous = { ...readyPrevious(), status: 'pending' as const }
    const baseline = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    const result = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0, previous }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount)
  })

  it('la matriz reemplaza el desempate corrective y no duplica reparaciones', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor())
    const result = repairGeneratedWeek([strengthSession()], contextFor({ previous: readyPrevious() }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount)
    expect(result.meta.repairedSessionCount).toBe(baseline.meta.repairedSessionCount)
  })

  it('la política no depende de observar la sesión anterior', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor())
    const result = repairGeneratedWeek([strengthSession()], contextFor({ previous: readyPrevious() }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount)
    expect(result.meta.strengthAccessoryRotationActionCount)
      .toBe(baseline.meta.strengthAccessoryRotationActionCount)
  })

  it('cuenta política por ejercicio y sesiones afectadas por sesión', () => {
    const result = repairGeneratedWeek([strengthSession()], contextFor())
    expect(result.meta.strengthAccessoryRotationActionCount).toBeGreaterThanOrEqual(0)
    expect(result.meta.strengthAccessoryRotationSessionsAffected).toBeGreaterThanOrEqual(0)
    expect(result.meta.strengthAccessoryRotationSessionsAffected).toBeLessThanOrEqual(1)
  })

  it('es idempotente en la segunda ejecución', () => {
    const context = contextFor()
    const first = repairGeneratedWeek([strengthSession()], context)
    const second = repairGeneratedWeek(first.sessions, context)
    expect(second.sessions.map((session) => session.exercises?.map((exercise) => exercise.name)))
      .toEqual(first.sessions.map((session) => session.exercises?.map((exercise) => exercise.name)))
    expect(second.meta.strengthAccessoryRotationActionCount).toBe(0)
  })

  it('la política no infla countRepairsV2', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    const result = repairGeneratedWeek([strengthSession()], contextFor())
    const summary = summarizeTaxonomy(result.meta.taxonomy)
    const baselineSummary = summarizeTaxonomy(baseline.meta.taxonomy)
    expect(summary).toEqual(baselineSummary)
  })

  it('no hereda el targetPercent1RM de un reemplazado', () => {
    const original = strengthSession()
    original.exercises![1]!.targetPercent1RM = 80
    const result = repairGeneratedWeek([original], contextFor())
    const replacement = result.sessions[0]?.exercises?.[1]
    if (replacement?.name !== NAMES[1]) {
      expect(findStrengthExerciseByName(replacement?.name ?? '')?.loadReference?.selectorEligible).not.toBe(true)
      expect(replacement?.targetPercent1RM).toBeUndefined()
    }
  })
})
