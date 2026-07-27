import { isCompletePlan } from './artifact.mjs'
import { percentile } from './stats.mjs'

/**
 * Comparación PAREADA entre dos artefactos del loadtest.
 *
 * El principio está heredado del comentario de cabecera de `report.mjs`: la
 * diferencia de medianas NO es la mediana de las diferencias. Todo acá empareja
 * primero —planes por `caseId`, semanas por `(caseId, weekIndex)`— y recién
 * después resume la distribución de diferencias.
 */

function indexPlans(artifact) {
  const byCaseId = new Map()
  const duplicates = new Set()
  for (const plan of artifact.plans ?? []) {
    if (byCaseId.has(plan.caseId)) {
      duplicates.add(plan.caseId)
    } else {
      byCaseId.set(plan.caseId, plan)
    }
  }
  return { byCaseId, duplicates }
}

export function pairPlans(controlArtifact, variantArtifact) {
  const controlIndex = indexPlans(controlArtifact)
  const variantIndex = indexPlans(variantArtifact)
  const control = controlIndex.byCaseId
  const variant = variantIndex.byCaseId

  const pairs = []
  const onlyControl = []
  for (const [caseId, controlPlan] of control) {
    const variantPlan = variant.get(caseId)
    if (!variantPlan) {
      onlyControl.push(caseId)
      continue
    }
    // Un caseId ambiguo no es un par: elegir una de sus ocurrencias haría que
    // la comparación dependiera silenciosamente del orden del artefacto.
    if (controlIndex.duplicates.has(caseId) || variantIndex.duplicates.has(caseId)) continue
    pairs.push({
      caseId,
      scenarioKey: controlPlan.scenarioKey,
      control: controlPlan,
      variant: variantPlan,
    })
  }

  const onlyVariant = []
  for (const caseId of variant.keys()) {
    if (!control.has(caseId)) onlyVariant.push(caseId)
  }

  pairs.sort((a, b) => a.caseId.localeCompare(b.caseId))
  return {
    pairs,
    onlyControl: onlyControl.sort(),
    onlyVariant: onlyVariant.sort(),
    duplicateControl: [...controlIndex.duplicates].sort(),
    duplicateVariant: [...variantIndex.duplicates].sort(),
  }
}

function indexWeeks(plan) {
  const byWeekIndex = new Map()
  const duplicates = new Set()
  for (const week of plan.weeks ?? []) {
    if (byWeekIndex.has(week.weekIndex)) {
      duplicates.add(week.weekIndex)
    } else {
      byWeekIndex.set(week.weekIndex, week)
    }
  }
  return { byWeekIndex, duplicates }
}

export function pairWeeks(controlArtifact, variantArtifact) {
  const { pairs: planPairs } = pairPlans(controlArtifact, variantArtifact)
  const pairs = []
  const unmatched = []
  const duplicates = []

  for (const planPair of planPairs) {
    const controlIndex = indexWeeks(planPair.control)
    const variantIndex = indexWeeks(planPair.variant)
    const controlWeeks = controlIndex.byWeekIndex
    const variantWeeks = variantIndex.byWeekIndex

    for (const weekIndex of controlIndex.duplicates) {
      duplicates.push({ caseId: planPair.caseId, weekIndex, side: 'control' })
    }
    for (const weekIndex of variantIndex.duplicates) {
      duplicates.push({ caseId: planPair.caseId, weekIndex, side: 'variant' })
    }

    for (const [weekIndex, controlWeek] of controlWeeks) {
      const variantWeek = variantWeeks.get(weekIndex)
      if (!variantWeek) {
        unmatched.push({ caseId: planPair.caseId, weekIndex, side: 'control' })
        continue
      }
      if (controlIndex.duplicates.has(weekIndex) || variantIndex.duplicates.has(weekIndex)) continue
      pairs.push({
        caseId: planPair.caseId,
        scenarioKey: planPair.scenarioKey,
        weekIndex,
        control: controlWeek,
        variant: variantWeek,
      })
    }

    for (const weekIndex of variantWeeks.keys()) {
      if (!controlWeeks.has(weekIndex)) {
        unmatched.push({ caseId: planPair.caseId, weekIndex, side: 'variant' })
      }
    }
  }

  const byKey = (a, b) => (
    a.caseId.localeCompare(b.caseId)
    || a.weekIndex - b.weekIndex
    || a.side.localeCompare(b.side)
  )
  pairs.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.weekIndex - b.weekIndex)
  unmatched.sort(byKey)
  duplicates.sort(byKey)
  return { pairs, unmatched, duplicates }
}

function ratio(variantValue, controlValue) {
  if (!Number.isFinite(variantValue) || !Number.isFinite(controlValue)) return null
  if (controlValue === 0) return null
  return variantValue / controlValue
}

function delta(variantValue, controlValue) {
  if (!Number.isFinite(variantValue) || !Number.isFinite(controlValue)) return null
  return variantValue - controlValue
}

function summarizeRatios(values) {
  const numeric = values.filter((value) => Number.isFinite(value))
  return {
    n: numeric.length,
    p50: percentile(numeric, 0.5),
    ratios: numeric.slice().sort((a, b) => a - b),
  }
}

function summarizeDeltas(values) {
  const numeric = values.filter((value) => Number.isFinite(value))
  return {
    n: numeric.length,
    p50: percentile(numeric, 0.5),
    // Con n=12 el p90 nearest-rank ES el segundo peor; el gate lo presenta con
    // ese nombre para no sugerir una precisión estadística que la muestra no da.
    p90: percentile(numeric, 0.9),
    min: numeric.length === 0 ? null : Math.min(...numeric),
    max: numeric.length === 0 ? null : Math.max(...numeric),
    deltas: numeric.slice().sort((a, b) => a - b),
  }
}

function summarizePairedTotals(pairs, field) {
  const numericPairs = pairs
    .map((pair) => ({
      control: pair.control[field],
      variant: pair.variant[field],
      delta: delta(pair.variant[field], pair.control[field]),
    }))
    .filter((pair) => pair.delta !== null)
  const deltaSummary = summarizeDeltas(numericPairs.map((pair) => pair.delta))
  // Un total parcial no es un total comparable. Mantener `n`/deltas para
  // diagnóstico, pero nunca hacer que 11 casos parezcan más baratos que 12.
  if (numericPairs.length === 0 || numericPairs.length !== pairs.length) {
    return { control: null, variant: null, delta: null, ...deltaSummary }
  }
  const control = numericPairs.reduce((sum, pair) => sum + pair.control, 0)
  const variant = numericPairs.reduce((sum, pair) => sum + pair.variant, 0)
  return { control, variant, delta: variant - control, ...deltaSummary }
}

function planRepairTotal(plan) {
  return (plan.weeks ?? [])
    .filter((week) => week.scorable)
    .reduce((sum, week) => sum + (week.countRepairsV2 ?? 0), 0)
}

function weekWarningInput(week) {
  return (week.correctiveActionCount ?? 0) + (week.structuralActionCount ?? 0)
}

function ratiosFor(pairs, field) {
  return pairs.map((pair) => ratio(pair.variant[field], pair.control[field]))
}

function scoreDeltasFor(pairs) {
  return pairs.map((pair) => delta(pair.variant.planScore, pair.control.planScore))
}

function repairSummaries(planPairs, weekPairs) {
  const scorableWeekPairs = weekPairs.filter(
    (pair) => pair.control.scorable && pair.variant.scorable,
  )
  return {
    weekCountRepairsV2: summarizeDeltas(scorableWeekPairs.map(
      (pair) => delta(pair.variant.countRepairsV2, pair.control.countRepairsV2),
    )),
    weekWarningInput: summarizeDeltas(scorableWeekPairs.map(
      (pair) => delta(weekWarningInput(pair.variant), weekWarningInput(pair.control)),
    )),
    planCountRepairsV2: summarizeDeltas(planPairs.map(
      (pair) => delta(planRepairTotal(pair.variant), planRepairTotal(pair.control)),
    )),
  }
}

function rawPair(pair, field) {
  return { control: pair.control[field] ?? null, variant: pair.variant[field] ?? null }
}

function ratioPair(pair, field) {
  return { ...rawPair(pair, field), ratio: ratio(pair.variant[field], pair.control[field]) }
}

function deltaPair(pair, field) {
  return { ...rawPair(pair, field), delta: delta(pair.variant[field], pair.control[field]) }
}

function buildPlanDetails(planPairs) {
  return planPairs.map((pair) => ({
    caseId: pair.caseId,
    scenarioKey: pair.scenarioKey,
    variantScenarioKey: pair.variant.scenarioKey,
    complete: {
      control: isCompletePlan(pair.control),
      variant: isCompletePlan(pair.variant),
    },
    firstWeekReady: ratioPair(pair, 'firstWeekReadyMs'),
    firstWeekReadyE2E: ratioPair(pair, 'firstWeekReadyE2eMs'),
    planComplete: ratioPair(pair, 'planCompleteMs'),
    planScore: deltaPair(pair, 'planScore'),
    planGrade: rawPair(pair, 'planGrade'),
    issueCodes: rawPair(pair, 'issueCodes'),
    estimatedCostUsd: deltaPair(pair, 'estimatedCostUsd'),
    totalInputTokens: deltaPair(pair, 'totalInputTokens'),
    totalOutputTokens: deltaPair(pair, 'totalOutputTokens'),
    retryCount: deltaPair(pair, 'retryCount'),
    fallbackUsed: rawPair(pair, 'fallbackUsed'),
    observedModels: rawPair(pair, 'observedModels'),
    outcome: rawPair(pair, 'outcome'),
    errorClass: rawPair(pair, 'errorClass'),
  }))
}

function buildScenarioSummary(completePairs, weekPairs) {
  const summaries = {}
  const scenarioKeys = [...new Set(completePairs.map((pair) => pair.scenarioKey))].sort()
  for (const scenarioKey of scenarioKeys) {
    const scenarioPlans = completePairs.filter((pair) => pair.scenarioKey === scenarioKey)
    const scenarioWeeks = weekPairs.filter((pair) => pair.scenarioKey === scenarioKey)
    const firstWeekReady = summarizeRatios(ratiosFor(scenarioPlans, 'firstWeekReadyMs'))
    const firstWeekReadyE2E = summarizeRatios(ratiosFor(scenarioPlans, 'firstWeekReadyE2eMs'))
    summaries[scenarioKey] = {
      planPairs: scenarioPlans.length,
      weekPairs: scenarioWeeks.length,
      firstWeekReady: {
        ...firstWeekReady,
        meanRatio: firstWeekReady.n === 0
          ? null
          : firstWeekReady.ratios.reduce((sum, value) => sum + value, 0) / firstWeekReady.n,
      },
      firstWeekReadyE2E,
      planComplete: summarizeRatios(ratiosFor(scenarioPlans, 'planCompleteMs')),
      score: summarizeDeltas(scoreDeltasFor(scenarioPlans)),
      repairs: repairSummaries(scenarioPlans, scenarioWeeks),
      cost: summarizePairedTotals(scenarioPlans, 'estimatedCostUsd'),
      totalInputTokens: summarizePairedTotals(scenarioPlans, 'totalInputTokens'),
      totalOutputTokens: summarizePairedTotals(scenarioPlans, 'totalOutputTokens'),
      retryCount: summarizePairedTotals(scenarioPlans, 'retryCount'),
    }
    summaries[scenarioKey].firstWeekReady.improved
      = summaries[scenarioKey].firstWeekReady.meanRatio !== null
        && summaries[scenarioKey].firstWeekReady.meanRatio < 1
  }
  return summaries
}

/**
 * Resumen pareado completo. Los deltas y ratios crudos viajan en cada bloque
 * para que el reporte pueda mostrar el detalle por caso sin recomputar nada.
 */
export function buildComparison(controlArtifact, variantArtifact) {
  const planPairing = pairPlans(controlArtifact, variantArtifact)
  const weekPairing = pairWeeks(controlArtifact, variantArtifact)
  const { pairs: planPairs, onlyControl, onlyVariant } = planPairing
  const { pairs: weekPairs, unmatched, duplicates: duplicateWeeks } = weekPairing

  const completePairs = planPairs.filter(
    (pair) => isCompletePlan(pair.control) && isCompletePlan(pair.variant),
  )
  const scorableWeekPairs = weekPairs.filter(
    (pair) => pair.control.scorable && pair.variant.scorable,
  )
  const byScenario = buildScenarioSummary(completePairs, weekPairs)
  const firstWeekReady = summarizeRatios(ratiosFor(completePairs, 'firstWeekReadyMs'))
  const firstWeekReadyE2E = summarizeRatios(ratiosFor(completePairs, 'firstWeekReadyE2eMs'))

  return {
    planPairs: planPairs.length,
    completePairs: completePairs.length,
    weekPairs: weekPairs.length,
    scorableWeekPairs: scorableWeekPairs.length,
    onlyControl,
    onlyVariant,
    duplicateControlCases: planPairing.duplicateControl,
    duplicateVariantCases: planPairing.duplicateVariant,
    unmatchedWeeks: unmatched,
    duplicateWeeks,
    firstWeekReady: {
      ...firstWeekReady,
      improvedCases: firstWeekReady.ratios.filter((value) => value < 1).length,
      totalCases: firstWeekReady.n,
      byScenario: Object.fromEntries(
        Object.entries(byScenario).map(([key, value]) => [key, value.firstWeekReady]),
      ),
      improvedScenarios: Object.values(byScenario)
        .filter((scenario) => scenario.firstWeekReady.improved).length,
      totalScenarios: Object.keys(byScenario).length,
    },
    firstWeekReadyE2E,
    planComplete: {
      ...summarizeRatios(ratiosFor(completePairs, 'planCompleteMs')),
      byScenario: Object.fromEntries(
        Object.entries(byScenario).map(([key, value]) => [key, value.planComplete]),
      ),
    },
    score: summarizeDeltas(scoreDeltasFor(completePairs)),
    repairs: repairSummaries(completePairs, weekPairs),
    cost: summarizePairedTotals(completePairs, 'estimatedCostUsd'),
    totalInputTokens: summarizePairedTotals(completePairs, 'totalInputTokens'),
    totalOutputTokens: summarizePairedTotals(completePairs, 'totalOutputTokens'),
    retryCount: summarizePairedTotals(completePairs, 'retryCount'),
    byScenario,
    planDetails: buildPlanDetails(planPairs),
  }
}

function formatValue(value) {
  if (value === null || value === undefined) return 'n/a'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    return value.toFixed(4).replace(/\.?0+$/, '')
  }
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function formatSummary(name, summary, fields) {
  const values = fields.map((field) => `${field}=${formatValue(summary?.[field])}`)
  return `${name}: ${values.join(' · ')}`
}

/**
 * Render de auditoría. Consume únicamente el resultado pareado; no vuelve a
 * calcular ratios ni deltas a partir de agregados.
 */
export function renderComparison(
  controlArtifact,
  variantArtifact,
  comparison,
  eligibility,
  decision,
) {
  const lines = [
    '== Comparación pareada de Fase 2 ==',
    `control: ${controlArtifact?.variant?.variantId ?? 'desconocido'} · SHA ${controlArtifact?.git?.sha ?? 'n/a'}`,
    `variante: ${variantArtifact?.variant?.variantId ?? 'desconocido'} · SHA ${variantArtifact?.git?.sha ?? 'n/a'}`,
    `pares: planes=${formatValue(comparison?.planPairs)} · completos=${formatValue(comparison?.completePairs)} · semanas=${formatValue(comparison?.weekPairs)} · semanas puntuables=${formatValue(comparison?.scorableWeekPairs)}`,
    `integridad: soloControl=${formatValue(comparison?.onlyControl ?? [])} · soloVariante=${formatValue(comparison?.onlyVariant ?? [])} · duplicadosControl=${formatValue(comparison?.duplicateControlCases ?? [])} · duplicadosVariante=${formatValue(comparison?.duplicateVariantCases ?? [])} · semanasSinPar=${formatValue(comparison?.unmatchedWeeks ?? [])} · semanasDuplicadas=${formatValue(comparison?.duplicateWeeks ?? [])}`,
    '',
    `elegibilidad: ${eligibility?.eligible ? 'OK' : 'NO ELEGIBLE'}`,
  ]
  for (const reason of eligibility?.reasons ?? []) lines.push(`  - ${reason}`)

  lines.push(
    '',
    'métricas pareadas:',
    `  ${formatSummary('firstWeekReady', comparison?.firstWeekReady, ['n', 'p50', 'improvedCases', 'improvedScenarios'])}`,
    `  ${formatSummary('firstWeekReadyE2E', comparison?.firstWeekReadyE2E, ['n', 'p50'])}`,
    `  ${formatSummary('planComplete', comparison?.planComplete, ['n', 'p50'])}`,
    `  ${formatSummary('score', comparison?.score, ['n', 'p50', 'min'])}`,
    `  ${formatSummary('repairs.weekCountRepairsV2', comparison?.repairs?.weekCountRepairsV2, ['n', 'p50', 'p90'])}`,
    `  ${formatSummary('repairs.weekWarningInput', comparison?.repairs?.weekWarningInput, ['n', 'p50', 'p90'])}`,
    `  ${formatSummary('repairs.planCountRepairsV2', comparison?.repairs?.planCountRepairsV2, ['n', 'p50', 'p90'])}`,
    `  ${formatSummary('cost', comparison?.cost, ['n', 'control', 'variant', 'delta'])}`,
    `  ${formatSummary('totalInputTokens', comparison?.totalInputTokens, ['n', 'control', 'variant', 'delta'])}`,
    `  ${formatSummary('totalOutputTokens', comparison?.totalOutputTokens, ['n', 'control', 'variant', 'delta'])}`,
    `  ${formatSummary('retryCount', comparison?.retryCount, ['n', 'control', 'variant', 'delta'])}`,
    '',
    'por escenario:',
  )
  const scenarios = Object.entries(comparison?.byScenario ?? {})
  if (scenarios.length === 0) lines.push('  n/a')
  for (const [scenarioKey, summary] of scenarios) {
    lines.push(
      `  ${scenarioKey}: planes=${formatValue(summary.planPairs)} · semanas=${formatValue(summary.weekPairs)} · firstWeekMeanRatio=${formatValue(summary.firstWeekReady?.meanRatio)} · firstWeekP50=${formatValue(summary.firstWeekReady?.p50)} · firstWeekE2EP50=${formatValue(summary.firstWeekReadyE2E?.p50)} · planCompleteP50=${formatValue(summary.planComplete?.p50)} · scoreDeltaP50=${formatValue(summary.score?.p50)} · repairWeekP90=${formatValue(summary.repairs?.weekCountRepairsV2?.p90)} · warningInputP90=${formatValue(summary.repairs?.weekWarningInput?.p90)} · repairPlanSecondWorst=${formatValue(summary.repairs?.planCountRepairsV2?.p90)} · costoDelta=${formatValue(summary.cost?.delta)} · inputTokensDelta=${formatValue(summary.totalInputTokens?.delta)} · outputTokensDelta=${formatValue(summary.totalOutputTokens?.delta)} · retryDelta=${formatValue(summary.retryCount?.delta)}`,
    )
  }

  lines.push('', 'detalle por caseId:')
  const details = comparison?.planDetails ?? []
  if (details.length === 0) lines.push('  n/a')
  for (const row of details) {
    lines.push(
      `  ${row.caseId} (${row.scenarioKey}): firstWeek=${formatValue(row.firstWeekReady)} · firstWeekE2E=${formatValue(row.firstWeekReadyE2E)} · planComplete=${formatValue(row.planComplete)} · score=${formatValue(row.planScore)} · grade=${formatValue(row.planGrade)} · issues=${formatValue(row.issueCodes)} · cost=${formatValue(row.estimatedCostUsd)} · inputTokens=${formatValue(row.totalInputTokens)} · outputTokens=${formatValue(row.totalOutputTokens)} · retries=${formatValue(row.retryCount)} · fallback=${formatValue(row.fallbackUsed)} · models=${formatValue(row.observedModels)} · outcome=${formatValue(row.outcome)} · error=${formatValue(row.errorClass)}`,
    )
  }

  lines.push('', 'checks de la regla:')
  for (const entry of decision?.checks ?? []) {
    lines.push(
      `  [${entry.passed ? 'ok' : 'FALLA'}] ${entry.id}: ${formatValue(entry.actual)} ${entry.operator} ${formatValue(entry.threshold)}`,
    )
  }
  const accepted = eligibility?.eligible === true && decision?.accepted === true
  lines.push('', `VEREDICTO: ${accepted ? 'ACEPTADA' : 'RECHAZADA'}`)
  return lines.join('\n')
}
