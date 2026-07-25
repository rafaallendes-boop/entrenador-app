import { ARTIFACT_SCHEMA_VERSION, isCompletePlan } from './artifact.mjs'
import { summarizeDistribution, summarizeLatency } from './stats.mjs'

/**
 * Incluye `firstWeekDetectionLagMs` como métrica de primera clase: es la
 * diferencia PAREADA por plan entre descubrimiento y semana lista. Restar la
 * mediana de `firstWeekDetectedMs` menos la de `firstWeekReadyMs` NO da eso —
 * la diferencia de medianas no es la mediana de las diferencias— y en el primer
 * control esa resta daba justo el máximo de la distribución, no su centro.
 *
 * Se agrega solo acá, no a `latencySummary` del artefacto: el reporte lo deriva
 * de `plans[]`, que ya lo trae en todo artefacto v1, así que el control ya
 * pagado gana el resumen sin reescribir su archivo ni mover el schema.
 */
const LATENCY_METRICS = [
  'firstWeekReadyMs',
  'firstWeekDetectedMs',
  'firstWeekDetectionLagMs',
  'planCompleteMs',
  'terminalMs',
]

function latencyCohort(plans) {
  const cohort = {}
  for (const metric of LATENCY_METRICS) {
    cohort[metric] = summarizeLatency(plans.map((plan) => plan[metric]))
  }
  return cohort
}

function repairBlock(completePlans) {
  const scorableWeeks = completePlans.flatMap((plan) => plan.weeks.filter((week) => week.scorable))
  return {
    weekCountRepairsV2: summarizeDistribution(scorableWeeks.map((week) => week.countRepairsV2)),
    planCountRepairsV2: summarizeDistribution(completePlans.map((plan) => plan.weeks
      .filter((week) => week.scorable)
      .reduce((sum, week) => sum + (week.countRepairsV2 ?? 0), 0))),
    weekWarningInput: summarizeDistribution(scorableWeeks.map((week) =>
      (week.correctiveActionCount ?? 0) + (week.structuralActionCount ?? 0))),
  }
}

/**
 * El reporte DESCRIBE, no propone: no emite divisor ni umbral calculado. §5.3
 * prohíbe recalibrar por variante y una derivación automática invita a eso.
 */
export function buildReport(artifact) {
  // Interpretar un artefacto de otro schema en silencio produciría números que
  // parecen comparables y no lo son.
  if (artifact.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`artifactSchemaVersion ${artifact.artifactSchemaVersion} incompatible; este reporte lee ${ARTIFACT_SCHEMA_VERSION}.`)
  }

  // MISMA cohorte que usan el artefacto y la aceptación (`isCompletePlan`). Un
  // `outcome === 'succeeded'` suelto dejaría entrar a la calibración planes con
  // conteos o semanas incoherentes que la aceptación ya rechazó.
  const completePlans = artifact.plans.filter(isCompletePlan)
  // Todas las semanas escritas, no solo las de planes completos: una semana de
  // un plan que después falló igual tiene latencia real que medir.
  const allWeeks = artifact.plans.flatMap((plan) => plan.weeks)

  return {
    latency: {
      allAttempts: latencyCohort(artifact.plans),
      completePlans: latencyCohort(completePlans),
    },
    /** Desglose secundario: latencia por semana, no por plan. */
    weeklyLatency: {
      durationMs: summarizeLatency(allWeeks.map((week) => week.durationMs)),
      wallClockMs: summarizeLatency(allWeeks.map((week) => week.wallClockMs)),
    },
    repair: repairBlock(completePlans),
    byScenario: Object.fromEntries(
      [...new Set(artifact.plans.map((plan) => plan.scenarioKey))].map((scenarioKey) => [
        scenarioKey,
        repairBlock(completePlans.filter((plan) => plan.scenarioKey === scenarioKey)),
      ]),
    ),
    caveat: `Caveat estadístico: con n=${completePlans.length} planes completos, p95 y p99 de plan son prácticamente el máximo observado. Baseline inicial conservadora, no un p95 estable. Comparar variantes exige repetir el mismo manifest congelado.`,
  }
}

function formatLatency(label, summary) {
  const nulls = summary.nullCount > 0 ? ` (nulls excluidos: ${summary.nullCount})` : ''
  return `    ${label}: n=${summary.n} p50=${summary.p50 ?? '—'} p95=${summary.p95 ?? '—'}${nulls}`
}

function formatDistribution(label, summary) {
  return `    ${label}: n=${summary.n} p50=${summary.p50 ?? '—'} p90=${summary.p90 ?? '—'} p99=${summary.p99 ?? '—'} max=${summary.max ?? '—'} hist=${JSON.stringify(summary.histogram)}`
}

export function renderReport(report) {
  const lines = ['=== Latencia por plan (ms) ===']
  for (const [cohort, metrics] of Object.entries(report.latency)) {
    lines.push(`  ${cohort}:`)
    for (const [metric, summary] of Object.entries(metrics)) {
      lines.push(formatLatency(metric, summary))
    }
  }

  lines.push('', '=== Distribuciones de reparación ===')
  lines.push(formatDistribution('countRepairsV2 por semana puntuable', report.repair.weekCountRepairsV2))
  lines.push(formatDistribution('countRepairsV2 por plan completo', report.repair.planCountRepairsV2))
  lines.push(formatDistribution('corrective+structural por semana (warning)', report.repair.weekWarningInput))

  lines.push('', '  Latencia por semana (secundario):')
  lines.push(formatLatency('durationMs (proveedor, todos los intentos)', report.weeklyLatency.durationMs))
  lines.push(formatLatency('wallClockMs (escritura a escritura)', report.weeklyLatency.wallClockMs))

  lines.push('', '  Por escenario:')
  for (const [scenarioKey, block] of Object.entries(report.byScenario)) {
    lines.push(`    ${scenarioKey}:`)
    lines.push(formatDistribution('  semana countRepairsV2', block.weekCountRepairsV2))
    lines.push(formatDistribution('  plan countRepairsV2', block.planCountRepairsV2))
    lines.push(formatDistribution('  semana corrective+structural', block.weekWarningInput))
  }

  lines.push('', report.caveat)
  return lines.join('\n')
}
