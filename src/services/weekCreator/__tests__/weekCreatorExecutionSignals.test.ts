import { describe, expect, it } from 'vitest'
import type { AthleteProfile, ChatContext, DayLog, PlanWizardConfig, Session } from '../../../types'
import { applyDeclarationValidityToConfig, type WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'
import { resolveWeekCreatorStrengthSources } from '../weekCreatorExecutionSignals'

const NOW = new Date(2026, 8, 16, 10, 0).getTime()
function profile(wizard: Partial<PlanWizardConfig> | undefined): AthleteProfile {
  return { id: 'a', updatedAt: 0, ...(wizard ? { planWizardConfig: wizard as PlanWizardConfig } : {}) }
}
function context(sessions: Session[], logs: DayLog[], athleteProfile?: AthleteProfile): ChatContext {
  return { recentSessions: [], plannedSessions: [], historicalSessions: sessions, weekDayLogs: logs, athleteProfile }
}
function squash(id: string, date: string, actualRpe?: number): Session {
  return { id, date, weekStartDate: date, timeBlock: 'AM', type: 'squash', status: 'completed', title: id, durationMin: 60, actualRpe, createdAt: 0, updatedAt: 0 } as Session
}

describe('resolveWeekCreatorStrengthSources', () => {
  it('dolor y fatiga declarada vigente resuelven reduce una sola vez', () => {
    const sources = resolveWeekCreatorStrengthSources(
      context([], [{ id: 'l', date: '2026-09-15', painLevel: 8, updatedAt: 0 }], profile({ currentFatigue: 'normal', updatedAt: '2026-09-15T12:00:00.000Z' })),
      '2026-09-21', NOW,
    )
    expect(sources.executionSignals).toMatchObject({ declaredFatigue: 'normal', latestPainLevel: 8 })
    expect(sources.loadDecision.verdict).toBe('reduce')
  })

  it('una declaración vencida no llega a las señales (I7)', () => {
    const sources = resolveWeekCreatorStrengthSources(
      context([], [], profile({ currentFatigue: 'overloaded', updatedAt: '2026-09-01T12:00:00.000Z' })), '2026-09-21', NOW,
    )
    expect(sources.executionSignals.declaredFatigue).toBeUndefined()
    expect(sources.loadDecision.verdict).not.toBe('reduce')
  })

  it('RPE fuera de la ventana no cuenta (I9)', () => {
    const sources = resolveWeekCreatorStrengthSources(context([squash('old', '2026-09-01', 9), squash('in', '2026-09-15', 6)], []), '2026-09-21', NOW)
    expect(sources.executionSignals).toMatchObject({ rpeSampleCount: 1, avgActualRpe: 6 })
  })

  it('reutiliza la captura del contexto (una captura por operación)', () => {
    const shared = context([], [])
    expect(resolveWeekCreatorStrengthSources(shared, '2026-09-21', NOW + 5).capture)
      .toBe(resolveWeekCreatorStrengthSources(shared, '2026-09-21', NOW).capture)
  })
})

describe('applyDeclarationValidityToConfig', () => {
  const config = { currentFatigue: 'loaded', currentFitnessLevel: 'returning' } as WeekCreatorEffectiveConfig

  it('conserva lo declarado mientras está vigente', () => {
    const result = applyDeclarationValidityToConfig(config, profile({ currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-15T12:00:00.000Z' }), '2026-09-17')
    expect(result).toMatchObject({ currentFatigue: 'loaded', currentFitnessLevel: 'returning' })
  })

  it('vencido vuelve al default del Week Creator', () => {
    const result = applyDeclarationValidityToConfig(config, profile({ currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-08-01T12:00:00.000Z' }), '2026-09-17')
    expect(result).toMatchObject({ currentFatigue: 'normal', currentFitnessLevel: 'normal' })
  })
})
