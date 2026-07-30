import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ATTEMPTED_PLAN_TOTAL,
  MANIFEST_VERSION,
  SCENARIOS,
  TARGET_WEEK_TOTAL,
  buildManifest,
  buildPlanFixture,
  describeManifest,
} from './loadtest-plan-builder/manifest.mjs'
import {
  percentile,
  summarizeDistribution,
  summarizeLatency,
} from './loadtest-plan-builder/stats.mjs'
import {
  buildComparison,
  pairPlans,
  pairWeeks,
  renderComparison,
} from './loadtest-plan-builder/compare.mjs'
import {
  ARTIFACT_SCHEMA_VERSION,
  buildArtifact,
  evaluateAcceptance,
  isCompletePlan,
  toPlanRow,
  toWeekRow,
} from './loadtest-plan-builder/artifact.mjs'
import { buildReport, renderReport } from './loadtest-plan-builder/report.mjs'
import {
  createDetectionPoller,
  createMemoryWriter,
  instrumentCallLLM,
  loadRuntime,
} from './loadtest-plan-builder/runtime.mjs'
import {
  assertRunGuards,
  buildWeekRows,
  classifyError,
  defaultArtifactPath,
  hasFallbackUsed,
  installGracefulSignalHandlers,
  mergeGitState,
  parseArgs,
  runCase,
  runPaid,
  writeArtifactAtomic,
} from './loadtest-plan-builder.mjs'

/** Construye filas que corresponden 1:1 con el manifest congelado. */
function planRowsFromManifest(overrides = () => ({})) {
  return buildManifest().map((manifestCase, index) => ({
    caseId: manifestCase.caseId,
    scenarioKey: manifestCase.scenarioKey,
    weekCount: manifestCase.weekCount,
    outcome: 'succeeded',
    weekCountSucceeded: manifestCase.weekCount,
    weekCountFailed: 0,
    firstWeekReadyMs: 1000,
    firstWeekReadyE2eMs: 1200,
    firstWeekDetectedMs: 4000,
    firstWeekDetectionLagMs: 3000,
    planCompleteMs: 8000,
    terminalMs: 9000,
    weeks: Array.from({ length: manifestCase.weekCount }, (_, weekIndex) => ({
      weekIndex,
      scenarioKey: manifestCase.scenarioKey,
      status: 'draft',
      scorable: true,
      repairTaxonomyVersion: 2,
      sessionCount: 1,
      countRepairsV2: 2,
      correctiveActionCount: 1,
      structuralActionCount: 1,
    })),
    ...overrides(manifestCase, index),
  }))
}

function artifactFrom(plans) {
  return buildArtifact({
    plans,
    variant: { provider: 'claude', model: 'm', qualityVersion: 1, variantId: 'v' },
    git: { sha: 'abc', dirty: false },
  })
}

function artifactWith(plans) {
  return { artifactSchemaVersion: 1, plans }
}

function planWith(caseId, scenarioKey, weeks) {
  return { caseId, scenarioKey, weeks }
}

// `isCompletePlan` exige, vía `isReadyWeekRow`, que `sessionCount` sea un
// número finito > 0, y vía `inspectWeekIndexes` que los índices sean
// exactamente 0..weekCount-1. Sin `sessionCount` el plan no cuenta como
// completo y los tests fallarían por la razón equivocada.
function completePlan(caseId, scenarioKey, over = {}) {
  const weeks = (over.weeks ?? [0, 1]).map((weekIndex) => ({
    weekIndex,
    status: 'draft',
    scorable: true,
    sessionCount: 4,
    repairTaxonomyVersion: 2,
    countRepairsV2: 0,
    correctiveActionCount: 0,
    structuralActionCount: 0,
    ...(over.weekOverrides ?? {}),
  }))
  return {
    caseId,
    scenarioKey,
    outcome: 'succeeded',
    weekCount: weeks.length,
    weekCountSucceeded: weeks.length,
    weekCountFailed: 0,
    firstWeekReadyMs: over.firstWeekReadyMs ?? 1000,
    firstWeekReadyE2eMs: over.firstWeekReadyE2eMs ?? 1200,
    planCompleteMs: over.planCompleteMs ?? 2000,
    planScore: over.planScore ?? 90,
    planGrade: over.planGrade ?? 'good',
    issueCodes: over.issueCodes ?? [],
    totalInputTokens: over.totalInputTokens ?? 1000,
    totalOutputTokens: over.totalOutputTokens ?? 500,
    estimatedCostUsd: over.estimatedCostUsd ?? 0.05,
    retryCount: over.retryCount ?? 0,
    observedModels: over.observedModels ?? ['claude-sonnet-4-6'],
    fallbackUsed: over.fallbackUsed ?? false,
    errorClass: over.errorClass ?? null,
    weeks,
  }
}

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

  it('groups the four synthetic build weeks into one real phase block', () => {
    const manifestCase = buildManifest().find((item) => item.scenarioKey === 'squash_build')
    const { plan } = buildPlanFixture(manifestCase)
    expect(plan.phases).toEqual([{
      phase: 'build',
      startWeekIndex: 0,
      endWeekIndex: 3,
      blockFocus: '',
      intentBySport: {},
    }])

    const described = describeManifest().cases.find(
      (item) => item.caseId === manifestCase.caseId,
    )
    expect(described.planPhases).toEqual(plan.phases)
  })

  it('keeps peak, taper and race as three contiguous phase blocks', () => {
    const manifestCase = buildManifest().find(
      (item) => item.scenarioKey === 'squash_taper_medico',
    )
    const { plan } = buildPlanFixture(manifestCase)
    expect(plan.phases).toEqual([
      { phase: 'peak', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {} },
      { phase: 'taper', startWeekIndex: 1, endWeekIndex: 1, blockFocus: '', intentBySport: {} },
      { phase: 'race', startWeekIndex: 2, endWeekIndex: 2, blockFocus: '', intentBySport: {} },
    ])
    const described = describeManifest().cases.find(
      (item) => item.caseId === manifestCase.caseId,
    )
    expect(described.planPhases).toEqual(plan.phases)
  })
})

describe('loadtest stats', () => {
  it('uses nearest-rank without interpolation', () => {
    const values = [10, 20, 30, 40]
    // ceil(0.5 * 4) = 2 → segundo valor ordenado.
    expect(percentile(values, 0.5)).toBe(20)
    // ceil(0.95 * 4) = 4 → cuarto valor.
    expect(percentile(values, 0.95)).toBe(40)
  })

  it('returns null for an empty sample instead of zero', () => {
    expect(percentile([], 0.5)).toBeNull()
  })

  it('excludes nulls from latency and reports how many there were', () => {
    const summary = summarizeLatency([100, null, 300, undefined, 200])
    expect(summary.n).toBe(3)
    expect(summary.nullCount).toBe(2)
    expect(summary.p50).toBe(200)
  })

  it('never treats a null latency as zero', () => {
    expect(summarizeLatency([500, null]).p50).toBe(500)
  })

  it('summarizes a repair distribution with a histogram', () => {
    const summary = summarizeDistribution([0, 0, 1, 2, 5])
    expect(summary.n).toBe(5)
    expect(summary.max).toBe(5)
    expect(summary.p50).toBe(1)
    expect(summary.p90).toBe(5)
    expect(summary.p99).toBe(5)
    expect(summary.histogram).toEqual({ 0: 2, 1: 1, 2: 1, 5: 1 })
  })
})

describe('pairPlans', () => {
  it('pairs by caseId regardless of array order', () => {
    const control = artifactWith([planWith('c2', 's2', []), planWith('c1', 's1', [])])
    const variant = artifactWith([planWith('c1', 's1', []), planWith('c2', 's2', [])])

    const { pairs, onlyControl, onlyVariant } = pairPlans(control, variant)

    expect(pairs.map((pair) => pair.caseId)).toEqual(['c1', 'c2'])
    expect(onlyControl).toEqual([])
    expect(onlyVariant).toEqual([])
  })

  it('reports caseIds present on only one side instead of dropping them', () => {
    const control = artifactWith([planWith('c1', 's1', []), planWith('c2', 's2', [])])
    const variant = artifactWith([planWith('c1', 's1', []), planWith('c3', 's3', [])])

    const { pairs, onlyControl, onlyVariant } = pairPlans(control, variant)

    expect(pairs.map((pair) => pair.caseId)).toEqual(['c1'])
    expect(onlyControl).toEqual(['c2'])
    expect(onlyVariant).toEqual(['c3'])
  })

  it('reports duplicate caseIds instead of silently overwriting one plan', () => {
    const control = artifactWith([
      planWith('c1', 's1', []),
      planWith('c1', 's1', []),
    ])
    const variant = artifactWith([planWith('c1', 's1', [])])

    const result = pairPlans(control, variant)

    expect(result.pairs).toEqual([])
    expect(result.duplicateControl).toEqual(['c1'])
    expect(result.duplicateVariant).toEqual([])
  })
})

describe('pairWeeks', () => {
  it('pairs by (caseId, weekIndex), never by position', () => {
    const control = artifactWith([planWith('c1', 's1', [
      { weekIndex: 1, countRepairsV2: 3 },
      { weekIndex: 0, countRepairsV2: 1 },
    ])])
    const variant = artifactWith([planWith('c1', 's1', [
      { weekIndex: 0, countRepairsV2: 2 },
      { weekIndex: 1, countRepairsV2: 4 },
    ])])

    const { pairs } = pairWeeks(control, variant)

    expect(pairs).toHaveLength(2)
    const first = pairs.find((pair) => pair.weekIndex === 0)
    expect(first.control.countRepairsV2).toBe(1)
    expect(first.variant.countRepairsV2).toBe(2)
  })

  // Aparear una semana contra su vecina inventaría un delta que no existe.
  it('reports a week with no counterpart instead of pairing it with a neighbour', () => {
    const control = artifactWith([planWith('c1', 's1', [{ weekIndex: 0 }, { weekIndex: 1 }])])
    const variant = artifactWith([planWith('c1', 's1', [{ weekIndex: 0 }])])

    const { pairs, unmatched } = pairWeeks(control, variant)

    expect(pairs).toHaveLength(1)
    expect(unmatched).toEqual([{ caseId: 'c1', weekIndex: 1, side: 'control' }])
  })

  it('reports duplicate week keys instead of choosing one occurrence', () => {
    const control = artifactWith([planWith('c1', 's1', [
      { weekIndex: 0, countRepairsV2: 1 },
      { weekIndex: 0, countRepairsV2: 9 },
    ])])
    const variant = artifactWith([planWith('c1', 's1', [
      { weekIndex: 0, countRepairsV2: 2 },
    ])])

    const result = pairWeeks(control, variant)

    expect(result.pairs).toEqual([])
    expect(result.duplicates).toEqual([{ caseId: 'c1', weekIndex: 0, side: 'control' }])
  })
})

describe('buildComparison', () => {
  it('computes the median of paired ratios, not the ratio of medians', () => {
    // Ratios pareados: 0,5 y 1,0 → mediana nearest-rank (ceil(0,5*2)=1) = 0,5.
    // El ratio de medianas daría 1500/2000 = 0,75.
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { firstWeekReadyMs: 1000 }),
      completePlan('c2', 's2', { firstWeekReadyMs: 2000 }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { firstWeekReadyMs: 500 }),
      completePlan('c2', 's2', { firstWeekReadyMs: 2000 }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.firstWeekReady.ratios).toEqual([0.5, 1])
    expect(comparison.firstWeekReady.p50).toBe(0.5)
    expect(comparison.firstWeekReady.improvedCases).toBe(1)
  })

  it('counts a scenario as improved by the AVERAGE of its two ratios', () => {
    // 0,4 y 1,4 → promedio 0,9 < 1 → mejora, aunque un caso empeore.
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 'dobles', { firstWeekReadyMs: 1000 }),
      completePlan('c2', 'dobles', { firstWeekReadyMs: 1000 }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 'dobles', { firstWeekReadyMs: 400 }),
      completePlan('c2', 'dobles', { firstWeekReadyMs: 1400 }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.firstWeekReady.byScenario.dobles.meanRatio).toBeCloseTo(0.9, 10)
    expect(comparison.firstWeekReady.improvedScenarios).toBe(1)
  })

  it('summarises score as paired deltas, keeping the minimum', () => {
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { planScore: 90 }),
      completePlan('c2', 's2', { planScore: 90 }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { planScore: 89 }),
      completePlan('c2', 's2', { planScore: 84 }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.score.deltas).toEqual([-6, -1])
    expect(comparison.score.min).toBe(-6)
    expect(comparison.score.p50).toBe(-6) // nearest-rank con n=2 toma el menor
  })

  it('summarises weekly repairs as paired deltas per (caseId, weekIndex)', () => {
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { weekOverrides: { countRepairsV2: 2 } }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { weekOverrides: { countRepairsV2: 3 } }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.repairs.weekCountRepairsV2.deltas).toEqual([1, 1])
    expect(comparison.repairs.weekCountRepairsV2.p90).toBe(1)
  })

  it('keeps paired telemetry, per-plan details and scenario summaries', () => {
    const control = artifactWith([
      completePlan('c1', 'running', {
        firstWeekReadyE2eMs: 2000,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        retryCount: 1,
        planGrade: 'excellent',
        issueCodes: ['control-issue'],
      }),
    ])
    const variant = artifactWith([
      completePlan('c1', 'running', {
        firstWeekReadyE2eMs: 1000,
        totalInputTokens: 80,
        totalOutputTokens: 60,
        retryCount: 3,
        planGrade: 'good',
        issueCodes: ['variant-issue'],
        fallbackUsed: true,
        observedModels: ['claude-sonnet-4-6', 'fallback-model'],
      }),
    ])

    const comparison = buildComparison(control, variant)

    expect(comparison.scorableWeekPairs).toBe(2)
    expect(comparison.firstWeekReadyE2E.ratios).toEqual([0.5])
    expect(comparison.totalInputTokens).toMatchObject({
      control: 100,
      variant: 80,
      delta: -20,
      deltas: [-20],
    })
    expect(comparison.totalOutputTokens.delta).toBe(10)
    expect(comparison.retryCount.delta).toBe(2)
    expect(comparison.planDetails[0]).toMatchObject({
      caseId: 'c1',
      planGrade: { control: 'excellent', variant: 'good' },
      issueCodes: { control: ['control-issue'], variant: ['variant-issue'] },
      fallbackUsed: { control: false, variant: true },
      observedModels: {
        control: ['claude-sonnet-4-6'],
        variant: ['claude-sonnet-4-6', 'fallback-model'],
      },
    })
    expect(comparison.byScenario.running.firstWeekReadyE2E.p50).toBe(0.5)
    expect(comparison.byScenario.running.totalInputTokens.delta).toBe(-20)
  })

  it('does not present partial telemetry totals as a cheaper complete run', () => {
    const controlPlans = [
      completePlan('c1', 'running'),
      completePlan('c2', 'running'),
    ]
    const variantPlans = [
      completePlan('c1', 'running', { estimatedCostUsd: 0.04 }),
      completePlan('c2', 'running'),
    ]
    variantPlans[1].estimatedCostUsd = null

    const comparison = buildComparison(
      artifactWith(controlPlans),
      artifactWith(variantPlans),
    )

    expect(comparison.cost.n).toBe(1)
    expect(comparison.cost.control).toBeNull()
    expect(comparison.cost.variant).toBeNull()
    expect(comparison.cost.delta).toBeNull()
  })
})

describe('loadtest artifact', () => {
  it('allowlists week rows and never carries sessions or prompts', () => {
    const row = toWeekRow({
      weekIndex: 2,
      status: 'draft',
      sessions: [{ title: 'secreto' }],
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        qualityVersion: 1,
        correctiveActionCount: 3,
        structuralActionCount: 2,
        movedSessionCount: 1,
        droppedSessionCount: 0,
      },
    }, { scenarioKey: 'squash_build', countRepairsV2: 6, score: 88, grade: 'good' })

    expect(row.sessions).toBeUndefined()
    expect(JSON.stringify(row)).not.toContain('secreto')
    expect(row).toMatchObject({
      weekIndex: 2,
      status: 'draft',
      countRepairsV2: 6,
      correctiveActionCount: 3,
      structuralActionCount: 2,
      scorable: true,
    })
  })

  it('resolves the quality version from context when generation metadata omits it', () => {
    const row = toWeekRow(
      {
        weekIndex: 0,
        status: 'draft',
        sessions: [],
        generationMeta: { attempts: 1, repairTaxonomyVersion: 2 },
      },
      { scenarioKey: 'running', countRepairsV2: 0, qualityVersion: 2 },
    )

    expect(row.qualityVersion).toBe(2)
  })

  it('marks a week without v2 taxonomy as not scorable', () => {
    const row = toWeekRow(
      { weekIndex: 0, status: 'draft', sessions: [], generationMeta: { attempts: 1 } },
      { scenarioKey: 'running', countRepairsV2: 0 },
    )
    expect(row.scorable).toBe(false)
  })

  it('marks a week without a finite non-negative v2 repair count as not scorable', () => {
    for (const countRepairsV2 of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, '2']) {
      const row = toWeekRow(
        {
          weekIndex: 0,
          status: 'draft',
          sessions: [],
          generationMeta: { attempts: 1, repairTaxonomyVersion: 2 },
        },
        { scenarioKey: 'running', countRepairsV2 },
      )
      expect(row.scorable).toBe(false)
    }
  })

  it('marks an errored week as not scorable', () => {
    const row = toWeekRow(
      { weekIndex: 0, status: 'error', sessions: [], generationMeta: { attempts: 2, repairTaxonomyVersion: 2 } },
      { scenarioKey: 'running', countRepairsV2: 0 },
    )
    expect(row.scorable).toBe(false)
  })

  it('recalculates scorable when allowlisting an already materialized week', () => {
    const row = toPlanRow({
      weeks: [{
        weekIndex: 0,
        scenarioKey: 'running',
        status: 'draft',
        repairTaxonomyVersion: 2,
        countRepairsV2: null,
        scorable: true,
      }],
    }).weeks[0]

    expect(row.scorable).toBe(false)
  })

  it('accepts a run that covers the frozen manifest', () => {
    const verdict = evaluateAcceptance(artifactFrom(planRowsFromManifest()))
    expect(verdict.accepted).toBe(true)
    expect(verdict.attemptedPlans).toBe(12)
    expect(verdict.observedTargetWeeks).toBe(42)
    expect(verdict.scorableWeeks).toBe(42)
  })

  it('rejects twelve copies of the same case even if the counts add up', () => {
    const [first] = planRowsFromManifest()
    // Doce filas, doce "planes", pero un solo caso del manifest cubierto.
    const plans = Array.from({ length: 12 }, () => ({ ...first }))
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/caseIds duplicados en planes/)
  })

  it('rejects matching duplicate caseIds in the embedded manifest and plans', () => {
    const artifact = artifactFrom(planRowsFromManifest())
    artifact.manifest.cases[1] = structuredClone(artifact.manifest.cases[0])
    artifact.plans[1] = structuredClone(artifact.plans[0])

    const verdict = evaluateAcceptance(artifact)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/caseIds duplicados en manifest/)
    expect(verdict.reasons.join(' ')).toMatch(/caseIds duplicados en planes/)
  })

  it('rejects a plan whose scenarioKey disagrees with its embedded case', () => {
    const plans = planRowsFromManifest((manifestCase) =>
      manifestCase.caseId === 'running#1' ? { scenarioKey: 'squash_build' } : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/scenarioKey de plan/)
  })

  it('rejects a week whose scenarioKey disagrees with its plan', () => {
    const plans = planRowsFromManifest((manifestCase) =>
      manifestCase.caseId === 'running#1'
        ? {
            weeks: Array.from({ length: manifestCase.weekCount }, (_, weekIndex) => ({
              weekIndex,
              scenarioKey: weekIndex === 0 ? 'squash_build' : manifestCase.scenarioKey,
              status: 'draft',
              repairTaxonomyVersion: 2,
              sessionCount: 1,
              countRepairsV2: 0,
              scorable: true,
            })),
          }
        : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/scenarioKey de semana/)
  })

  it('derives observed target weeks from the rows instead of trusting a declared total', () => {
    const plans = planRowsFromManifest((manifestCase) =>
      manifestCase.caseId === 'running#1' ? { weekCount: 2, weeks: [] } : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.observedTargetWeeks).toBe(40)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/semanas objetivo/)
  })

  it('rejects a control that lost an entire scenario, even with ten complete plans', () => {
    // Perder los dos planes de un escenario deja 10 completos y 34 semanas
    // puntuables: pasa por conteo, pero sin cobertura del escenario.
    const plans = planRowsFromManifest((manifestCase) =>
      manifestCase.scenarioKey === 'running'
        ? { outcome: 'failed', weekCountSucceeded: 0, weekCountFailed: manifestCase.weekCount, weeks: [] }
        : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))

    expect(verdict.completePlans).toBe(10)
    expect(verdict.scorableWeeks).toBe(34)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('escenarios sin ningún plan completo: running')
  })

  it('derives scenario coverage from the embedded manifest, not from observed rows', () => {
    // Las filas del escenario perdido no existen: si la cobertura se derivara
    // de lo observado, el chequeo pasaría por verdad vacua.
    const plans = planRowsFromManifest().filter((plan) => plan.scenarioKey !== 'ciclismo')
    const verdict = evaluateAcceptance(artifactFrom(plans))

    expect(verdict.reasons.join(' ')).toContain('escenarios sin ningún plan completo: ciclismo')
  })

  it('accepts when every scenario keeps at least one complete plan', () => {
    // Un plan caído por escenario en dos escenarios distintos: 10 completos,
    // pero los seis escenarios siguen representados.
    const dropped = new Set(['squash_build#2', 'dobles#2'])
    const plans = planRowsFromManifest((manifestCase) =>
      dropped.has(manifestCase.caseId)
        ? { outcome: 'failed', weekCountSucceeded: 0, weekCountFailed: manifestCase.weekCount, weeks: [] }
        : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))

    expect(verdict.completePlans).toBe(10)
    expect(verdict.accepted).toBe(true)
  })

  it('rejects a run that stopped after ten successful plans', () => {
    const plans = planRowsFromManifest().slice(0, 10)
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/casos del manifest/)
  })

  it('rejects when too few plans completed even with the full manifest attempted', () => {
    const plans = planRowsFromManifest((_, index) =>
      index >= 9 ? { outcome: 'failed', weekCountSucceeded: 0, weeks: [] } : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.attemptedPlans).toBe(12)
    expect(verdict.completePlans).toBe(9)
    expect(verdict.accepted).toBe(false)
  })

  it('always rejects a harness failure even when eleven plans completed', () => {
    const plans = planRowsFromManifest((_, index) => index === 0
      ? {
          outcome: 'failed',
          weekCountSucceeded: null,
          weekCountFailed: null,
          errorClass: 'harness_failure',
          weeks: [],
        }
      : {})

    const verdict = evaluateAcceptance(artifactFrom(plans))

    expect(verdict.completePlans).toBe(11)
    expect(verdict.scorableWeeks).toBe(38)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/fallos del harness: .*#1/)
  })

  it('does not count contradictory succeeded plans as complete or score their weeks', () => {
    const contradictions = [
      (plan) => ({ ...plan, weekCountSucceeded: 0, weekCountFailed: plan.weekCount }),
      (plan) => ({ ...plan, weeks: plan.weeks.slice(0, -1) }),
      (plan) => ({
        ...plan,
        weeks: plan.weeks.map((week, index) =>
          index === 0 ? { ...week, status: 'pending' } : week),
      }),
      (plan) => ({
        ...plan,
        weeks: plan.weeks.map((week, index) =>
          index === 0 ? { ...week, sessionCount: 0 } : week),
      }),
    ]

    for (const contradict of contradictions) {
      const plans = planRowsFromManifest()
      plans[0] = contradict(plans[0])
      const verdict = evaluateAcceptance(artifactFrom(plans))
      expect(verdict.accepted).toBe(false)
      expect(verdict.completePlans).toBe(11)
      expect(verdict.reasons.join(' ')).toMatch(/succeeded incoherentes/)
    }
  })

  it('rejects duplicate and out-of-range week indexes even on failed plans', () => {
    const invalidWeekSets = [
      [
        {
          weekIndex: 0,
          scenarioKey: 'semana_parcial',
          status: 'error',
          repairTaxonomyVersion: 2,
          sessionCount: 0,
          countRepairsV2: 0,
        },
        {
          weekIndex: 0,
          scenarioKey: 'semana_parcial',
          status: 'error',
          repairTaxonomyVersion: 2,
          sessionCount: 0,
          countRepairsV2: 0,
        },
      ],
      [{
        weekIndex: 3,
        scenarioKey: 'semana_parcial',
        status: 'error',
        repairTaxonomyVersion: 2,
        sessionCount: 0,
        countRepairsV2: 0,
      }],
    ]

    for (const weeks of invalidWeekSets) {
      const plans = planRowsFromManifest((manifestCase) =>
        manifestCase.caseId === 'semana_parcial#2'
          ? {
              outcome: 'failed',
              weekCountSucceeded: 0,
              weekCountFailed: manifestCase.weekCount,
              weeks,
            }
          : {})
      const verdict = evaluateAcceptance(artifactFrom(plans))
      expect(verdict.accepted).toBe(false)
      expect(verdict.reasons.join(' ')).toMatch(/índices de semana inválidos/)
    }
  })

  it('embeds the manifest, the caveat and the latency summaries for Entrega 2', () => {
    const artifact = artifactFrom(planRowsFromManifest())
    expect(artifact.artifactSchemaVersion).toBe(ARTIFACT_SCHEMA_VERSION)
    expect(artifact.git).toEqual({ sha: 'abc', dirty: false })
    expect(artifact.manifest.cases).toHaveLength(12)
    // Sin perfil y wizard config no se puede reconstruir qué produjo la muestra.
    expect(artifact.manifest.cases[0].wizardConfig.sessionsPerWeek).toBeGreaterThan(0)
    expect(artifact.manifest.cases[0].profile.id).toBe('loadtest-athlete')
    expect(artifact.caveat).toContain('n=12')
    expect(artifact.latencySummary.completePlans.terminalMs.p95).toBe(9000)
  })

  it('allowlists git and variant metadata at the artifact boundary', () => {
    const variant = {
      provider: 'claude',
      model: 'm',
      effort: 'high',
      thinkingMode: 'enabled',
      temperature: 0,
      maxTokens: 4096,
      promptVersion: 3,
      schemaVersion: 2,
      qualityVersion: 1,
      concurrency: 2,
      variantId: 'v',
      apiKey: 'variant-secret',
      systemPrompt: 'sensitive-prompt',
    }
    const artifact = buildArtifact({
      plans: [],
      git: { sha: 'abc', dirty: false, accessToken: 'git-secret' },
      variant,
    })

    expect(artifact.git).toEqual({ sha: 'abc', dirty: false })
    expect(artifact.variant).toEqual({
      provider: 'claude',
      model: 'm',
      effort: 'high',
      thinkingMode: 'enabled',
      temperature: 0,
      maxTokens: 4096,
      promptVersion: 3,
      schemaVersion: 2,
      qualityVersion: 1,
      concurrency: 2,
      variantId: 'v',
    })
    expect(JSON.stringify(artifact)).not.toMatch(/variant-secret|sensitive-prompt|git-secret/)
  })

  it('re-applies the plan allowlist at the artifact boundary', () => {
    const [first] = planRowsFromManifest()
    const artifact = artifactFrom([{ ...first, apiKey: 'secreto', promptText: 'no' }])
    expect(artifact.plans[0].apiKey).toBeUndefined()
    expect(JSON.stringify(artifact)).not.toContain('secreto')
  })

  it('re-applies the allowlist inside weeks, not only at the plan root', () => {
    const [first] = planRowsFromManifest()
    const artifact = artifactFrom([{
      ...first,
      weeks: [{ ...first.weeks[0], promptText: 'secreto-semanal', sessions: [{ title: 'x' }] }],
    }])
    expect(artifact.plans[0].weeks[0].promptText).toBeUndefined()
    expect(artifact.plans[0].weeks[0].sessions).toBeUndefined()
    expect(JSON.stringify(artifact)).not.toContain('secreto-semanal')
  })

  it('evaluates a historical artifact against its own embedded manifest', () => {
    const artifact = artifactFrom(planRowsFromManifest())
    // Un manifest embebido más chico define un control distinto y válido.
    artifact.manifest = {
      ...artifact.manifest,
      cases: artifact.manifest.cases.slice(0, 11),
    }
    const verdict = evaluateAcceptance(artifact)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('12/11')
  })

  it('rejects an embedded manifest whose declared totals disagree with its cases', () => {
    const plans = planRowsFromManifest().slice(0, 11)
    const artifact = artifactFrom(plans)
    artifact.manifest = {
      ...artifact.manifest,
      cases: artifact.manifest.cases.slice(0, 11),
    }

    const verdict = evaluateAcceptance(artifact)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/cases\.length 11.*attemptedPlanTotal 12/)
    expect(verdict.reasons.join(' ')).toMatch(/weekCount 39.*targetWeekTotal 42/)
  })

  it('keeps an error class instead of raw provider text', () => {
    const row = toPlanRow({ caseId: 'a#1', errorClass: 'timeout', error: 'Anthropic dijo cualquier cosa' })
    expect(row.errorClass).toBe('timeout')
    expect(JSON.stringify(row)).not.toContain('cualquier cosa')
  })
})

function reportArtifactStub() {
  // Las tres semanas están listas (el plan es completo); la última no es
  // puntuable porque le falta la taxonomía v2.
  const weeks = [
    { weekIndex: 0, status: 'draft', sessionCount: 3, repairTaxonomyVersion: 2, scorable: true, countRepairsV2: 2, correctiveActionCount: 1, structuralActionCount: 1, durationMs: 3000, wallClockMs: 5000 },
    { weekIndex: 1, status: 'draft', sessionCount: 3, repairTaxonomyVersion: 2, scorable: true, countRepairsV2: 4, correctiveActionCount: 2, structuralActionCount: 1, durationMs: 7000, wallClockMs: 9000 },
    { weekIndex: 2, status: 'draft', sessionCount: 3, repairTaxonomyVersion: null, scorable: false, countRepairsV2: null, correctiveActionCount: 0, structuralActionCount: 0, durationMs: null, wallClockMs: null },
  ]
  return {
    artifactSchemaVersion: 1,
    plans: [
      {
        caseId: 'a#1', scenarioKey: 'squash_build', outcome: 'succeeded',
        weekCount: 3, weekCountSucceeded: 3, weekCountFailed: 0,
        firstWeekReadyMs: 1000, firstWeekDetectedMs: 4000, planCompleteMs: 8000, terminalMs: 9000,
        weeks,
      },
      {
        caseId: 'a#2', scenarioKey: 'squash_build', outcome: 'failed',
        weekCount: 3, weekCountSucceeded: 1, weekCountFailed: 2,
        firstWeekReadyMs: 2000, firstWeekDetectedMs: 5000, planCompleteMs: null, terminalMs: 11000,
        weeks: [
          {
            weekIndex: 0,
            status: 'draft',
            sessionCount: 3,
            repairTaxonomyVersion: 2,
            scorable: true,
            countRepairsV2: 99,
            correctiveActionCount: 99,
            structuralActionCount: 99,
            durationMs: 5000,
            wallClockMs: 6000,
          },
        ],
      },
    ],
  }
}

describe('loadtest report cohort', () => {
  /** Plan que dice `succeeded` pero miente en sus conteos. */
  function incoherentSucceededArtifact() {
    const plans = buildManifest().map((manifestCase, index) => ({
      caseId: manifestCase.caseId,
      scenarioKey: manifestCase.scenarioKey,
      weekCount: manifestCase.weekCount,
      outcome: 'succeeded',
      weekCountSucceeded: index === 0 ? 1 : manifestCase.weekCount,
      weekCountFailed: 0,
      terminalMs: index === 0 ? 999_000 : 9_000,
      weeks: Array.from({ length: manifestCase.weekCount }, (_, weekIndex) => ({
        weekIndex,
        scenarioKey: manifestCase.scenarioKey,
        status: 'draft',
        sessionCount: 3,
        repairTaxonomyVersion: 2,
        countRepairsV2: index === 0 ? 99 : 2,
        correctiveActionCount: 1,
        structuralActionCount: 1,
      })),
    }))
    return buildArtifact({ plans, variant: {}, git: { sha: 'x', dirty: false } })
  }

  it('uses the same complete-plan cohort as the artifact and the acceptance', () => {
    const artifact = incoherentSucceededArtifact()
    const report = buildReport(artifact)
    const expected = artifact.plans.filter(isCompletePlan).length

    expect(expected).toBe(11)
    expect(report.latency.completePlans.terminalMs.n).toBe(expected)
    expect(artifact.latencySummary.completePlans.terminalMs.n).toBe(expected)
  })

  it('keeps the artifact and report caveats reporting the same n', () => {
    const artifact = incoherentSucceededArtifact()
    const report = buildReport(artifact)
    expect(report.caveat).toContain('n=11')
    expect(artifact.caveat).toContain('n=11')
  })

  it('excludes an incoherent plan from the calibration distributions', () => {
    // La semana con countRepairsV2=99 pertenece al plan incoherente: si entrara
    // a la distribución, contaminaría el umbral que el owner elige mirándola.
    const report = buildReport(incoherentSucceededArtifact())
    expect(report.repair.weekCountRepairsV2.max).toBe(2)
  })
})

describe('loadtest report', () => {
  it('splits latency into all-attempts and complete-plans cohorts', () => {
    const report = buildReport(reportArtifactStub())
    expect(report.latency.allAttempts.terminalMs.n).toBe(2)
    expect(report.latency.completePlans.terminalMs.n).toBe(1)
  })

  it('summarizes the paired detection lag instead of leaving it to be eyeballed', () => {
    const artifact = reportArtifactStub()
    // Lags pareados por plan: 3000 y 3000; la resta de medianas de detected y
    // ready daría lo mismo acá solo por casualidad, así que se fija el campo.
    artifact.plans[0].firstWeekDetectionLagMs = 3000
    artifact.plans[1].firstWeekDetectionLagMs = 124

    const report = buildReport(artifact)
    const lag = report.latency.allAttempts.firstWeekDetectionLagMs
    expect(lag.n).toBe(2)
    // nearest-rank con n=2: ceil(0.5*2)=1 → el menor de la muestra.
    expect(lag.p50).toBe(124)
    expect(lag.p95).toBe(3000)
  })

  it('counts excluded nulls instead of scoring them as zero', () => {
    const report = buildReport(reportArtifactStub())
    expect(report.latency.allAttempts.planCompleteMs.nullCount).toBe(1)
    expect(report.latency.allAttempts.planCompleteMs.p50).toBe(8000)
  })

  it('reports the three repair distributions over scorable weeks only', () => {
    const report = buildReport(reportArtifactStub())
    expect(report.repair.weekCountRepairsV2.n).toBe(2)
    expect(report.repair.planCountRepairsV2.n).toBe(1)
    expect(report.repair.weekWarningInput.n).toBe(2)
    // El warning suma solo corrective + structural: 1+1 y 2+1.
    expect(report.repair.weekWarningInput.max).toBe(3)
  })

  it('emits the caveat with the real n, never a hardcoded one', () => {
    const report = buildReport(reportArtifactStub())
    expect(report.caveat).toContain('n=1')
    expect(report.caveat).not.toContain('n=12')
  })

  it('breaks every repair distribution down by scenario, not just the weekly one', () => {
    const report = buildReport(reportArtifactStub())
    const scenario = report.byScenario.squash_build
    expect(scenario.weekCountRepairsV2.n).toBe(2)
    expect(scenario.planCountRepairsV2.n).toBe(1)
    expect(scenario.weekWarningInput.n).toBe(2)
  })

  it('keeps repair distributions isolated between scenarios', () => {
    const artifact = reportArtifactStub()
    artifact.plans.push({
      caseId: 'b#1',
      scenarioKey: 'running',
      outcome: 'succeeded',
      weekCount: 1,
      weekCountSucceeded: 1,
      weekCountFailed: 0,
      firstWeekReadyMs: 3000,
      firstWeekDetectedMs: 6000,
      planCompleteMs: 12000,
      terminalMs: 13000,
      weeks: [{
        weekIndex: 0,
        status: 'draft',
        sessionCount: 3,
        repairTaxonomyVersion: 2,
        scorable: true,
        countRepairsV2: 10,
        correctiveActionCount: 7,
        structuralActionCount: 2,
        durationMs: 4000,
        wallClockMs: 4500,
      }],
    })

    const report = buildReport(artifact)
    expect(report.byScenario.squash_build.weekCountRepairsV2.max).toBe(4)
    expect(report.byScenario.squash_build.planCountRepairsV2.max).toBe(6)
    expect(report.byScenario.squash_build.weekWarningInput.max).toBe(3)
    expect(report.byScenario.running.weekCountRepairsV2.max).toBe(10)
    expect(report.byScenario.running.planCountRepairsV2.max).toBe(10)
    expect(report.byScenario.running.weekWarningInput.max).toBe(9)
  })

  it('emits weekly latency over weeks from every plan with real values', () => {
    const report = buildReport(reportArtifactStub())
    // Incluye la semana del plan fallido: tres duraciones, más una en null.
    expect(report.weeklyLatency.durationMs.n).toBe(3)
    expect(report.weeklyLatency.durationMs.nullCount).toBe(1)
    expect(report.weeklyLatency.durationMs.p50).toBe(5000)
    expect(report.weeklyLatency.wallClockMs.p95).toBe(9000)
  })

  it('refuses an artifact written by a different schema version', () => {
    const artifact = { ...reportArtifactStub(), artifactSchemaVersion: 2 }
    expect(() => buildReport(artifact)).toThrow(/artifactSchemaVersion/)
  })

  it('renders both blocks as text', () => {
    const text = renderReport(buildReport(reportArtifactStub()))
    expect(text).toContain('Latencia por plan')
    expect(text).toContain('Distribuciones de reparación')
  })
})

const readyWeek = (week) => week.status === 'draft' && week.sessions.length > 0

function aiRequest(traceId, userMessage = 'hola') {
  return {
    systemPrompt: 'Responde solo con JSON.',
    userMessage,
    conversation: [{ role: 'assistant', content: 'contexto previo' }],
    responseSchema: {
      type: 'object',
      properties: { sessions: { type: 'array' } },
      required: ['sessions'],
    },
    requestClass: 'plan_builder_week',
    traceId,
  }
}

describe('loadtest memory writer', () => {
  it('keeps plan, weeks, attempts and job in memory', async () => {
    const { writer, snapshot } = createMemoryWriter()
    await writer.putPlan({ id: 'p1', generationState: 'generating' })
    await writer.putWeek({ weekIndex: 0, status: 'draft', sessions: [{}] })
    await writer.putAttempt({ weekIndex: 0, attempt: 1 })
    await writer.putJob({ jobId: 'j1', terminalMs: 10 })

    const state = snapshot()
    expect(state.plan.id).toBe('p1')
    expect(state.weeks).toHaveLength(1)
    expect(state.attempts).toHaveLength(1)
    expect(state.job.jobId).toBe('j1')
    expect(await writer.getPlan('p1')).toEqual(state.plan)
  })

  it('replaces a week in place instead of appending duplicates', async () => {
    const { writer, snapshot } = createMemoryWriter()
    await writer.putWeek({ weekIndex: 0, status: 'generating', sessions: [] })
    await writer.putWeek({ weekIndex: 0, status: 'draft', sessions: [{}] })
    expect(snapshot().weeks).toHaveLength(1)
    expect(snapshot().weeks[0].status).toBe('draft')
  })

  it('timestamps every week write so weekly latency is measurable', async () => {
    let clock = 1_000
    const { writer, snapshot } = createMemoryWriter(() => clock)
    await writer.putWeek({ weekIndex: 0, status: 'generating', sessions: [] })
    clock = 7_500
    await writer.putWeek({ weekIndex: 0, status: 'draft', sessions: [{}] })

    const writes = snapshot().weekWrites
    expect(writes).toHaveLength(2)
    expect(writes[1].at - writes[0].at).toBe(6_500)
  })
})

describe('loadtest callLLM instrumentation', () => {
  it('records sizes per week without keeping any content', async () => {
    const { wrapped, sizesFor } = instrumentCallLLM(async () => ({ text: '12345' }))
    await wrapped(aiRequest('job-week-2'))

    const sizes = sizesFor(2)
    expect(sizes.responseChars).toBe(5)
    expect(sizes.promptChars).toBeGreaterThan(0)
    expect(JSON.stringify(sizes)).not.toMatch(/hola|contexto previo|Responde solo/)
  })

  it('accumulates retries of the same week', async () => {
    const { wrapped, sizesFor } = instrumentCallLLM(async () => ({ text: 'ab' }))
    await wrapped(aiRequest('job-week-1'))
    await wrapped(aiRequest('job-week-1-attempt-2'))
    expect(sizesFor(1).responseChars).toBe(4)
  })

  it('reads the terminal week segment even when the job id contains week-like text', async () => {
    const { wrapped, sizesFor } = instrumentCallLLM(async () => ({ text: 'ok' }))
    await wrapped(aiRequest('job-week-99-prefix-week-2-attempt-3'))

    expect(sizesFor(2).responseChars).toBe(2)
    expect(sizesFor(99)).toBeNull()
  })

  it('keeps the input size when the provider attempt throws', async () => {
    const { wrapped, sizesFor } = instrumentCallLLM(async () => {
      throw new Error('provider unavailable')
    })

    await expect(wrapped(aiRequest(
      'job-week-3',
      'contenido sensible',
    ))).rejects.toThrow('provider unavailable')

    const sizes = sizesFor(3)
    expect(sizes.promptChars).toBeGreaterThan(0)
    expect(sizes.responseChars).toBe(0)
    expect(JSON.stringify(sizes)).not.toContain('contenido sensible')
  })

  it('rejects a malformed traceId before calling the provider', async () => {
    const caller = vi.fn().mockResolvedValue({ text: 'should-not-run' })
    const { wrapped, sizesFor } = instrumentCallLLM(caller)

    await expect(wrapped(aiRequest('job-without-week-index')))
      .rejects.toThrow(/traceId/)

    expect(caller).not.toHaveBeenCalled()
    expect(sizesFor(-1)).toBeNull()
  })
})

describe('loadtest Vite runtime', () => {
  it('preserves the module-load error when closing Vite also fails', async () => {
    const loadError = new Error('module load failed')
    const vite = {
      ssrLoadModule: vi.fn().mockRejectedValue(loadError),
      close: vi.fn().mockRejectedValue(new Error('close failed')),
    }
    const createServerFactory = vi.fn().mockResolvedValue(vite)

    await expect(loadRuntime(createServerFactory)).rejects.toBe(loadError)

    expect(createServerFactory).toHaveBeenCalledOnce()
    expect(vite.close).toHaveBeenCalledOnce()
  })
})

describe('loadtest detection poller', () => {
  it('checks immediately and measures detection from workerStartedAt', async () => {
    let clock = 1_000
    const state = { weeks: [] }
    const poller = createDetectionPoller({
      snapshot: () => state,
      isReadyWeek: readyWeek,
      workerStartedAt: 1_000,
      intervalMs: 0,
      now: () => clock,
    })

    poller.start()
    await Promise.resolve()
    expect(poller.result().firstWeekDetectedMs).toBeNull()

    clock = 5_000
    state.weeks = [{ weekIndex: 0, status: 'draft', sessions: [{}] }]
    await poller.waitForNextCheck()
    poller.stop()

    expect(poller.result().firstWeekDetectedMs).toBe(4_000)
  })

  it('reports a null lag when no week ever became ready', async () => {
    const poller = createDetectionPoller({
      snapshot: () => ({ weeks: [] }),
      isReadyWeek: readyWeek,
      workerStartedAt: 0,
      intervalMs: 0,
      now: () => 10,
    })
    poller.start()
    await poller.settle()
    expect(poller.result().firstWeekDetectedMs).toBeNull()
  })

  it('still detects a week that became ready during the last sleep', async () => {
    let clock = 1_000
    const state = { weeks: [] }
    const poller = createDetectionPoller({
      snapshot: () => state,
      isReadyWeek: readyWeek,
      workerStartedAt: 1_000,
      intervalMs: 50,
      now: () => clock,
    })

    poller.start()
    state.weeks = [{ weekIndex: 0, status: 'draft', sessions: [{}] }]
    clock = 3_000
    await poller.settle()

    expect(poller.result().firstWeekDetectedMs).not.toBeNull()
  })
})

describe('loadtest CLI arguments and guards', () => {
  it('routes --report to the pure path', () => {
    expect(parseArgs(['--report', 'loadtest-results/x.json'])).toEqual({
      mode: 'report',
      artifactPath: 'loadtest-results/x.json',
    })
  })

  it('routes --compare to the pure paired-comparison path', () => {
    expect(parseArgs(['--compare', 'control.json', 'variant.json'])).toEqual({
      mode: 'compare',
      controlPath: 'control.json',
      variantPath: 'variant.json',
    })
  })

  it('routes a strict phase 2 artifact check with its expected effort', () => {
    expect(parseArgs(['--phase2-check', 'phase2-C.json', 'high'])).toEqual({
      mode: 'phase2-check',
      artifactPath: 'phase2-C.json',
      expectedEffort: 'high',
    })
  })

  it('defaults to the paid run mode only for an empty argv', () => {
    expect(parseArgs([])).toEqual({ mode: 'run', artifactPath: null })
  })

  it.each([
    [['--reprot'], 'typo'],
    [['--report'], 'missing path'],
    [['--report', ''], 'empty path'],
    [['--report', '   '], 'whitespace path'],
    [['--report', 'x.json', 'extra'], 'extra argument'],
    [['--compare'], 'missing compare paths'],
    [['--compare', 'control.json', ''], 'empty variant path'],
    [['--compare', 'control.json', 'variant.json', 'extra'], 'extra compare argument'],
    [['--phase2-check', 'phase2-C.json'], 'missing expected effort'],
    [['--phase2-check', 'phase2-C.json', 'max'], 'invalid phase 2 effort'],
    [['unexpected'], 'unknown argument'],
  ])('fails closed for %s (%s)', (argv) => {
    expect(() => parseArgs(argv)).toThrow(/Uso/)
  })

  it('fails the run mode without the enabling env', () => {
    expect(() => assertRunGuards({ CLAUDE_API_KEY: 'k' })).toThrow(/LOADTEST_PLAN_BUILDER/)
  })

  it('fails the run mode without a non-blank API key', () => {
    expect(() => assertRunGuards({
      LOADTEST_PLAN_BUILDER: '1',
      CLAUDE_API_KEY: ' \t ',
    })).toThrow(/CLAUDE_API_KEY/)
  })

  it('passes when both guards are set', () => {
    expect(() => assertRunGuards({
      LOADTEST_PLAN_BUILDER: '1',
      CLAUDE_API_KEY: 'k',
    })).not.toThrow()
  })

  it('names artifacts by timestamp under loadtest-results', () => {
    expect(defaultArtifactPath(new Date('2026-09-01T10:20:30.000Z')))
      .toBe('loadtest-results/plan-builder-2026-09-01T10-20-30-000Z.json')
  })
})

describe('renderComparison', () => {
  it('renders the gate, audit fields, scenario detail and final verdict', () => {
    const comparison = {
      planPairs: 12,
      completePairs: 12,
      weekPairs: 42,
      scorableWeekPairs: 42,
      onlyControl: [],
      onlyVariant: [],
      duplicateControlCases: [],
      duplicateVariantCases: [],
      unmatchedWeeks: [],
      duplicateWeeks: [],
      firstWeekReady: { n: 12, p50: 0.95, improvedCases: 9, improvedScenarios: 5 },
      firstWeekReadyE2E: { n: 12, p50: 0.8 },
      planComplete: { n: 12, p50: 1 },
      score: { n: 12, p50: 0, min: -1 },
      repairs: {
        weekCountRepairsV2: { n: 42, p50: 0, p90: 0 },
        weekWarningInput: { n: 42, p50: 0, p90: 0 },
        planCountRepairsV2: { n: 12, p50: 0, p90: 0 },
      },
      cost: { control: 0.92, variant: 0.8, delta: -0.12 },
      totalInputTokens: { control: 100, variant: 80, delta: -20 },
      totalOutputTokens: { control: 50, variant: 40, delta: -10 },
      retryCount: { control: 1, variant: 0, delta: -1 },
      byScenario: { running: { planPairs: 2, weekPairs: 8 } },
      planDetails: [{
        caseId: 'running#1',
        scenarioKey: 'running',
        planGrade: { control: 'excellent', variant: 'good' },
        issueCodes: { control: [], variant: ['x'] },
        fallbackUsed: { control: false, variant: false },
        observedModels: { control: ['m'], variant: ['m'] },
        outcome: { control: 'succeeded', variant: 'succeeded' },
        errorClass: { control: null, variant: null },
      }],
    }
    const decision = {
      accepted: false,
      checks: [{
        id: 'firstWeekReady.p50',
        actual: 0.95,
        operator: '<=',
        threshold: 0.8,
        passed: false,
      }],
    }
    const text = renderComparison(
      { git: { sha: 'abc' }, variant: { variantId: 'ctrl' } },
      { git: { sha: 'abc' }, variant: { variantId: 'var' } },
      comparison,
      { eligible: true, reasons: [] },
      decision,
    )

    expect(text).toMatch(/RECHAZADA/)
    expect(text).toMatch(/firstWeekReady\.p50/)
    expect(text).toMatch(/firstWeekReadyE2E/)
    expect(text).toMatch(/totalInputTokens/)
    expect(text).toMatch(/firstWeekE2E/)
    expect(text).toMatch(/repairWeekP90/)
    expect(text).toMatch(/retryDelta/)
    expect(text).toMatch(/running#1/)
    expect(text).toMatch(/por escenario/)
  })
})

describe('loadtest CLI pure row helpers', () => {
  it('keeps only a closed error taxonomy identifier', () => {
    expect(classifyError({ code: 'ETIMEDOUT', message: 'secret' })).toBe('ETIMEDOUT')
    expect(classifyError({ code: 'rate_limit', message: 'secret' })).toBe('rate_limit')
    expect(classifyError({ code: 'raw provider message with spaces', name: 'Error' }))
      .toBe('run_threw')
    expect(classifyError({ code: 'x'.repeat(100), name: '<script>' }))
      .toBe('run_threw')
    expect(classifyError({ code: 'sk-ant-secret-token-123456' })).toBe('run_threw')
    expect(classifyError({ name: 'BearerSecretCredential123' })).toBe('run_threw')
    expect(classifyError('provider said secret')).toBe('run_threw')
  })

  it('keeps the initial git SHA and marks every dirty or changed state', () => {
    expect(mergeGitState(
      { sha: 'abc', dirty: false },
      { sha: 'abc', dirty: false },
    )).toEqual({ sha: 'abc', dirty: false })
    expect(mergeGitState(
      { sha: 'abc', dirty: false },
      { sha: 'abc', dirty: true },
    )).toEqual({ sha: 'abc', dirty: true })
    expect(mergeGitState(
      { sha: 'abc', dirty: false },
      { sha: 'def', dirty: false },
    )).toEqual({ sha: 'abc', dirty: true })
    expect(mergeGitState(
      { sha: 'abc', dirty: true },
      { sha: 'abc', dirty: false },
    )).toEqual({ sha: 'abc', dirty: true })
  })

  it('uses once signal handlers without emitting a real process signal', () => {
    const target = new EventEmitter()
    const signals = installGracefulSignalHandlers(target)

    expect(signals.shouldStop()).toBe(false)
    expect(target.listenerCount('SIGINT')).toBe(1)
    target.emit('SIGINT')
    expect(signals.shouldStop()).toBe(true)
    expect(target.listenerCount('SIGINT')).toBe(0)

    signals.cleanup()
    expect(target.listenerCount('SIGTERM')).toBe(0)
  })

  it('sorts weeks and aggregates every attempt and the full write interval', () => {
    const weeks = [
      {
        weekIndex: 2,
        status: 'draft',
        sessions: [{}],
        generationMeta: { repairTaxonomyVersion: 2 },
      },
      {
        weekIndex: 0,
        status: 'draft',
        sessions: [{}],
        generationMeta: { repairTaxonomyVersion: 2 },
      },
    ]
    const rows = buildWeekRows({
      weeks,
      attempts: [
        { weekIndex: 0, durationMs: 10, promptTokens: 2, completionTokens: 3 },
        { weekIndex: 2, durationMs: 7, promptTokens: 1, completionTokens: 1 },
        { weekIndex: 0, durationMs: 20, promptTokens: 4, completionTokens: 5 },
      ],
      weekWrites: [
        { weekIndex: 0, at: 300 },
        { weekIndex: 2, at: 500 },
        { weekIndex: 0, at: 100 },
        { weekIndex: 0, at: 220 },
      ],
      sizesFor: (weekIndex) => weekIndex === 0
        ? { promptChars: 11, responseChars: 12 }
        : null,
      scenarioKey: 'running',
      countRepairsV2: () => 4,
      review: {
        qualityVersion: 2,
        weeks: [{ weekIndex: 0, score: 90, grade: 'good' }],
      },
      variant: { qualityVersion: 1 },
    })

    expect(rows.map((row) => row.weekIndex)).toEqual([0, 2])
    expect(rows[0]).toMatchObject({
      durationMs: 30,
      wallClockMs: 200,
      promptTokens: 6,
      completionTokens: 8,
      qualityVersion: 2,
      promptChars: 11,
      responseChars: 12,
      score: 90,
      grade: 'good',
    })
    expect(rows[1].durationMs).toBe(7)
  })

  it('falls back to the variant quality version when review is absent', () => {
    const [row] = buildWeekRows({
      weeks: [{
        weekIndex: 0,
        status: 'draft',
        sessions: [],
        generationMeta: { repairTaxonomyVersion: 2 },
      }],
      attempts: [],
      weekWrites: [],
      sizesFor: () => null,
      scenarioKey: 'running',
      countRepairsV2: () => 0,
      review: null,
      variant: { qualityVersion: 1 },
    })
    expect(row.qualityVersion).toBe(1)
  })

  it('derives the maximum countable strength overlap inside the same block', () => {
    const rows = buildWeekRows({
      plan: {
        phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1 }],
        macroSnapshot: { sportDetails: [{ sport: 'strength', role: 'primary' }] },
      },
      weeks: [
        { weekIndex: 0, phase: 'build', sessions: [{ sessionType: 'strength', exercises: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }], generationMeta: {} },
        { weekIndex: 1, phase: 'build', sessions: [{ sessionType: 'strength', exercises: [{ name: 'B' }, { name: 'C' }, { name: 'D' }] }], generationMeta: {} },
      ],
      attempts: [], weekWrites: [], sizesFor: () => null, scenarioKey: 'strength', countRepairsV2: () => 0,
    })
    expect(rows[0].strengthCountableOverlapMax).toBe(0)
    expect(rows[1].strengthCountableOverlapMax).toBe(2)
  })

  it('uses null, 0 and ratios consistently for block squash metrics', () => {
    const plan = {
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1 }],
      macroSnapshot: { sportDetails: [{ sport: 'squash', role: 'primary' }] },
    }
    const base = {
      plan,
      attempts: [], weekWrites: [], sizesFor: () => null, scenarioKey: 'squash_build', countRepairsV2: () => 0,
    }
    const withDrills = buildWeekRows({
      ...base,
      weeks: [
        { weekIndex: 0, phase: 'build', sessions: [{ sessionType: 'squash', squashDetails: { drills: [{ name: 'A' }, { name: 'B' }] } }], generationMeta: {} },
        { weekIndex: 1, phase: 'build', sessions: [{ sessionType: 'squash', squashDetails: { drills: [{ name: 'A' }, { name: 'C' }] } }], generationMeta: {} },
      ],
    })
    expect(withDrills[0].squashSessionCount).toBeNull()
    expect(withDrills[1]).toMatchObject({ squashSessionCount: 2, squashDrillUseCount: 4, squashUniqueDrillCount: 3, squashTopDrillUseCount: 2 })
    expect(withDrills[1].squashDrillVarietyRatio).toBe(0.75)
    expect(withDrills[1].squashTopSessionRatio).toBe(1)

    const withoutSessions = buildWeekRows({
      ...base,
      weeks: [
        { weekIndex: 0, phase: 'build', sessions: [], generationMeta: {} },
        { weekIndex: 1, phase: 'build', sessions: [], generationMeta: {} },
      ],
    })
    expect(withoutSessions[1]).toMatchObject({ squashSessionCount: 0, squashDrillUseCount: 0, squashUniqueDrillCount: 0, squashTopDrillUseCount: 0 })
    expect(withoutSessions[1].squashDrillVarietyRatio).toBeNull()
    expect(withoutSessions[1].squashTopSessionRatio).toBeNull()
  })

  it('leaves squash metrics null when squash is not the primary sport', () => {
    const [row] = buildWeekRows({
      plan: { phases: [], macroSnapshot: { sportDetails: [{ sport: 'running', role: 'primary' }] } },
      weeks: [{ weekIndex: 0, phase: 'base', sessions: [], generationMeta: {} }],
      attempts: [], weekWrites: [], sizesFor: () => null, scenarioKey: 'running', countRepairsV2: () => 0,
    })
    expect(row.squashSessionCount).toBeNull()
    expect(row.squashSignatureUniquenessFailureAttemptCount).toBeNull()
  })

  it('counts recovered signature failures by attempt and preserves measured zero', () => {
    const input = {
      plan: { phases: [], macroSnapshot: { sportDetails: [{ sport: 'squash', role: 'primary' }] } },
      weeks: [
        { weekIndex: 0, phase: 'base', sessions: [], generationMeta: {} },
        { weekIndex: 1, phase: 'base', sessions: [], generationMeta: {} },
      ],
      attempts: [
        { weekIndex: 0, errorClass: 'quality.squash.signature_uniqueness_unresolved' },
        { weekIndex: 0, errorClass: undefined },
        { weekIndex: 1, errorClass: undefined },
      ],
      weekWrites: [], sizesFor: () => null, scenarioKey: 'squash_build', countRepairsV2: () => 0,
    }
    const rows = buildWeekRows(input)
    expect(rows[0].squashSignatureUniquenessFailureAttemptCount).toBe(1)
    expect(rows[1].squashSignatureUniquenessFailureAttemptCount).toBe(0)
  })

  it('detects both explicit and counted fallback use', () => {
    expect(hasFallbackUsed([
      { generationMeta: { fallbackUsed: true, addedFallbackCount: 0 } },
    ])).toBe(true)
    expect(hasFallbackUsed([
      { generationMeta: { fallbackUsed: false, addedFallbackCount: 1 } },
    ])).toBe(true)
    expect(hasFallbackUsed([
      { generationMeta: { fallbackUsed: false, addedFallbackCount: 0 } },
    ])).toBe(false)
  })

  it('marks a throw escaping the productive loop as a harness failure', async () => {
    const [manifestCase] = buildManifest()
    const runtime = {
      callAnthropicForWeek: vi.fn(),
      runAsyncPlanGeneration: vi.fn().mockRejectedValue(
        Object.assign(new Error('provider content must not escape'), {
          code: 'rate_limit',
        }),
      ),
      isReadyWeek: () => false,
      reviewPlanQuality: vi.fn(),
      countRepairsV2: () => 0,
      pollIntervalMs: 0,
    }

    const row = await runCase(runtime, manifestCase, {
      concurrency: 1,
      qualityVersion: 1,
    })

    expect(row.errorClass).toBe('harness_failure')
    expect(JSON.stringify(row)).not.toContain('provider content must not escape')
  })
})

describe('loadtest paid-run persistence and lifecycle', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function paidDeps(overrides = {}) {
    vi.stubEnv('LOADTEST_PLAN_BUILDER', '1')
    vi.stubEnv('CLAUDE_API_KEY', 'test-only-key')
    const close = vi.fn().mockResolvedValue(undefined)
    const runtime = {
      resolveEffectivePlanBuilderConfig: vi.fn(() => ({
        provider: 'claude',
        model: 'm',
        qualityVersion: 1,
        concurrency: 1,
      })),
      buildVariantId: vi.fn(() => 'variant-1'),
      close,
    }
    const manifest = [
      { caseId: 'one#1', scenarioKey: 'one', weekCount: 1 },
      { caseId: 'two#1', scenarioKey: 'two', weekCount: 1 },
    ]
    return {
      artifactPath: 'loadtest-results/test.json',
      loadRuntime: vi.fn().mockResolvedValue(runtime),
      buildManifest: () => manifest,
      readGit: vi.fn(() => ({ sha: 'abc', dirty: false })),
      runCase: vi.fn(async (_runtime, manifestCase) => toPlanRow({
        ...manifestCase,
        outcome: 'succeeded',
        weekCountSucceeded: 1,
        weekCountFailed: 0,
        weeks: [],
      })),
      buildArtifact: ({ plans, git }) => ({
        artifactSchemaVersion: 1,
        git: { ...git },
        plans: plans.map((plan) => ({ ...plan })),
      }),
      writeArtifactAtomic: vi.fn().mockResolvedValue(undefined),
      buildReport: vi.fn(() => ({ ok: true })),
      renderReport: vi.fn(() => 'report'),
      evaluateAcceptance: vi.fn(() => ({ accepted: true, reasons: [] })),
      log: vi.fn(),
      error: vi.fn(),
      runtime,
      manifest,
      close,
      ...overrides,
    }
  }

  it('enforces paid guards before loading the runtime', async () => {
    const base = paidDeps({
      env: {
        LOADTEST_PLAN_BUILDER: '1',
        CLAUDE_API_KEY: 'injected-key-must-be-ignored',
      },
    })
    vi.stubEnv('LOADTEST_PLAN_BUILDER', '')
    vi.stubEnv('CLAUDE_API_KEY', '')

    await expect(runPaid(base)).rejects.toThrow(/LOADTEST_PLAN_BUILDER/)
    expect(base.loadRuntime).not.toHaveBeenCalled()
    expect(base.close).not.toHaveBeenCalled()
  })

  it('checkpoints atomically after every case and continues after a case failure', async () => {
    const secretFailure = Object.assign(new Error('provider leaked content'), {
      code: 'raw provider response',
    })
    const base = paidDeps()
    base.runCase
      .mockRejectedValueOnce(secretFailure)
      .mockImplementationOnce(async (_runtime, manifestCase) => toPlanRow({
        ...manifestCase,
        outcome: 'succeeded',
        weekCountSucceeded: 1,
        weekCountFailed: 0,
        weeks: [],
      }))

    const result = await runPaid(base)

    expect(base.runCase).toHaveBeenCalledTimes(2)
    expect(base.writeArtifactAtomic).toHaveBeenCalledTimes(3)
    expect(base.writeArtifactAtomic.mock.calls[0][1].plans).toHaveLength(1)
    expect(base.writeArtifactAtomic.mock.calls[1][1].plans).toHaveLength(2)
    expect(base.writeArtifactAtomic.mock.calls[2][1].plans).toHaveLength(2)
    expect(base.readGit).toHaveBeenCalledTimes(4)
    expect(result.artifact.plans[0]).toMatchObject({
      caseId: 'one#1',
      outcome: 'failed',
      errorClass: 'harness_failure',
      weekCountSucceeded: null,
      weekCountFailed: null,
    })
    expect(result.verdict.accepted).toBe(false)
    expect(JSON.stringify(result.artifact)).not.toContain('provider leaked content')
    expect(base.close).toHaveBeenCalledTimes(1)
  })

  it('rejects one harness failure plus eleven complete cases even with an optimistic evaluator', async () => {
    const manifest = buildManifest()
    const successfulRows = planRowsFromManifest()
    const optimisticEvaluator = vi.fn(() => ({ accepted: true, reasons: [] }))
    const base = paidDeps({
      buildManifest: () => manifest,
      buildArtifact,
      evaluateAcceptance: optimisticEvaluator,
    })
    base.runCase.mockImplementation(async (_runtime, manifestCase) => {
      if (manifestCase.caseId === manifest[0].caseId) {
        throw new Error('harness escaped')
      }
      return successfulRows.find((plan) => plan.caseId === manifestCase.caseId)
    })

    const result = await runPaid(base)

    expect(base.runCase).toHaveBeenCalledTimes(12)
    expect(base.writeArtifactAtomic).toHaveBeenCalledTimes(13)
    expect(result.artifact.plans[0]).toMatchObject({
      errorClass: 'harness_failure',
      weekCountSucceeded: null,
      weekCountFailed: null,
    })
    expect(optimisticEvaluator).toHaveBeenCalledTimes(1)
    expect(result.verdict.accepted).toBe(false)
    expect(result.verdict.reasons.join(' ')).toMatch(/fallos del harness/)
  })

  it('keeps the initial SHA and detects a Git change before the final checkpoint', async () => {
    const base = paidDeps()
    base.readGit
      .mockReturnValueOnce({ sha: 'abc', dirty: false })
      .mockReturnValueOnce({ sha: 'abc', dirty: false })
      .mockReturnValueOnce({ sha: 'def', dirty: false })
      .mockReturnValueOnce({ sha: 'def', dirty: false })

    const result = await runPaid(base)

    expect(result.artifact.git).toEqual({ sha: 'abc', dirty: true })
    expect(base.readGit).toHaveBeenCalledTimes(4)
    expect(base.writeArtifactAtomic).toHaveBeenCalledTimes(3)
  })

  it('stops between cases after a first injected signal and persists a final checkpoint', async () => {
    const target = new EventEmitter()
    const signals = installGracefulSignalHandlers(target)
    const base = paidDeps({ shouldStop: signals.shouldStop })
    base.runCase.mockImplementationOnce(async (_runtime, manifestCase) => {
      target.emit('SIGTERM')
      return toPlanRow({
        ...manifestCase,
        outcome: 'succeeded',
        weekCountSucceeded: 1,
        weekCountFailed: 0,
        weeks: [],
      })
    })

    const result = await runPaid(base)
    signals.cleanup()

    expect(base.runCase).toHaveBeenCalledTimes(1)
    expect(base.writeArtifactAtomic).toHaveBeenCalledTimes(2)
    expect(result.artifact.plans).toHaveLength(1)
    expect(result.verdict.accepted).toBe(false)
    expect(result.verdict.reasons.join(' ')).toMatch(/detenida por señal/)
    expect(base.close).toHaveBeenCalledTimes(1)
  })

  it('writes through a temporary sibling before the atomic rename', async () => {
    const calls = []
    const ops = {
      mkdir: async (...args) => calls.push(['mkdir', ...args]),
      writeFile: async (...args) => calls.push(['writeFile', ...args]),
      rename: async (...args) => calls.push(['rename', ...args]),
      unlink: async (...args) => calls.push(['unlink', ...args]),
    }

    await writeArtifactAtomic('/tmp/loadtest/result.json', { ok: true }, ops)

    expect(calls.map(([name]) => name)).toEqual(['mkdir', 'writeFile', 'rename'])
    const temporaryPath = calls[1][1]
    expect(temporaryPath).toMatch(/^\/tmp\/loadtest\/result\.json\.tmp-/)
    expect(calls[2].slice(1)).toEqual([temporaryPath, '/tmp/loadtest/result.json'])
  })

  it.each(['config', 'persist', 'report'])(
    'closes the runtime exactly once when %s fails',
    async (failurePoint) => {
      const primary = new Error(`${failurePoint} failed`)
      const base = paidDeps()
      if (failurePoint === 'config') {
        base.runtime.resolveEffectivePlanBuilderConfig.mockImplementation(() => {
          throw primary
        })
      } else if (failurePoint === 'persist') {
        base.writeArtifactAtomic.mockRejectedValue(primary)
      } else {
        base.buildReport.mockImplementation(() => {
          throw primary
        })
      }

      await expect(runPaid(base)).rejects.toBe(primary)
      expect(base.close).toHaveBeenCalledTimes(1)
    },
  )

  it('does not let a close failure mask the primary error', async () => {
    const primary = new Error('persist failed')
    const base = paidDeps()
    base.writeArtifactAtomic.mockRejectedValue(primary)
    base.close.mockRejectedValue(new Error('close failed'))

    await expect(runPaid(base)).rejects.toBe(primary)
    expect(base.close).toHaveBeenCalledTimes(1)
  })
})
