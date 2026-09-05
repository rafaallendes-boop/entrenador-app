import { repairGeneratedWeek } from '../../../planBuilder/repairWeek'
import { buildRepairContextForTest, makeProposal } from '../../../planBuilder/__tests__/helpers/repairTestFixtures'
import { hasSquashCompetitiveExposureContent } from '../../../training/squashMatchRole'
import { describe, expect, it } from 'vitest'
import {
  resolveSquashWeeklyExposurePolicy,
  type SquashWeeklyExposureDecision,
} from '../../../planBuilder/squashWeeklyExposurePolicy'

/**
 * Meta declarada de partidos duros (`PlanWizardConfig.targetHardPrimaryMatches`).
 *
 * Adaptado respecto de la primera versión de este archivo (ver Rulings del
 * controlador en el brief de la tarea): `SquashWeeklyExposureDecision` no
 * expone `matchCount` sino `declaredMatchCount` dentro de la rama
 * `ensure: true`, y `SquashWeeklyExposurePolicyInput` exige los campos base
 * completos (`primarySport`, `hasSquashGoalEvent`, `phase`, `currentFatigue`,
 * `hasMedicalRestriction`) más `sessionsPerWeek` opcional.
 */
describe('meta declarada de partidos duros', () => {
  const base = {
    primarySport: 'squash' as const,
    hasSquashGoalEvent: true,
    phase: 'build' as const,
    currentFatigue: 'normal' as const,
    partnerAvailability: 'partner' as const,
    hasMedicalRestriction: false,
  }

  function declaredMatchCountOf(decision: SquashWeeklyExposureDecision): number | undefined {
    return decision.ensure ? decision.declaredMatchCount : undefined
  }

  it('un veto por falta de partner ignora la meta', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      ...base,
      partnerAvailability: 'solo',
      targetHardPrimaryMatches: 3,
    })
    expect(decision.ensure).toBe(false)
    expect(decision).toMatchObject({ reason: 'partner_unavailable' })
  })

  it('un veto médico ignora la meta', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      ...base,
      hasMedicalRestriction: true,
      targetHardPrimaryMatches: 3,
    })
    expect(decision.ensure).toBe(false)
  })

  it('fatiga overloaded ignora la meta', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      ...base,
      currentFatigue: 'overloaded',
      targetHardPrimaryMatches: 3,
    })
    expect(decision.ensure).toBe(false)
  })

  it('sin vetos, la meta eleva el conteo pedido', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      ...base,
      targetHardPrimaryMatches: 2,
    })
    expect(decision.ensure).toBe(true)
    expect(declaredMatchCountOf(decision)).toBe(2)
  })

  it('no aplica en taper', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      ...base,
      phase: 'taper',
      targetHardPrimaryMatches: 3,
    })
    expect(declaredMatchCountOf(decision) ?? 0).toBeLessThan(3)
  })

  it('no aplica en transition', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      ...base,
      phase: 'transition',
      targetHardPrimaryMatches: 3,
    })
    expect(decision.ensure).toBe(false)
  })

  it('se acota a las sesiones semanales disponibles', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      ...base,
      sessionsPerWeek: 2,
      targetHardPrimaryMatches: 9,
    })
    expect(declaredMatchCountOf(decision) ?? 0).toBeLessThanOrEqual(2)
  })

  it('sin meta declarada conserva exactamente el comportamiento actual', () => {
    const withUndefined = resolveSquashWeeklyExposurePolicy({
      ...base,
      targetHardPrimaryMatches: undefined,
    })
    expect(withUndefined).toEqual(resolveSquashWeeklyExposurePolicy(base))
  })
})

describe('meta de partidos en el repair productivo', () => {
  it.each(['build', 'peak'] as const)('materializa dos partidos a RPE 8 en %s', (phase) => {
    const context = buildRepairContextForTest({ phase, sessionsPerWeek: 3 })
    context.wizardConfig.targetHardPrimaryMatches = 2
    context.wizardConfig.partnerAvailability = 'partner'
    context.wizardConfig.currentFatigue = 'normal'
    const raw = ['2026-08-03', '2026-08-05', '2026-08-07'].map((date) =>
      makeProposal({ date, sessionType: 'squash', rpe: 6 }))
    const result = repairGeneratedWeek(raw, context)
    const hardMatches = result.sessions.filter((session) =>
      (session.rpe ?? 6) >= 8 && hasSquashCompetitiveExposureContent(session.squashDetails))
    expect(hardMatches).toHaveLength(2)
    expect(result.sessions).toHaveLength(3)
    expect(new Set(hardMatches.map((session) => session.date)).size).toBe(2)
  })

  it('una meta no fuerza RPE 8 ni varias exposiciones si llega loaded', () => {
    const context = buildRepairContextForTest({ phase: 'build', sessionsPerWeek: 3 })
    context.wizardConfig.targetHardPrimaryMatches = 3
    context.wizardConfig.partnerAvailability = 'partner'
    context.wizardConfig.currentFatigue = 'loaded'
    const result = repairGeneratedWeek(['2026-08-03', '2026-08-05', '2026-08-07'].map((date) =>
      makeProposal({ date, sessionType: 'squash', rpe: 6 })), context)
    expect(result.sessions.some((session) => (session.rpe ?? 6) >= 8)).toBe(false)
    expect(result.sessions.filter((session) => hasSquashCompetitiveExposureContent(session.squashDetails))).toHaveLength(1)
  })
})

it('la ejecución real que exige frenar gana sobre una meta de partidos duros', () => {
  const context = buildRepairContextForTest({ phase: 'build', sessionsPerWeek: 3 })
  context.wizardConfig.targetHardPrimaryMatches = 3
  context.wizardConfig.currentFatigue = 'fresh'
  context.executionSignals = { latestEnergyLevel: 3 }
  const result = repairGeneratedWeek(['2026-08-03', '2026-08-05', '2026-08-07'].map((date) =>
    makeProposal({ date, sessionType: 'squash', rpe: 6 })), context)
  expect(result.sessions.some((session) => (session.rpe ?? 6) >= 8)).toBe(false)
})
