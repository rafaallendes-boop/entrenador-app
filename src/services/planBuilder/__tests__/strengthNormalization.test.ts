import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal } from '../../../types'
import type { TrainingPlanWeek } from '../../../types/planBuilder'
import { findStrengthExerciseByName } from '../../training/exerciseLibrary'
import { selectStrengthSession } from '../../training/strengthSelector'
import { repairGeneratedWeek } from '../repairWeek'
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

  it('no toca el main lift ni con una colisión corrective', () => {
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

  it('semana 0 con colisión observada corrige sin contar política', () => {
    const result = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0, previous: readyPrevious() }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount).toBeGreaterThan(0)
    expect(result.meta.strengthAccessoryRotationActionCount).toBeUndefined()
  })

  it('no trata una semana de otro bloque como colisión corrective', () => {
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

  it('no usa shells como contexto corrective', () => {
    const previous = { ...readyPrevious(), status: 'pending' as const }
    const baseline = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0 }))
    const result = repairGeneratedWeek([strengthSession()], contextFor({ weekIndex: 0, previous }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount)
  })

  it('desempata a favor de corrective y cuenta una sesión una vez', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor())
    const result = repairGeneratedWeek([strengthSession()], contextFor({ previous: readyPrevious() }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount + 1)
    expect(result.meta.repairedSessionCount).toBe(baseline.meta.repairedSessionCount + 1)
  })

  it('mide la razón sobre la entrada original', () => {
    const baseline = repairGeneratedWeek([strengthSession()], contextFor())
    const result = repairGeneratedWeek([strengthSession()], contextFor({ previous: readyPrevious() }))
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount)
      .toBe(summarizeTaxonomy(baseline.meta.taxonomy).correctiveActionCount + 1)
    expect(result.meta.strengthAccessoryRotationActionCount ?? 0).toBe(0)
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
      expect(findStrengthExerciseByName(replacement?.name ?? '')?.has1RMReference).toBeUndefined()
      expect(replacement?.targetPercent1RM).toBeUndefined()
    }
  })
})
