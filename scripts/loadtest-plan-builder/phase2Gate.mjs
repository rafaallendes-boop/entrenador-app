import {
  ARTIFACT_SCHEMA_VERSION,
  evaluateAcceptance,
  isCompletePlan,
} from './artifact.mjs'
import {
  ATTEMPTED_PLAN_TOTAL,
  TARGET_WEEK_TOTAL,
  describeManifest,
} from './manifest.mjs'

export const PHASE2_EXPECTED = Object.freeze({
  planCount: ATTEMPTED_PLAN_TOTAL,
  weekCount: TARGET_WEEK_TOTAL,
  scorableWeekCount: TARGET_WEEK_TOTAL,
  scenarioCount: 6,
  model: 'claude-sonnet-4-6',
  qualityVersion: 2,
  thinkingMode: 'disabled',
  efforts: Object.freeze(['high', 'medium', 'low']),
})

export const PHASE2_THRESHOLDS = Object.freeze({
  firstWeekRatioP50Max: 0.8,
  minImprovedCases: 10,
  minImprovedScenarios: 5,
  planCompleteRatioP50Max: 1.1,
  scoreDeltaP50Min: -2,
  scoreDeltaMin: -5,
  repairDeltaP50Max: 0,
  repairDeltaP90Max: 0,
})

const SHARED_DESCRIPTOR_FIELDS = [
  'provider',
  'model',
  'thinkingMode',
  'temperature',
  'maxTokens',
  'promptVersion',
  'schemaVersion',
  'qualityVersion',
  'concurrency',
]

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function exactlyObservedModel(plan, expectedModel) {
  return Array.isArray(plan.observedModels)
    && plan.observedModels.length === 1
    && plan.observedModels[0] === expectedModel
}

function structuralAcceptance(artifact) {
  try {
    return evaluateAcceptance(artifact)
  } catch (error) {
    return {
      accepted: false,
      reasons: [`artefacto ilegible: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

function isCompletePlanSafely(plan) {
  try {
    return isCompletePlan(plan)
  } catch {
    return false
  }
}

export function evaluatePhase2Variant(artifact, expected = PHASE2_EXPECTED) {
  const reasons = []
  const plans = Array.isArray(artifact?.plans) ? artifact.plans : []
  const completePlans = plans.filter(isCompletePlanSafely)
  const completeWeeks = completePlans.flatMap((plan) => plan.weeks ?? [])
  const structural = structuralAcceptance(artifact)

  if (!structural.accepted) {
    reasons.push(`aceptación estructural falló: ${structural.reasons.join('; ')}`)
  }
  if (artifact?.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    reasons.push(
      `artifactSchemaVersion ${String(artifact?.artifactSchemaVersion)} != ${ARTIFACT_SCHEMA_VERSION}`,
    )
  }
  if (!sameJson(artifact?.manifest, describeManifest())) {
    reasons.push('manifest distinto del manifest congelado de Fase 2')
  }
  if (plans.length !== expected.planCount) {
    reasons.push(`planes intentados ${plans.length}/${expected.planCount}`)
  }
  if (completePlans.length !== expected.planCount) {
    reasons.push(`planes completos ${completePlans.length}/${expected.planCount}`)
  }
  if (completeWeeks.length !== expected.weekCount) {
    reasons.push(`semanas completas ${completeWeeks.length}/${expected.weekCount}`)
  }
  const scorableWeeks = completeWeeks.filter((week) => week.scorable)
  if (scorableWeeks.length !== expected.scorableWeekCount) {
    reasons.push(`semanas puntuables ${scorableWeeks.length}/${expected.scorableWeekCount}`)
  }
  if (plans.some((plan) => plan.errorClass === 'harness_failure')) {
    reasons.push('la corrida contiene fallos del harness')
  }
  if (plans.some((plan) => plan.fallbackUsed)) {
    reasons.push('la corrida contiene al menos un fallback')
  }
  if (plans.some((plan) => !exactlyObservedModel(plan, expected.model))) {
    reasons.push(`al menos un plan observó un modelo distinto de ${expected.model}`)
  }
  if (plans.some((plan) => plan.qualityVersion !== expected.qualityVersion)
    || completeWeeks.some((week) => week.qualityVersion !== expected.qualityVersion)) {
    reasons.push(`qualityVersion de planes/semanas distinta de q${expected.qualityVersion}`)
  }

  if (artifact?.git?.dirty !== false) {
    reasons.push('git.dirty debe ser false')
  }
  if (!nonEmptyString(artifact?.git?.sha)) {
    reasons.push('git.sha debe estar presente')
  }

  const variant = artifact?.variant ?? {}
  if (variant.provider !== 'claude') {
    reasons.push(`provider ${String(variant.provider)} != claude`)
  }
  if (variant.model !== expected.model) {
    reasons.push(`modelo ${String(variant.model)} != ${expected.model}`)
  }
  if (variant.qualityVersion !== expected.qualityVersion) {
    reasons.push(`qualityVersion ${String(variant.qualityVersion)} != ${expected.qualityVersion}`)
  }
  if (variant.thinkingMode !== expected.thinkingMode) {
    reasons.push(`thinkingMode ${String(variant.thinkingMode)} != ${expected.thinkingMode}`)
  }
  if (!expected.efforts.includes(variant.effort)) {
    reasons.push(
      `effort ${String(variant.effort)} fuera de [${expected.efforts.join(', ')}]`,
    )
  }

  return { eligible: reasons.length === 0, reasons }
}

export function renderPhase2Eligibility(artifact, eligibility, expectedEffort) {
  const lines = [
    '== Elegibilidad estricta de Fase 2 ==',
    `variante: ${artifact?.variant?.variantId ?? 'desconocida'}`,
    `SHA: ${artifact?.git?.sha ?? 'n/a'}`,
    `effort esperado: ${expectedEffort}`,
    `RESULTADO: ${eligibility?.eligible ? 'ELEGIBLE' : 'NO ELEGIBLE'}`,
  ]
  for (const reason of eligibility?.reasons ?? []) lines.push(`  - ${reason}`)
  return lines.join('\n')
}

function comparisonArray(comparison, ...names) {
  for (const name of names) {
    if (Array.isArray(comparison?.[name])) return comparison[name]
  }
  return []
}

function comparisonCountIs(comparison, field, expected, reasons) {
  if (comparison?.[field] !== expected) {
    reasons.push(`${field} ${String(comparison?.[field])}/${expected}`)
  }
}

export function evaluatePhase2ComparisonEligibility(
  controlArtifact,
  variantArtifact,
  comparison,
  expected = PHASE2_EXPECTED,
) {
  const reasons = []
  const control = evaluatePhase2Variant(controlArtifact, {
    ...expected,
    efforts: ['high'],
  })
  const variant = evaluatePhase2Variant(variantArtifact, {
    ...expected,
    efforts: ['medium', 'low'],
  })
  reasons.push(...control.reasons.map((reason) => `control: ${reason}`))
  reasons.push(...variant.reasons.map((reason) => `variante: ${reason}`))

  if (nonEmptyString(controlArtifact?.git?.sha)
    && nonEmptyString(variantArtifact?.git?.sha)
    && controlArtifact.git.sha !== variantArtifact.git.sha) {
    reasons.push(`SHA distinto: control=${controlArtifact.git.sha}, variante=${variantArtifact.git.sha}`)
  }
  if (!sameJson(controlArtifact?.manifest, variantArtifact?.manifest)) {
    reasons.push('manifest distinto entre control y variante')
  }

  for (const field of SHARED_DESCRIPTOR_FIELDS) {
    if (!Object.is(controlArtifact?.variant?.[field], variantArtifact?.variant?.[field])) {
      reasons.push(`descriptor compartido distinto en ${field}`)
    }
  }
  if (controlArtifact?.variant?.effort === variantArtifact?.variant?.effort) {
    reasons.push('effort debe ser la única dimensión distinta y debe cambiar')
  }

  comparisonCountIs(comparison, 'planPairs', expected.planCount, reasons)
  comparisonCountIs(comparison, 'completePairs', expected.planCount, reasons)
  comparisonCountIs(comparison, 'weekPairs', expected.weekCount, reasons)
  comparisonCountIs(comparison, 'scorableWeekPairs', expected.scorableWeekCount, reasons)

  const nonEmptyCollections = [
    ['planes solo en control', comparisonArray(comparison, 'onlyControl')],
    ['planes solo en variante', comparisonArray(comparison, 'onlyVariant')],
    [
      'caseIds duplicados en control',
      comparisonArray(
        comparison,
        'duplicateControlCaseIds',
        'duplicateControlCases',
        'duplicateControl',
      ),
    ],
    [
      'caseIds duplicados en variante',
      comparisonArray(
        comparison,
        'duplicateVariantCaseIds',
        'duplicateVariantCases',
        'duplicateVariant',
      ),
    ],
    ['semanas sin contraparte', comparisonArray(comparison, 'unmatchedWeeks', 'unmatched')],
    ['semanas duplicadas', comparisonArray(comparison, 'duplicateWeeks', 'duplicates')],
  ]
  for (const [label, entries] of nonEmptyCollections) {
    if (entries.length > 0) reasons.push(`${label}: ${entries.length}`)
  }

  const scenarioDrift = comparisonArray(comparison, 'planDetails')
    .filter((row) => row.variantScenarioKey !== row.scenarioKey)
  if (scenarioDrift.length > 0) {
    reasons.push(`scenarioKey distinto dentro de ${scenarioDrift.length} pares`)
  }

  return { eligible: reasons.length === 0, reasons }
}

function check(id, actual, operator, threshold, passed) {
  return { id, actual: actual ?? null, operator, threshold, passed: Boolean(passed) }
}

function finiteAtMost(id, actual, threshold) {
  return check(id, actual, '<=', threshold, Number.isFinite(actual) && actual <= threshold)
}

function finiteAtLeast(id, actual, threshold) {
  return check(id, actual, '>=', threshold, Number.isFinite(actual) && actual >= threshold)
}

function exact(id, actual, expected) {
  return check(id, actual, '===', expected, actual === expected)
}

export function evaluatePhase2Decision(
  comparison,
  thresholds = PHASE2_THRESHOLDS,
  expected = PHASE2_EXPECTED,
) {
  const firstWeekReady = comparison?.firstWeekReady ?? {}
  const planComplete = comparison?.planComplete ?? {}
  const score = comparison?.score ?? {}
  const repairs = comparison?.repairs ?? {}
  const weeklyRepairs = repairs.weekCountRepairsV2 ?? {}
  const weeklyWarningInput = repairs.weekWarningInput ?? {}
  const planRepairs = repairs.planCountRepairsV2 ?? {}
  const scenarioRatios = firstWeekReady.byScenario ?? {}
  const scenarioEntries = Object.entries(scenarioRatios)

  const checks = [
    exact('firstWeekReady.n', firstWeekReady.n, expected.planCount),
    exact('firstWeekReady.totalCases', firstWeekReady.totalCases, expected.planCount),
    exact('firstWeekReady.totalScenarios', firstWeekReady.totalScenarios, expected.scenarioCount),
    exact('firstWeekReady.byScenario.count', scenarioEntries.length, expected.scenarioCount),
    ...scenarioEntries.map(([scenarioKey, summary]) =>
      exact(`firstWeekReady.byScenario.${scenarioKey}.n`, summary?.n, 2)),
    finiteAtMost(
      'firstWeekReady.p50',
      firstWeekReady.p50,
      thresholds.firstWeekRatioP50Max,
    ),
    finiteAtLeast(
      'firstWeekReady.improvedCases',
      firstWeekReady.improvedCases,
      thresholds.minImprovedCases,
    ),
    finiteAtLeast(
      'firstWeekReady.improvedScenarios',
      firstWeekReady.improvedScenarios,
      thresholds.minImprovedScenarios,
    ),
    exact('planComplete.n', planComplete.n, expected.planCount),
    finiteAtMost(
      'planComplete.p50',
      planComplete.p50,
      thresholds.planCompleteRatioP50Max,
    ),
    exact('score.n', score.n, expected.planCount),
    finiteAtLeast('score.p50', score.p50, thresholds.scoreDeltaP50Min),
    finiteAtLeast('score.min', score.min, thresholds.scoreDeltaMin),
    exact('weekCountRepairsV2.n', weeklyRepairs.n, expected.scorableWeekCount),
    finiteAtMost(
      'weekCountRepairsV2.p50',
      weeklyRepairs.p50,
      thresholds.repairDeltaP50Max,
    ),
    finiteAtMost(
      'weekCountRepairsV2.p90',
      weeklyRepairs.p90,
      thresholds.repairDeltaP90Max,
    ),
    exact('weekWarningInput.n', weeklyWarningInput.n, expected.scorableWeekCount),
    finiteAtMost(
      'weekWarningInput.p50',
      weeklyWarningInput.p50,
      thresholds.repairDeltaP50Max,
    ),
    finiteAtMost(
      'weekWarningInput.p90',
      weeklyWarningInput.p90,
      thresholds.repairDeltaP90Max,
    ),
    exact('planCountRepairsV2.n', planRepairs.n, expected.planCount),
    finiteAtMost(
      'planCountRepairsV2.p50',
      planRepairs.p50,
      thresholds.repairDeltaP50Max,
    ),
    finiteAtMost(
      'planCountRepairsV2.p90',
      planRepairs.p90,
      thresholds.repairDeltaP90Max,
    ),
  ]

  return {
    accepted: checks.every((entry) => entry.passed),
    checks,
  }
}
