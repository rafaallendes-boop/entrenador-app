import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, WizardFatigueLevel, WizardFitnessLevel } from '../../../types'
import { captureSources } from '../../training/slotContext'
import { buildPlanBuilderStrengthSelectionContext, type RepairContext } from '../repairWeek'
import { buildRepairContextForTest } from './helpers/repairTestFixtures'

const DECLARED_AT = '2026-08-03T12:00:00.000Z'
const session = (date: string) => ({ date, timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza', durationMin: 60 }) as CoachSessionProposal

function contextFor(options: { fitness: WizardFitnessLevel; fatigue: WizardFatigueLevel; age?: number; competitiveLevel?: 'masters'; updatedAt?: string }): RepairContext {
  const base = buildRepairContextForTest({ weekStartDate: '2026-08-03' })
  const profile = {
    ...base.profile,
    age: options.age,
    goalEvents: base.profile.goalEvents?.map((event) => ({ ...event, competitiveLevel: options.competitiveLevel ?? event.competitiveLevel })),
  }
  const wizardConfig = { ...base.wizardConfig, currentFitnessLevel: options.fitness, currentFatigue: options.fatigue, updatedAt: options.updatedAt ?? DECLARED_AT }
  return {
    ...base,
    profile,
    wizardConfig,
    plan: { ...base.plan, wizardConfig },
    sourceCapture: captureSources({ scope: { athleteId: 'athlete-1', epoch: 0, requestId: 'job' }, now: Date.parse(DECLARED_AT), profile, sessions: [], dayLogs: [] }),
  }
}

describe('Plan Builder — campos de atleta desde B1', () => {
  it('nivel competitivo masters ya no implica avanzado (D1)', () => {
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), contextFor({ fitness: 'fit', fatigue: 'normal', competitiveLevel: 'masters' }), []).experienceLevel).toBe('unknown')
  })

  it('loaded vigente → 6; la misma declaración en la semana 2 ya venció (I7)', () => {
    const context = contextFor({ fitness: 'fit', fatigue: 'loaded' })
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), context, []).fatigueLevel).toBe(6)
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-12'), context, []).fatigueLevel).toBe(4)
  })

  it('retorno: 14 días desde la declaración, no por índice de semana (I6)', () => {
    const context = contextFor({ fitness: 'returning', fatigue: 'normal' })
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-16'), context, []).returningFromBreak).toBe(true)
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-17'), context, []).returningFromBreak).toBe(false)
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), context, []).experienceLevel).not.toBe('beginner')
  })

  it('sin updatedAt no hay declaración vigente', () => {
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), contextFor({ fitness: 'returning', fatigue: 'overloaded', updatedAt: '' }), []))
      .toMatchObject({ fatigueLevel: 4, returningFromBreak: false })
  })

  it('edad 41 → recuperación extra; la acumulación intra-semana queda detrás del historial', () => {
    const selection = buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), contextFor({ fitness: 'fit', fatigue: 'normal', age: 41 }), ['intra_week_key'])
    expect(selection.requireExtraRecovery).toBe(true)
    expect(selection.recentExercises.at(-1)).toBe('intra_week_key')
  })
})
