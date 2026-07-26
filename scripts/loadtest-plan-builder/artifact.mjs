import {
  ATTEMPTED_PLAN_TOTAL,
  MANIFEST_VERSION,
  TARGET_WEEK_TOTAL,
  describeManifest,
} from './manifest.mjs'
import { summarizeLatency } from './stats.mjs'

export const ARTIFACT_SCHEMA_VERSION = 1

const LATENCY_METRICS = ['firstWeekReadyMs', 'firstWeekDetectedMs', 'planCompleteMs', 'terminalMs']

const MIN_COMPLETE_PLANS = 10
const MIN_SCORABLE_WEEKS = 30
const MAX_SCORABLE_WEEKS = 50

function isScorableWeek(week) {
  const ready = week.status === 'draft' || week.status === 'accepted'
  const countRepairsV2 = week.countRepairsV2
  return ready
    && week.repairTaxonomyVersion === 2
    && typeof countRepairsV2 === 'number'
    && Number.isFinite(countRepairsV2)
    && countRepairsV2 >= 0
}

function inspectWeekIndexes(plan) {
  const weekCountIsValid = Number.isInteger(plan.weekCount) && plan.weekCount >= 0
  const indexes = plan.weeks.map((week) => week.weekIndex)
  const uniqueIndexes = new Set(indexes)
  const hasDuplicates = uniqueIndexes.size !== indexes.length
  const hasOutOfRange = !weekCountIsValid || indexes.some((weekIndex) =>
    !Number.isInteger(weekIndex)
    || weekIndex < 0
    || weekIndex >= plan.weekCount)
  const isExact = weekCountIsValid
    && !hasDuplicates
    && !hasOutOfRange
    && indexes.length === plan.weekCount
    && Array.from({ length: plan.weekCount }, (_, weekIndex) =>
      uniqueIndexes.has(weekIndex)).every(Boolean)

  return { hasDuplicates, hasOutOfRange, isExact }
}

function isReadyWeekRow(week) {
  return (week.status === 'draft' || week.status === 'accepted')
    && typeof week.sessionCount === 'number'
    && Number.isFinite(week.sessionCount)
    && week.sessionCount > 0
}

/**
 * Cohorte de calibración. Se exporta a propósito: el reporte DEBE usar esta
 * misma definición. Si el reporte reimplementa "plan completo" con el `outcome`
 * suelto, las distribuciones que alimentan la elección del umbral incluyen
 * planes que la aceptación descartó por incoherentes, y el mismo artefacto
 * imprime dos caveats con distinto n.
 */
export function isCompletePlan(plan) {
  if (plan.outcome !== 'succeeded') return false
  return plan.weekCountSucceeded === plan.weekCount
    && plan.weekCountFailed === 0
    && inspectWeekIndexes(plan).isExact
    && plan.weeks.every(isReadyWeekRow)
}

function duplicatesOf(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    else seen.add(value)
  }
  return [...duplicates]
}

/**
 * Allowlist EXPLÍCITA por semana. Nunca copiar la semana entera ni excluir por
 * lista negra: un campo nuevo del dominio no debe poder filtrarse al artefacto
 * por olvido, y `sessions` contiene contenido generado.
 */
export function toWeekRow(week, context) {
  const meta = week.generationMeta ?? {}
  const countRepairsV2 = context.countRepairsV2 ?? null
  const scorable = isScorableWeek({
    status: week.status,
    repairTaxonomyVersion: meta.repairTaxonomyVersion,
    countRepairsV2,
  })
  return {
    weekIndex: week.weekIndex,
    scenarioKey: context.scenarioKey,
    status: week.status,
    scorable,
    attempts: meta.attempts ?? 0,
    errorClass: meta.errorClass ?? null,
    repairTaxonomyVersion: meta.repairTaxonomyVersion ?? null,
    qualityVersion: meta.qualityVersion ?? context.qualityVersion ?? null,
    countRepairsV2,
    correctiveActionCount: meta.correctiveActionCount ?? 0,
    structuralActionCount: meta.structuralActionCount ?? 0,
    movedSessionCount: meta.movedSessionCount ?? 0,
    droppedSessionCount: meta.droppedSessionCount ?? 0,
    hydrationActionCount: meta.hydrationActionCount ?? 0,
    addedFallbackCount: meta.addedFallbackCount ?? 0,
    filteredSportCount: meta.filteredSportCount ?? 0,
    sessionCount: Array.isArray(week.sessions) ? week.sessions.length : 0,
    // Tamaños, no contenido (spec §3.5). `*Chars` se instrumenta alrededor de
    // `callLLM`; `durationMs` acumula todos los intentos de la semana y
    // `wallClockMs` sale de las marcas de tiempo del writer.
    promptChars: context.promptChars ?? null,
    responseChars: context.responseChars ?? null,
    promptTokens: context.promptTokens ?? null,
    completionTokens: context.completionTokens ?? null,
    durationMs: context.durationMs ?? null,
    wallClockMs: context.wallClockMs ?? null,
    score: context.score ?? null,
    grade: context.grade ?? null,
  }
}

/** Claves permitidas en una fila de semana ya construida. */
const WEEK_ROW_KEYS = Object.keys(toWeekRow(
  { weekIndex: 0, status: 'pending', sessions: [], generationMeta: {} },
  { scenarioKey: '' },
))

/**
 * Segunda pasada de allowlist sobre semanas ya materializadas. `toPlanRow`
 * recibe `weeks` de un caller: sin este pick, un `weeks[0].promptText` entraría
 * intacto al artefacto aunque la raíz del plan esté saneada.
 */
function pickWeekRow(week) {
  const picked = {}
  for (const key of WEEK_ROW_KEYS) picked[key] = week[key] ?? null
  // Nunca confiar en el booleano del caller: se deriva nuevamente de los tres
  // campos allowlisteados que hacen que la semana sea realmente puntuable.
  picked.scorable = isScorableWeek(picked)
  return picked
}

/** Allowlist explícita por plan. Mismo criterio que `toWeekRow`. */
export function toPlanRow(runResult) {
  return {
    caseId: runResult.caseId,
    scenarioKey: runResult.scenarioKey,
    weekCount: runResult.weekCount,
    outcome: runResult.outcome,
    weekCountSucceeded: runResult.weekCountSucceeded,
    weekCountFailed: runResult.weekCountFailed,
    firstWeekReadyMs: runResult.firstWeekReadyMs ?? null,
    firstWeekReadyE2eMs: runResult.firstWeekReadyE2eMs ?? null,
    firstWeekDetectedMs: runResult.firstWeekDetectedMs ?? null,
    firstWeekDetectionLagMs: runResult.firstWeekDetectionLagMs ?? null,
    planCompleteMs: runResult.planCompleteMs ?? null,
    terminalMs: runResult.terminalMs ?? null,
    totalInputTokens: runResult.totalInputTokens ?? 0,
    totalOutputTokens: runResult.totalOutputTokens ?? 0,
    totalCacheReadTokens: runResult.totalCacheReadTokens ?? 0,
    totalCacheCreationTokens: runResult.totalCacheCreationTokens ?? 0,
    estimatedCostUsd: runResult.estimatedCostUsd ?? null,
    retryCount: runResult.retryCount ?? 0,
    fallbackUsed: Boolean(runResult.fallbackUsed),
    observedModels: runResult.observedModels ?? [],
    qualityVersion: runResult.qualityVersion ?? null,
    planScore: runResult.planScore ?? null,
    planGrade: runResult.planGrade ?? null,
    issueCodes: runResult.issueCodes ?? [],
    // Código, no texto: el mensaje crudo del proveedor puede citar contenido.
    errorClass: runResult.errorClass ?? null,
    promptChars: runResult.promptChars ?? null,
    responseChars: runResult.responseChars ?? null,
    weeks: (runResult.weeks ?? []).map(pickWeekRow),
  }
}

function latencyCohortSummary(plans) {
  const cohort = {}
  for (const metric of LATENCY_METRICS) {
    cohort[metric] = summarizeLatency(plans.map((plan) => plan[metric]))
  }
  return cohort
}

function pickGit(git = {}) {
  return {
    sha: git.sha ?? null,
    dirty: git.dirty ?? null,
  }
}

function pickVariant(variant = {}) {
  return {
    provider: variant.provider ?? null,
    model: variant.model ?? null,
    effort: variant.effort ?? null,
    thinkingMode: variant.thinkingMode ?? null,
    temperature: variant.temperature ?? null,
    maxTokens: variant.maxTokens ?? null,
    promptVersion: variant.promptVersion ?? null,
    schemaVersion: variant.schemaVersion ?? null,
    qualityVersion: variant.qualityVersion ?? null,
    concurrency: variant.concurrency ?? null,
    variantId: variant.variantId ?? null,
  }
}

export function buildArtifact(input) {
  // Las allowlists se re-aplican SIEMPRE en la frontera final: un caller no
  // puede colar campos por traer objetos que ya parezcan filas o metadatos.
  const plans = input.plans.map((plan) => toPlanRow(plan))
  const completePlans = plans.filter(isCompletePlan)

  return {
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    manifestVersion: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    git: pickGit(input.git),
    variant: pickVariant(input.variant),
    attemptedPlanTarget: ATTEMPTED_PLAN_TOTAL,
    targetWeekTarget: TARGET_WEEK_TOTAL,
    // El manifest embebido —con perfil y wizard config— es lo que permite a
    // Entrega 2 reconstruir qué configuración produjo la muestra. Una versión
    // numérica sola no alcanza.
    manifest: describeManifest(),
    latencySummary: {
      allAttempts: latencyCohortSummary(plans),
      completePlans: latencyCohortSummary(completePlans),
    },
    caveat: `Caveat estadístico: con n=${completePlans.length} planes completos, p95 y p99 de plan son prácticamente el máximo observado. Baseline inicial conservadora, no un p95 estable.`,
    plans,
  }
}

/**
 * Las cinco condiciones van juntas (spec §3.3). Las dos primeras existen para
 * que una interrupción tras 10 planes exitosos no apruebe un control que jamás
 * intentó los doce casos del manifest: tolerar fallos del proveedor no es lo
 * mismo que tolerar una muestra sesgada por casos nunca intentados.
 */
export function evaluateAcceptance(artifact) {
  const attemptedPlans = artifact.plans.length
  const completePlanRows = artifact.plans.filter(isCompletePlan)
  const completePlans = completePlanRows.length
  const scorableWeeks = completePlanRows
    .reduce((sum, plan) => sum + plan.weeks.filter((week) => week.scorable).length, 0)
  // Derivado de las filas, nunca de un total declarado por el caller.
  const observedTargetWeeks = artifact.plans.reduce((sum, plan) => sum + (plan.weekCount ?? 0), 0)

  // SIEMPRE del manifest embebido en el artefacto, nunca del checkout actual:
  // un control histórico debe evaluarse contra el manifest con el que corrió.
  const embeddedCases = artifact.manifest?.cases
  if (!Array.isArray(embeddedCases)) {
    return {
      accepted: false,
      reasons: ['el artefacto no embebe su manifest; no es evaluable'],
      attemptedPlans,
      observedTargetWeeks,
      completePlans,
      scorableWeeks,
    }
  }
  const manifestCaseIds = embeddedCases.map((item) => item.caseId)
  const planCaseIds = artifact.plans.map((plan) => plan.caseId)
  const duplicateManifestCaseIds = duplicatesOf(manifestCaseIds)
  const duplicatePlanCaseIds = duplicatesOf(planCaseIds)
  const expectedCases = new Map(embeddedCases.map((item) => [item.caseId, item]))
  const observedCases = new Set(planCaseIds)
  const missing = [...expectedCases.keys()].filter((caseId) => !observedCases.has(caseId))
  const unexpected = [...observedCases].filter((caseId) => !expectedCases.has(caseId))
  const wrongWeekCount = artifact.plans.filter((plan) =>
    expectedCases.has(plan.caseId) && expectedCases.get(plan.caseId).weekCount !== plan.weekCount)
  const wrongPlanScenario = artifact.plans.filter((plan) =>
    expectedCases.has(plan.caseId) && expectedCases.get(plan.caseId).scenarioKey !== plan.scenarioKey)
  const wrongWeekScenario = artifact.plans.flatMap((plan) =>
    plan.weeks
      .filter((week) => week.scenarioKey !== plan.scenarioKey)
      .map((week) => `${plan.caseId}[${week.weekIndex}]`))
  const invalidWeekIndexes = artifact.plans.filter((plan) => {
    const inspection = inspectWeekIndexes(plan)
    return inspection.hasDuplicates || inspection.hasOutOfRange
  })
  const contradictorySucceeded = artifact.plans.filter((plan) =>
    plan.outcome === 'succeeded' && !isCompletePlan(plan))
  const harnessFailures = artifact.plans.filter((plan) =>
    plan.errorClass === 'harness_failure')

  // Los escenarios se derivan del MANIFEST EMBEBIDO, no de las filas
  // observadas. Derivarlos de las filas haría que un escenario perdido por
  // completo —que no aporta ninguna fila— pase por verdad vacua, que es
  // exactamente el agujero que este chequeo viene a cerrar.
  const manifestScenarios = [...new Set(embeddedCases.map((item) => item.scenarioKey))]
  const completeScenarios = new Set(completePlanRows.map((plan) => plan.scenarioKey))
  const unrepresentedScenarios = manifestScenarios.filter(
    (scenarioKey) => !completeScenarios.has(scenarioKey))

  const expectedTargetWeeks = embeddedCases.reduce((sum, item) => sum + item.weekCount, 0)

  const reasons = []
  if (duplicateManifestCaseIds.length > 0) {
    reasons.push(`caseIds duplicados en manifest: ${duplicateManifestCaseIds.join(', ')}`)
  }
  if (duplicatePlanCaseIds.length > 0) {
    reasons.push(`caseIds duplicados en planes: ${duplicatePlanCaseIds.join(', ')}`)
  }
  if (embeddedCases.length !== artifact.manifest.attemptedPlanTotal) {
    reasons.push(`manifest inconsistente: cases.length ${embeddedCases.length} != attemptedPlanTotal ${artifact.manifest.attemptedPlanTotal}`)
  }
  if (expectedTargetWeeks !== artifact.manifest.targetWeekTotal) {
    reasons.push(`manifest inconsistente: suma weekCount ${expectedTargetWeeks} != targetWeekTotal ${artifact.manifest.targetWeekTotal}`)
  }
  if (attemptedPlans !== embeddedCases.length) {
    reasons.push(`manifest incompleto: se intentaron ${attemptedPlans}/${embeddedCases.length} planes`)
  }
  if (missing.length > 0 || unexpected.length > 0 || observedCases.size !== expectedCases.size) {
    reasons.push(`casos del manifest no cubiertos exactamente (faltan ${missing.length}, sobran ${unexpected.length}, únicos ${observedCases.size}/${expectedCases.size})`)
  }
  if (wrongWeekCount.length > 0) {
    reasons.push(`casos con weekCount distinto al manifest: ${wrongWeekCount.map((plan) => plan.caseId).join(', ')}`)
  }
  if (wrongPlanScenario.length > 0) {
    reasons.push(`scenarioKey de plan distinto al manifest: ${wrongPlanScenario.map((plan) => plan.caseId).join(', ')}`)
  }
  if (wrongWeekScenario.length > 0) {
    reasons.push(`scenarioKey de semana distinto al plan: ${wrongWeekScenario.join(', ')}`)
  }
  if (invalidWeekIndexes.length > 0) {
    reasons.push(`índices de semana inválidos (duplicados o fuera de rango): ${invalidWeekIndexes.map((plan) => plan.caseId).join(', ')}`)
  }
  if (contradictorySucceeded.length > 0) {
    reasons.push(`planes succeeded incoherentes con conteos/semanas: ${contradictorySucceeded.map((plan) => plan.caseId).join(', ')}`)
  }
  if (harnessFailures.length > 0) {
    reasons.push(`fallos del harness: ${harnessFailures.map((plan) => plan.caseId).join(', ')}`)
  }
  if (observedTargetWeeks !== expectedTargetWeeks) {
    reasons.push(`semanas objetivo observadas ${observedTargetWeeks}/${expectedTargetWeeks}`)
  }
  if (completePlans < MIN_COMPLETE_PLANS) {
    reasons.push(`planes completos ${completePlans} < ${MIN_COMPLETE_PLANS}`)
  }
  if (unrepresentedScenarios.length > 0) {
    // Sin esta condición, perder los dos planes de cualquier escenario dejaba
    // 10 completos y 34-36 semanas puntuables: aceptable por conteo, pero con
    // un escenario entero sin representar. La cobertura es la razón de ser de
    // la matriz de seis.
    reasons.push(`escenarios sin ningún plan completo: ${unrepresentedScenarios.join(', ')}`)
  }
  if (scorableWeeks < MIN_SCORABLE_WEEKS || scorableWeeks > MAX_SCORABLE_WEEKS) {
    reasons.push(`semanas puntuables ${scorableWeeks} fuera de [${MIN_SCORABLE_WEEKS}, ${MAX_SCORABLE_WEEKS}]`)
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    attemptedPlans,
    observedTargetWeeks,
    completePlans,
    scorableWeeks,
  }
}
