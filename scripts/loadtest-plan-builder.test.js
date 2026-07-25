import { describe, expect, it } from 'vitest'

import {
  ATTEMPTED_PLAN_TOTAL,
  MANIFEST_VERSION,
  SCENARIOS,
  TARGET_WEEK_TOTAL,
  buildManifest,
  buildPlanFixture,
} from './loadtest-plan-builder/manifest.mjs'

describe('loadtest manifest', () => {
  it('freezes six scenarios and twelve cases', () => {
    expect(Object.keys(SCENARIOS)).toEqual([
      'squash_build',
      'squash_taper_medico',
      'running',
      'ciclismo',
      'dobles',
      'semana_parcial',
    ])
    const manifest = buildManifest()
    expect(manifest).toHaveLength(ATTEMPTED_PLAN_TOTAL)
    expect(ATTEMPTED_PLAN_TOTAL).toBe(12)
  })

  it('totals the frozen 42 target weeks', () => {
    const total = buildManifest().reduce((sum, item) => sum + item.weekCount, 0)
    expect(total).toBe(TARGET_WEEK_TOTAL)
    expect(TARGET_WEEK_TOTAL).toBe(42)
  })

  it('runs two plans per scenario in a stable order', () => {
    const manifest = buildManifest()
    expect(manifest.map((item) => item.caseId)).toEqual([
      'squash_build#1', 'squash_build#2',
      'squash_taper_medico#1', 'squash_taper_medico#2',
      'running#1', 'running#2',
      'ciclismo#1', 'ciclismo#2',
      'dobles#1', 'dobles#2',
      'semana_parcial#1', 'semana_parcial#2',
    ])
    expect(buildManifest().map((item) => item.caseId)).toEqual(manifest.map((item) => item.caseId))
  })

  it('builds deterministic fixtures with frozen dates', () => {
    const [first] = buildManifest()
    const a = buildPlanFixture(first)
    const b = buildPlanFixture(first)
    expect(a.plan.startDate).toBe(b.plan.startDate)
    expect(a.weeks).toHaveLength(first.weekCount)
    expect(a.weeks.map((week) => week.weekStartDate)).toEqual(b.weeks.map((week) => week.weekStartDate))
    expect(a.plan.id).not.toBe('')
  })

  it('exposes the manifest version so artifacts stay comparable', () => {
    expect(MANIFEST_VERSION).toBe(1)
  })

  it('starts every week on a Monday even when the plan starts mid-week', () => {
    for (const manifestCase of buildManifest()) {
      const { weeks } = buildPlanFixture(manifestCase)
      for (const week of weeks) {
        expect(new Date(`${week.weekStartDate}T00:00:00.000Z`).getUTCDay()).toBe(1)
      }
    }
  })

  it('keeps the partial-week scenario starting mid-week on a Monday-anchored week', () => {
    const partial = buildManifest().find((item) => item.scenarioKey === 'semana_parcial')
    const { plan, weeks } = buildPlanFixture(partial)
    // startDate es miércoles: la primera semana es parcial de verdad.
    expect(new Date(`${plan.startDate}T00:00:00.000Z`).getUTCDay()).toBe(3)
    expect(weeks[0].weekStartDate).toBe('2026-09-07')
  })

  it('only uses wizard enum values the engine understands', () => {
    const fitness = new Set(['fit', 'normal', 'returning', 'low'])
    const fatigue = new Set(['fresh', 'normal', 'loaded', 'overloaded'])
    for (const scenario of Object.values(SCENARIOS)) {
      const wizardConfig = scenario.buildWizardConfig()
      expect(fitness.has(wizardConfig.currentFitnessLevel)).toBe(true)
      expect(fatigue.has(wizardConfig.currentFatigue)).toBe(true)
    }
  })

  it('puts injury notes where the engine reads them', () => {
    const taper = SCENARIOS.squash_taper_medico
    expect(taper.buildWizardConfig().injuryNotes).toMatch(/rodilla/)
    expect(taper.buildProfile().injuryNotes).toBeUndefined()
  })

  it('allows each scenario primary sport through getAllowedSports', () => {
    // allowed = macroSnapshot.sportDetails ∪ complementarySports ∪ {mobility, recovery, nutrition}
    for (const manifestCase of buildManifest()) {
      const { plan, wizardConfig } = buildPlanFixture(manifestCase)
      const allowed = new Set([
        ...plan.macroSnapshot.sportDetails.map((detail) => detail.sport),
        ...wizardConfig.complementarySports,
        'mobility', 'recovery', 'nutrition',
      ])
      expect(allowed.has(SCENARIOS[manifestCase.scenarioKey].primarySport)).toBe(true)
    }
  })

  it('keeps every scenario reproducible from the wizard UI', () => {
    // La UI ofrece complementarios = enabledSports menos el primario, y el
    // motor deriva los permitidos de sportDetails ∪ complementarySports. Si
    // divergen, el control mide una configuración que ningún usuario puede
    // producir.
    for (const scenario of Object.values(SCENARIOS)) {
      const enabled = new Set(scenario.buildProfile().sportContext.enabledSports)
      const wizardConfig = scenario.buildWizardConfig()
      expect(enabled.has(scenario.primarySport)).toBe(true)
      for (const sport of wizardConfig.complementarySports) {
        expect(enabled.has(sport)).toBe(true)
        expect(sport).not.toBe(scenario.primarySport)
      }
      for (const detail of scenario.sportDetails) {
        expect(enabled.has(detail.sport)).toBe(true)
      }
      for (const sport of Object.keys(scenario.targetLoadBySport)) {
        expect(enabled.has(sport)).toBe(true)
      }
    }
  })

  it('keeps the goal event coherent across every fixture input', () => {
    for (const manifestCase of buildManifest()) {
      const { plan, profile, wizardConfig } = buildPlanFixture(manifestCase)
      const scenario = SCENARIOS[manifestCase.scenarioKey]
      const matchingEvents = profile.goalEvents?.filter(
        (event) => event.id === wizardConfig.goalEventId,
      )

      expect(plan.goalEventId).toBe(wizardConfig.goalEventId)
      expect(plan.macroSnapshot.goalEventId).toBe(wizardConfig.goalEventId)
      expect(matchingEvents).toHaveLength(1)
      expect(matchingEvents[0]).toMatchObject({
        id: wizardConfig.goalEventId,
        sport: scenario.primarySport,
        date: plan.endDate,
      })
      expect(plan.macroSnapshot.goalEventDate).toBe(plan.endDate)
    }
  })

  it('gives the taper scenario real taper and race phases', () => {
    const taper = buildManifest().find((item) => item.scenarioKey === 'squash_taper_medico')
    const { plan, weeks } = buildPlanFixture(taper)
    const phases = weeks.map((week) => week.phase)
    expect(phases).toContain('taper')
    expect(phases[phases.length - 1]).toBe('race')
    expect(plan.phases.map((phase) => phase.phase)).toEqual(phases)
  })
})
