import { describe, expect, it, vi } from 'vitest'

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
  parseArgs,
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
      status: 'draft',
      scorable: true,
      repairTaxonomyVersion: 2,
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
    expect(summary.p90).toBe(5)
    expect(summary.p99).toBe(5)
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

  it('keeps repair distributions isolated between scenarios', () => {
    const artifact = reportArtifactStub()
    artifact.plans.push({
      caseId: 'b#1',
      scenarioKey: 'running',
      outcome: 'succeeded',
      firstWeekReadyMs: 3000,
      firstWeekDetectedMs: 6000,
      planCompleteMs: 12000,
      terminalMs: 13000,
      weeks: [{
        weekIndex: 0,
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

  it('defaults to the paid run mode only for an empty argv', () => {
    expect(parseArgs([])).toEqual({ mode: 'run', artifactPath: null })
  })

  it.each([
    [['--reprot'], 'typo'],
    [['--report'], 'missing path'],
    [['--report', ''], 'empty path'],
    [['--report', '   '], 'whitespace path'],
    [['--report', 'x.json', 'extra'], 'extra argument'],
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

describe('loadtest CLI pure row helpers', () => {
  it('keeps only a safe error taxonomy identifier', () => {
    expect(classifyError({ code: 'ETIMEDOUT', message: 'secret' })).toBe('ETIMEDOUT')
    expect(classifyError({ code: 'raw provider message with spaces', name: 'Error' }))
      .toBe('run_threw')
    expect(classifyError({ code: 'x'.repeat(100), name: '<script>' }))
      .toBe('run_threw')
    expect(classifyError('provider said secret')).toBe('run_threw')
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
})

describe('loadtest paid-run persistence and lifecycle', () => {
  function paidDeps(overrides = {}) {
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
      env: {
        LOADTEST_PLAN_BUILDER: '1',
        CLAUDE_API_KEY: 'test-only-key',
      },
      artifactPath: 'loadtest-results/test.json',
      loadRuntime: vi.fn().mockResolvedValue(runtime),
      buildManifest: () => manifest,
      readGit: () => ({ sha: 'abc', dirty: false }),
      runCase: vi.fn(async (_runtime, manifestCase) => toPlanRow({
        ...manifestCase,
        outcome: 'succeeded',
        weekCountSucceeded: 1,
        weekCountFailed: 0,
        weeks: [],
      })),
      buildArtifact: ({ plans }) => ({
        artifactSchemaVersion: 1,
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
    const base = paidDeps({ env: {} })

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
    expect(base.writeArtifactAtomic).toHaveBeenCalledTimes(2)
    expect(base.writeArtifactAtomic.mock.calls[0][1].plans).toHaveLength(1)
    expect(base.writeArtifactAtomic.mock.calls[1][1].plans).toHaveLength(2)
    expect(result.artifact.plans[0]).toMatchObject({
      caseId: 'one#1',
      outcome: 'failed',
      errorClass: 'run_threw',
    })
    expect(JSON.stringify(result.artifact)).not.toContain('provider leaked content')
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
