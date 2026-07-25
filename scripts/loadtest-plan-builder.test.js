import { describe, expect, it } from 'vitest'

import {
  ATTEMPTED_PLAN_TOTAL,
  MANIFEST_VERSION,
  SCENARIOS,
  TARGET_WEEK_TOTAL,
  buildManifest,
  buildPlanFixture,
} from './loadtest-plan-builder/manifest.mjs'
import {
  percentile,
  summarizeDistribution,
  summarizeLatency,
} from './loadtest-plan-builder/stats.mjs'
import {
  ARTIFACT_SCHEMA_VERSION,
  buildArtifact,
  evaluateAcceptance,
  toPlanRow,
  toWeekRow,
} from './loadtest-plan-builder/artifact.mjs'
import { buildReport, renderReport } from './loadtest-plan-builder/report.mjs'

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
      scorable: true,
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
    expect(summary.histogram).toEqual({ 0: 2, 1: 1, 2: 1, 5: 1 })
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

  it('marks an errored week as not scorable', () => {
    const row = toWeekRow(
      { weekIndex: 0, status: 'error', sessions: [], generationMeta: { attempts: 2, repairTaxonomyVersion: 2 } },
      { scenarioKey: 'running', countRepairsV2: 0 },
    )
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
    expect(verdict.reasons.join(' ')).toMatch(/casos del manifest/)
  })

  it('derives observed target weeks from the rows instead of trusting a declared total', () => {
    const plans = planRowsFromManifest((manifestCase) =>
      manifestCase.caseId === 'running#1' ? { weekCount: 2, weeks: [] } : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.observedTargetWeeks).toBe(40)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/semanas objetivo/)
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

  it('keeps an error class instead of raw provider text', () => {
    const row = toPlanRow({ caseId: 'a#1', errorClass: 'timeout', error: 'Anthropic dijo cualquier cosa' })
    expect(row.errorClass).toBe('timeout')
    expect(JSON.stringify(row)).not.toContain('cualquier cosa')
  })
})

function reportArtifactStub() {
  const weeks = [
    { weekIndex: 0, scorable: true, countRepairsV2: 2, correctiveActionCount: 1, structuralActionCount: 1, durationMs: 3000, wallClockMs: 5000 },
    { weekIndex: 1, scorable: true, countRepairsV2: 4, correctiveActionCount: 2, structuralActionCount: 1, durationMs: 7000, wallClockMs: 9000 },
    { weekIndex: 2, scorable: false, countRepairsV2: null, correctiveActionCount: 0, structuralActionCount: 0, durationMs: null, wallClockMs: null },
  ]
  return {
    artifactSchemaVersion: 1,
    plans: [
      {
        caseId: 'a#1', scenarioKey: 'squash_build', outcome: 'succeeded',
        firstWeekReadyMs: 1000, firstWeekDetectedMs: 4000, planCompleteMs: 8000, terminalMs: 9000,
        weeks,
      },
      {
        caseId: 'a#2', scenarioKey: 'squash_build', outcome: 'failed',
        firstWeekReadyMs: 2000, firstWeekDetectedMs: 5000, planCompleteMs: null, terminalMs: 11000,
        weeks: [
          {
            weekIndex: 0,
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

describe('loadtest report', () => {
  it('splits latency into all-attempts and complete-plans cohorts', () => {
    const report = buildReport(reportArtifactStub())
    expect(report.latency.allAttempts.terminalMs.n).toBe(2)
    expect(report.latency.completePlans.terminalMs.n).toBe(1)
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
