import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { AIRawResponse, AIRequest } from '../ai/types'
import type { PlanGenerationSummary, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { generateWeekCore, summarizeWeekGenerationError } from './generateWeekCore'
import { countReadyWeeks, isReadyWeek, sortWeeks } from './weekUtils'
import { getExpectedSessionsForPlanWeek } from './dateRange'
import { buildWeekRetryInstruction } from '../week/shared'
import {
  PRODUCTIVE_QUALITY_VERSION,
  resolveEffectiveRunQualityVersion,
  reviewPlanQuality,
} from './qualityReview'
import { buildLocalFallbackWeek } from './fallbackWeek'
import { summarizeTaxonomy } from './repairTaxonomy'
import { estimateCostUsd } from './pricing'
import { buildVariantId, type PlanBuilderVariantDescriptor } from './telemetryVersions'

export interface PlanGenerationAttemptTelemetry {
  athleteId: string
  planId: string
  jobId: string
  weekIndex: number
  attempt: number
  traceId: string
  provider: AIRawResponse['provider']
  model?: string
  promptTokens?: number
  completionTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  durationMs?: number
  finishReason?: string
  outcome: 'succeeded' | 'validation_failed' | 'truncated' | 'provider_failed'
  errorClass?: string
  retryUsed: boolean
  maxTokens: number
  workerConcurrency: number
  rawSessionCount?: number
  validSessionCount?: number
  droppedSessionCount?: number
  repairedSessionCount?: number
  addedFallbackCount?: number
  qualityScore?: number
  qualityGrade?: 'excellent' | 'good' | 'needs_review' | 'poor'
  qualityCriticalIssueCount?: number
  qualityWarningCount?: number
  variantId?: string
  effort?: string | null
  thinkingMode?: string | null
  promptVersion?: string
  schemaVersion?: string
  qualityVersion?: 1 | 2
  repairTaxonomyVersion?: 2
  correctiveActionCount?: number
  structuralActionCount?: number
  hydrationActionCount?: number
  movedSessionCount?: number
  filteredSportCount?: number
  hydratedSessionsAffected?: number
  correctedSessionsAffected?: number
  structurallyRepairedSessionsAffected?: number
  createdAt: number
}

export type PlanGenerationJobVariant = PlanBuilderVariantDescriptor & { variantId: string }

export interface PlanGenerationJobTelemetry {
  jobId: string
  athleteId: string
  planId: string
  enqueuedAt: number
  workerStartedAt: number
  weekCountRequested: number
  weekCountSucceeded: number
  weekCountFailed: number
  workerConcurrency: number
  /** Desde worker start hasta el primer putWeek con semana lista. Null si ninguna quedó lista. */
  firstWeekReadyMs: number | null
  /** Desde enqueue; incluye cola de arranque del worker. */
  firstWeekReadyE2eMs: number | null
  /** Desde worker start hasta que la ÚLTIMA semana target quedó terminal (último putWeek). Null si quedan pendientes. */
  planCompleteMs: number | null
  /** Desde worker start hasta el cierre de la corrida (siempre presente). */
  terminalMs: number
  previousWeekContextSource: 'none' | 'shell' | 'ready'
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  /** Null si algún intento facturable no reportó usage, o el modelo no tiene precio. */
  estimatedCostUsd: number | null
  outcome: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'budget_exhausted'
  variant: PlanGenerationJobVariant
  createdAt: number
}

export interface AsyncPlanGenerationWriter {
  /** Consulta ligera opcional: solo lee cancelRequested. Si no está, usa getPlan. */
  checkCancelled?: (planId: string) => Promise<boolean>
  getPlan(planId: string): Promise<TrainingPlan | null>
  putPlan(plan: TrainingPlan): Promise<void>
  putWeek(week: TrainingPlanWeek): Promise<void>
  /** Append-only, best-effort observability; failures never fail generation. */
  putAttempt?(attempt: PlanGenerationAttemptTelemetry): Promise<void>
  /** Append-only, best-effort job-level observability; failures never fail generation. */
  putJob?(job: PlanGenerationJobTelemetry): Promise<void>
}

export interface RunAsyncPlanGenerationInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: unknown
  targetWeekIndexes?: number[]
  repairInstructions?: Record<number, string>
  jobId: string
  writer: AsyncPlanGenerationWriter
  callLLM: (request: AIRequest) => Promise<AIRawResponse>
  now?: () => number
  maxTokens?: number
  temperature?: number
  /** Cantidad máxima de semanas generadas en paralelo. Default: 3. */
  concurrency?: number
  /** Presupuesto total del worker; las semanas que no alcancen a generarse quedan en error explícito. */
  budgetMs?: number
  /** Cuando el cliente/enqueue encoló (identity-checked por el caller). Default: worker start. */
  enqueuedAt?: number
  variant?: PlanGenerationJobVariant
  /**
   * Handoff de la telemetría de job: se invoca una sola vez, ya dentro del
   * `try/finally` que arma `finalizeJob`. Desde ese punto —y no antes— el loop
   * garantiza emitir la fila del job en cualquier salida. El caller lo usa para
   * soltar su propio fallback (`emitUnstartedJobTelemetry`) sin dejar ventana:
   * el preámbulo síncrono de esta función (checkpoint inicial del plan) puede
   * lanzar, y ahí la fila todavía es responsabilidad del caller.
   */
  onJobFinalizerArmed?: () => void
}

export interface AsyncPlanGenerationResult {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  cancelled: boolean
}

// Presupuesto de tokens en dos niveles: el primer intento usa un cap ajustado
// (cubre con holgura el output típico de plan_builder_week, ~3500 tokens según
// OPTIMIZATION_AND_COSTS.md) para bajar latencia/costo bajo concurrencia; solo
// las semanas que truncan reintentan con el cap amplio. No subir el default a
// 12000 sin datos de tasa de truncado real (Beta Quality), o se pierde la
// ganancia de latencia para todas las semanas.
export const DEFAULT_MAX_TOKENS = 5000
const TRUNCATED_RETRY_MAX_TOKENS = 12000
export const DEFAULT_TEMPERATURE = 0.25
const MAX_WEEK_ATTEMPTS = 2
const NON_FALLBACK_ELIGIBLE_ERROR_CLASSES = new Set([
  'quality.squash.signature_uniqueness_unresolved',
])
const DEFAULT_CONCURRENCY = 3
const MAX_CONCURRENCY = 6
// Netlify background functions se cortan a los 15 min; reservamos margen para
// cerrar el plan con un estado terminal en vez de morir a mitad de una semana.
const DEFAULT_WORKER_BUDGET_MS = 13 * 60_000
const MIN_WEEK_START_BUDGET_MS = 150_000
const MIN_RETRY_BUDGET_MS = 150_000
const WORKER_BUDGET_EXHAUSTED_MESSAGE = 'Generación detenida: se agotó el presupuesto de tiempo del worker antes de llegar a esta semana. Reintenta para generar las semanas pendientes.'

type GenerateWeekCoreResult = Awaited<ReturnType<typeof generateWeekCore>>

type QualityReviewMeta = Pick<GenerateWeekCoreResult['meta'],
  | 'fallbackUsed'
  | 'repairedSessionCount'
  | 'movedSessionCount'
  | 'addedFallbackCount'
  | 'filteredSportCount'
  | 'droppedSessionCount'
  | 'repairTaxonomyVersion'
  | 'hydrationActionCount'
  | 'correctiveActionCount'
  | 'structuralActionCount'
  | 'hydratedSessionsAffected'
  | 'correctedSessionsAffected'
  | 'structurallyRepairedSessionsAffected'
>

export function buildAttemptQualityReviewCacheKey(meta: QualityReviewMeta): string {
  return JSON.stringify({
    fallbackUsed: meta.fallbackUsed,
    repairedSessionCount: meta.repairedSessionCount,
    movedSessionCount: meta.movedSessionCount,
    addedFallbackCount: meta.addedFallbackCount,
    filteredSportCount: meta.filteredSportCount,
    droppedSessionCount: meta.droppedSessionCount,
    repairTaxonomyVersion: meta.repairTaxonomyVersion,
    hydrationActionCount: meta.hydrationActionCount,
    correctiveActionCount: meta.correctiveActionCount,
    structuralActionCount: meta.structuralActionCount,
    hydratedSessionsAffected: meta.hydratedSessionsAffected,
    correctedSessionsAffected: meta.correctedSessionsAffected,
    structurallyRepairedSessionsAffected: meta.structurallyRepairedSessionsAffected,
  })
}

function classifyAttemptOutcome(result: GenerateWeekCoreResult): PlanGenerationAttemptTelemetry['outcome'] {
  if (result.meta.errorClass === 'truncated') return 'truncated'
  if (result.sessions.length > 0 && result.meta.errorClass !== 'quality_gate') return 'succeeded'
  if (result.meta.errorClass === 'validation' || result.meta.errorClass === 'quality_gate') return 'validation_failed'
  return 'provider_failed'
}

export function getCriticalWeekQualityIssueMessages(
  issues: Array<{ severity: 'error' | 'warning' | 'info'; code: string; message: string }>,
): string[] {
  return issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.code}: ${issue.message}`)
}

function failedWeeks(weeks: TrainingPlanWeek[]): number[] {
  return weeks
    .filter((week) => week.status === 'error')
    .map((week) => week.weekIndex)
    .sort((a, b) => a - b)
}

function totalAttempts(weeks: TrainingPlanWeek[]): number {
  return weeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0)
}

function deriveAsyncGenerationState(weeks: TrainingPlanWeek[]): TrainingPlan['generationState'] {
  if (weeks.some((week) => week.status === 'generating')) return 'generating'
  if (weeks.length === 0) return 'shell'
  const readyWeeks = countReadyWeeks(weeks)
  if (readyWeeks === weeks.length) return 'complete'
  if (readyWeeks > 0) return 'partial'
  if (weeks.some((week) => week.status === 'error' || (week.generationMeta.attempts ?? 0) > 0)) return 'failed'
  return 'shell'
}

function replaceWeek(weeks: TrainingPlanWeek[], next: TrainingPlanWeek): TrainingPlanWeek[] {
  return sortWeeks(weeks.map((week) => (week.weekIndex === next.weekIndex ? next : week)))
}

export function normalizePlanBuilderConcurrency(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_CONCURRENCY
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(value)))
}

function buildSummary(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  input: {
    jobId: string
    startedAt: number
    heartbeatAt: number
    completedAt?: number
    cancelRequested?: boolean
  },
): PlanGenerationSummary {
  return {
    startedAt: plan.generationSummary?.startedAt ?? input.startedAt,
    jobId: input.jobId,
    completedAt: input.completedAt,
    totalDurationMs: input.completedAt ? input.completedAt - (plan.generationSummary?.startedAt ?? input.startedAt) : undefined,
    strategy: 'single',
    completedWeeks: countReadyWeeks(weeks),
    failedWeeks: failedWeeks(weeks),
    totalAttempts: totalAttempts(weeks),
    heartbeatAt: input.heartbeatAt,
    cancelRequested: input.cancelRequested
      ?? (plan.generationSummary?.jobId === input.jobId
        ? plan.generationSummary.cancelRequested
        : undefined),
    acceptedAt: plan.generationSummary?.acceptedAt,
    discardedAt: plan.generationSummary?.discardedAt,
    qualityReview: plan.generationSummary?.qualityReview,
  }
}

function buildPlanCheckpoint(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  input: {
    generationState: TrainingPlan['generationState']
    jobId: string
    startedAt: number
    updatedAt: number
    completedAt?: number
    cancelRequested?: boolean
  },
): TrainingPlan {
  return {
    ...plan,
    generationState: input.generationState,
    updatedAt: input.updatedAt,
    generationSummary: buildSummary(plan, weeks, {
      jobId: input.jobId,
      startedAt: input.startedAt,
      heartbeatAt: input.updatedAt,
      completedAt: input.completedAt,
      cancelRequested: input.cancelRequested,
    }),
  }
}

function makeGeneratingWeek(week: TrainingPlanWeek, timestamp: number): TrainingPlanWeek {
  return {
    ...week,
    status: 'generating',
    validationIssues: [],
    generationMeta: {
      ...week.generationMeta,
      attempts: week.generationMeta.attempts ?? 0,
      strategy: 'single',
    },
    updatedAt: timestamp,
  }
}

function makeResolvedWeek(
  week: TrainingPlanWeek,
  result: Awaited<ReturnType<typeof generateWeekCore>>,
  timestamp: number,
  qualityVersion: 1 | 2,
): TrainingPlanWeek {
  return {
    ...week,
    status: result.sessions.length > 0 ? 'draft' : 'error',
    sessions: result.sessions,
    generationMeta: {
      ...week.generationMeta,
      attempts: (week.generationMeta.attempts ?? 0) + result.meta.attempts,
      provider: result.meta.provider,
      model: result.meta.model,
      requestClass: result.meta.requestClass,
      traceId: result.meta.traceId,
      promptTokens: result.meta.promptTokens,
      completionTokens: result.meta.completionTokens,
      cacheCreationInputTokens: result.meta.cacheCreationInputTokens,
      cacheReadInputTokens: result.meta.cacheReadInputTokens,
      finishReason: result.meta.finishReason,
      lastError: result.meta.lastError,
      lastAttemptAt: timestamp,
      durationMs: result.meta.durationMs,
      retryUsed: result.meta.retryUsed,
      fallbackUsed: result.meta.fallbackUsed,
      strategy: 'single',
      rawSessionCount: result.meta.rawSessionCount,
      validSessionCount: result.meta.validSessionCount,
      droppedSessionCount: result.meta.droppedSessionCount,
      repairedSessionCount: result.meta.repairedSessionCount,
      movedSessionCount: result.meta.movedSessionCount,
      addedFallbackCount: result.meta.addedFallbackCount,
      filteredSportCount: result.meta.filteredSportCount,
      repairTaxonomyVersion: result.meta.repairTaxonomyVersion,
      qualityVersion,
      hydrationActionCount: result.meta.hydrationActionCount,
      correctiveActionCount: result.meta.correctiveActionCount,
      structuralActionCount: result.meta.structuralActionCount,
      hydratedSessionsAffected: result.meta.hydratedSessionsAffected,
      correctedSessionsAffected: result.meta.correctedSessionsAffected,
      structurallyRepairedSessionsAffected: result.meta.structurallyRepairedSessionsAffected,
      strengthAccessoryRotationActionCount: result.meta.strengthAccessoryRotationActionCount,
      strengthAccessoryRotationSessionsAffected: result.meta.strengthAccessoryRotationSessionsAffected,
      squashDrillRotationActionCount: result.meta.squashDrillRotationActionCount,
      squashDrillRotationSessionsAffected: result.meta.squashDrillRotationSessionsAffected,
      squashDrillRotationOmittedCount: result.meta.squashDrillRotationOmittedCount,
      repairWarnings: result.meta.repairWarnings,
      errorClass: result.meta.errorClass,
      generationSource: 'ai',
    },
    updatedAt: timestamp,
  }
}

function makeFallbackResolvedWeek(
  week: TrainingPlanWeek,
  result: GenerateWeekCoreResult,
  fallback: ReturnType<typeof buildLocalFallbackWeek>,
  timestamp: number,
  qualityVersion: 1 | 2,
): TrainingPlanWeek {
  const taxonomySummary = summarizeTaxonomy(fallback.meta.taxonomy)
  return {
    ...week,
    status: fallback.sessions.length > 0 ? 'draft' : 'error',
    sessions: fallback.sessions,
    generationMeta: {
      ...week.generationMeta,
      attempts: (week.generationMeta.attempts ?? 0) + result.meta.attempts,
      provider: result.meta.provider,
      model: result.meta.model ? `${result.meta.model}+local-plan-fallback` : 'local-plan-fallback',
      requestClass: result.meta.requestClass,
      traceId: result.meta.traceId,
      promptTokens: result.meta.promptTokens,
      completionTokens: result.meta.completionTokens,
      cacheCreationInputTokens: result.meta.cacheCreationInputTokens,
      cacheReadInputTokens: result.meta.cacheReadInputTokens,
      finishReason: result.meta.finishReason,
      lastError: result.meta.lastError,
      lastAttemptAt: timestamp,
      durationMs: result.meta.durationMs,
      retryUsed: result.meta.retryUsed,
      fallbackUsed: true,
      strategy: 'single',
      rawSessionCount: result.meta.rawSessionCount ?? 0,
      validSessionCount: fallback.sessions.length,
      droppedSessionCount: result.meta.droppedSessionCount ?? 0,
      repairedSessionCount: fallback.meta.repairedSessionCount,
      movedSessionCount: fallback.meta.movedSessionCount,
      addedFallbackCount: fallback.meta.addedFallbackCount,
      filteredSportCount: fallback.meta.filteredSportCount,
      repairTaxonomyVersion: 2,
      qualityVersion,
      ...taxonomySummary,
      strengthAccessoryRotationActionCount: fallback.meta.strengthAccessoryRotationActionCount,
      strengthAccessoryRotationSessionsAffected: fallback.meta.strengthAccessoryRotationSessionsAffected,
      squashDrillRotationActionCount: fallback.meta.squashDrillRotationActionCount,
      squashDrillRotationSessionsAffected: fallback.meta.squashDrillRotationSessionsAffected,
      squashDrillRotationOmittedCount: fallback.meta.squashDrillRotationOmittedCount,
      repairWarnings: [
        {
          code: 'local_plan_fallback',
          message: `Se generó una semana base local después de ${result.meta.attempts} intento(s) fallidos o rechazados por calidad.`,
        },
        ...fallback.meta.warnings,
      ],
      errorClass: fallback.sessions.length > 0 ? 'local_plan_fallback' : result.meta.errorClass,
      generationSource: 'fallback',
    },
    updatedAt: timestamp,
  }
}

function makeErroredWeek(
  week: TrainingPlanWeek,
  message: string,
  timestamp: number,
  errorClass?: string,
  attemptDelta = 1,
): TrainingPlanWeek {
  return {
    ...week,
    status: 'error',
    sessions: [],
    generationMeta: {
      ...week.generationMeta,
      attempts: Math.max(0, (week.generationMeta.attempts ?? 0) + attemptDelta),
      lastError: message,
      lastAttemptAt: timestamp,
      strategy: 'single',
      generationSource: 'ai',
      errorClass,
    },
    updatedAt: timestamp,
  }
}

function makeErroredWeekFromResult(
  week: TrainingPlanWeek,
  result: GenerateWeekCoreResult,
  message: string,
  timestamp: number,
  qualityVersion: 1 | 2,
  errorClass = 'post_generation_failed',
): TrainingPlanWeek {
  const resolved = makeResolvedWeek(week, result, timestamp, qualityVersion)
  return {
    ...resolved,
    status: 'error',
    sessions: [],
    generationMeta: {
      ...resolved.generationMeta,
      lastError: message,
      errorClass,
    },
  }
}

function classifyThrownProviderError(message: string): 'timeout' | 'rate_limit' | 'server_error' {
  const normalized = message.toLowerCase()
  if (normalized.includes('rate limit') || normalized.includes('rate_limit') || normalized.includes('429')) {
    return 'rate_limit'
  }
  if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('abort')) {
    return 'timeout'
  }
  return 'server_error'
}

function makeThrownAttemptResult(
  message: string,
  traceId: string,
  provider: AIRawResponse['provider'],
): GenerateWeekCoreResult {
  return {
    sessions: [],
    meta: {
      hydrationActionCount: 0,
      correctiveActionCount: 0,
      structuralActionCount: 0,
      hydratedSessionsAffected: 0,
      correctedSessionsAffected: 0,
      structurallyRepairedSessionsAffected: 0,
      repairTaxonomyVersion: 2,
      attempts: 1,
      provider,
      requestClass: 'plan_builder_week',
      traceId,
      lastError: message,
      errorClass: classifyThrownProviderError(message),
    },
  }
}

function buildAsyncRetryInstruction(
  previousError: string | undefined,
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  attempt: number,
): string | undefined {
  if (attempt <= 1) return undefined
  const base = summarizeWeekGenerationError(previousError, week, plan)
  const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)
  const retryInstruction = buildWeekRetryInstruction(base, week.weekStartDate, expectedSessions, attempt)
  if (previousError?.includes('truncada') || previousError?.includes('tokens')) {
    return `${retryInstruction ?? base} La respuesta anterior se cortó por max_tokens: usa descripciones compactas, evita texto redundante y conserva exactamente ${expectedSessions} sesiones completas.`
  }
  return retryInstruction
    ?? `${base} Usa formato estricto: targetDate=${week.weekStartDate}, ${expectedSessions} sesiones compactas y todas las fechas dentro de esa semana.`
}

async function generateWeekCoreWithRetry(input: {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  planWeekDescriptors: readonly { weekIndex: number; phase: string }[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: unknown
  initialRepairInstruction?: string
  traceId: string
  maxTokens: number
  temperature: number
  callLLM: (request: AIRequest) => Promise<AIRawResponse>
  /** Hook para refrescar heartbeat antes de un reintento; los fallos se ignoran. */
  onBeforeRetry?: () => Promise<void>
  getRemainingBudgetMs?: () => number
  /** Devuelve errores críticos de la semana. Warnings e info no fuerzan reintento. */
  getCriticalQualityIssues?: (result: GenerateWeekCoreResult) => string[]
  onAttemptCompleted?: (
    attempt: number,
    result: GenerateWeekCoreResult,
    createdAt: number,
    maxTokens: number,
  ) => Promise<void>
}): Promise<GenerateWeekCoreResult> {
  let attempts = 0
  let totalDurationMs = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalCacheCreationInputTokens = 0
  let totalCacheReadInputTokens = 0
  let lastResult: GenerateWeekCoreResult | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= MAX_WEEK_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      if ((input.getRemainingBudgetMs?.() ?? Number.POSITIVE_INFINITY) < MIN_RETRY_BUDGET_MS) {
        break
      }
      try {
        await input.onBeforeRetry?.()
      } catch {
        // Heartbeat best-effort: no abortar el reintento por un fallo de escritura.
      }
    }
    const retryInstruction = attempt === 1
      ? input.initialRepairInstruction
      : buildAsyncRetryInstruction(lastError, input.plan, input.week, attempt)
    const maxTokens = lastResult?.meta.errorClass === 'truncated'
      ? Math.max(input.maxTokens, TRUNCATED_RETRY_MAX_TOKENS)
      : input.maxTokens
    const attemptTraceId = attempt === 1 ? input.traceId : `${input.traceId}-attempt-${attempt}`
    let result: GenerateWeekCoreResult
    const attemptStartedAt = Date.now()
    try {
      result = await generateWeekCore({
        plan: input.plan,
        week: input.week,
        previousWeek: input.previousWeek,
        planWeekDescriptors: input.planWeekDescriptors,
        profile: input.profile,
        wizardConfig: input.wizardConfig,
        recentContext: input.recentContext as never,
        retryInstruction,
        strictFormatting: attempt > 1,
        traceId: attemptTraceId,
        maxTokens,
        temperature: attempt === 1 ? input.temperature : Math.min(input.temperature, DEFAULT_TEMPERATURE),
        callLLM: input.callLLM,
      })
    } catch (error) {
      // Fallos técnicos del proveedor (timeout, 429, 5xx, red) también consumen
      // un intento y habilitan el reintento, igual que una semana inválida.
      const message = error instanceof Error ? error.message : String(error)
      result = makeThrownAttemptResult(message, attemptTraceId, lastResult?.meta.provider ?? 'claude')
      result.meta.durationMs = Date.now() - attemptStartedAt
    }

    attempts += result.meta.attempts
    totalDurationMs += result.meta.durationMs ?? 0
    totalPromptTokens += result.meta.promptTokens ?? 0
    totalCompletionTokens += result.meta.completionTokens ?? 0
    totalCacheCreationInputTokens += result.meta.cacheCreationInputTokens ?? 0
    totalCacheReadInputTokens += result.meta.cacheReadInputTokens ?? 0
    let accepted = false
    let failedResult = result
    if (result.sessions.length > 0) {
      const criticalIssues = input.getCriticalQualityIssues?.(result) ?? []
      if (criticalIssues.length === 0) {
        accepted = true
      } else {
        const qualityError = `Quality gate rechazó la semana: ${criticalIssues.join(' | ')}`
        result = {
          ...result,
          meta: {
            ...result.meta,
            lastError: qualityError,
            errorClass: 'quality_gate',
          },
        }
        // Conserva las sesiones para medir el score del intento rechazado, pero
        // no permite que el caller lo confunda con una semana aceptada.
        failedResult = { ...result, sessions: [] }
      }
    }

    try {
      await input.onAttemptCompleted?.(attempt, result, Date.now(), maxTokens)
    } catch (error) {
      // Observabilidad best-effort: nunca gastar otro intento por una escritura.
      const code = typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : 'unknown'
      console.warn(`[plan-builder] attempt telemetry failed traceId=${attemptTraceId} week=${input.week.weekIndex} attempt=${attempt} code=${code}`)
    }

    if (accepted) {
      return {
        ...result,
        meta: {
          ...result.meta,
          attempts,
          durationMs: totalDurationMs || result.meta.durationMs,
          promptTokens: totalPromptTokens || undefined,
          completionTokens: totalCompletionTokens || undefined,
          cacheCreationInputTokens: totalCacheCreationInputTokens || undefined,
          cacheReadInputTokens: totalCacheReadInputTokens || undefined,
          retryUsed: attempts > 1 || result.meta.retryUsed,
        },
      }
    }

    lastResult = failedResult
    lastError = failedResult.meta.lastError

    if (failedResult.meta.errorClass === 'rate_limit') break
  }

  if (!lastResult) {
    throw new Error('La generación no produjo respuesta del modelo.')
  }

  return {
    ...lastResult,
    meta: {
      ...lastResult.meta,
      attempts,
      durationMs: totalDurationMs || lastResult.meta.durationMs,
      promptTokens: totalPromptTokens || undefined,
      completionTokens: totalCompletionTokens || undefined,
      cacheCreationInputTokens: totalCacheCreationInputTokens || undefined,
      cacheReadInputTokens: totalCacheReadInputTokens || undefined,
      retryUsed: attempts > 1 || lastResult.meta.retryUsed,
    },
  }
}

export interface UnstartedJobTelemetryInput {
  jobId: string
  athleteId: string
  planId: string
  enqueuedAt: number
  workerStartedAt: number
  weekCountRequested: number
  workerConcurrency: number
  variant: PlanGenerationJobVariant
  writer: Pick<AsyncPlanGenerationWriter, 'putJob'>
  now?: () => number
}

/**
 * Emite la fila de job de una corrida que nunca llegó al loop. `finalizeJob`
 * solo cubre desde el primer await de `runAsyncPlanGeneration`, así que un
 * checkpoint previo del worker que falle (getPlan/putPlan/putWeek inicial)
 * dejaría un job ya encolado sin ninguna fila: la corrida desaparecería de la
 * medición en vez de contarse como fallida. Best-effort, igual que `putJob`.
 *
 * `weekCountFailed` queda en 0 a propósito: ninguna semana llegó a escribirse en
 * `error`; el `outcome: 'failed'` es lo que marca la corrida perdida.
 */
export async function emitUnstartedJobTelemetry(input: UnstartedJobTelemetryInput): Promise<void> {
  if (!input.writer.putJob) return
  const terminalAt = (input.now ?? Date.now)()
  const job: PlanGenerationJobTelemetry = {
    jobId: input.jobId,
    athleteId: input.athleteId,
    planId: input.planId,
    enqueuedAt: input.enqueuedAt,
    workerStartedAt: input.workerStartedAt,
    weekCountRequested: input.weekCountRequested,
    weekCountSucceeded: 0,
    weekCountFailed: 0,
    workerConcurrency: normalizePlanBuilderConcurrency(input.workerConcurrency),
    firstWeekReadyMs: null,
    firstWeekReadyE2eMs: null,
    planCompleteMs: null,
    terminalMs: terminalAt - input.workerStartedAt,
    previousWeekContextSource: 'none',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    estimatedCostUsd: null,
    outcome: 'failed',
    variant: input.variant,
    createdAt: terminalAt,
  }
  try {
    await input.writer.putJob(job)
  } catch (error) {
    console.warn(`[plan-builder] putJob (unstarted) failed jobId=${input.jobId}: ${error instanceof Error ? error.message : 'unknown'}`)
  }
}

export async function runAsyncPlanGeneration(input: RunAsyncPlanGenerationInput): Promise<AsyncPlanGenerationResult> {
  const getNow = input.now ?? Date.now
  const startedAt = input.plan.generationSummary?.startedAt ?? getNow()
  let plan = buildPlanCheckpoint(input.plan, input.weeks, {
    generationState: 'generating',
    jobId: input.jobId,
    startedAt,
    updatedAt: startedAt,
  })
  let weeks = sortWeeks(input.weeks)

  // Ordering es load-bearing: todo lo que lee `finalizeJob` debe existir ANTES
  // del primer await (el `putPlan` inicial), para que aun un fallo de ese
  // checkpoint emita el job. Este bloque solo depende de `weeks`, `input` y
  // `getNow`, todos disponibles aquí.
  const targetWeekIndexes = input.targetWeekIndexes?.length
    ? [...input.targetWeekIndexes].sort((a, b) => a - b)
    : weeks.map((week) => week.weekIndex)
  // Las dimensiones provistas son autoridad, pero el id siempre se recompone
  // desde ellas para que ningún caller directo pueda persistir una combinación
  // imposible entre `variantId` y `qualityVersion`.
  const variant = input.variant
    ? { ...input.variant, variantId: buildVariantId(input.variant) }
    : undefined
  const effectiveQualityVersion = variant?.qualityVersion
    ?? resolveEffectiveRunQualityVersion({
      weeks,
      targetWeekIndexes: input.targetWeekIndexes,
      productiveVersion: PRODUCTIVE_QUALITY_VERSION,
    })

  const deadlineAt = getNow() + (input.budgetMs ?? DEFAULT_WORKER_BUDGET_MS)
  const concurrency = normalizePlanBuilderConcurrency(input.concurrency)
  let targetPosition = 0
  let stopLaunching = false
  let cancelled = false

  // Acumuladores del job (medición pura; no cambian la generación).
  let budgetExhausted = false
  let firstReadyAt: number | null = null
  let allTargetsTerminalAt: number | null = null
  const terminalTargets = new Set<number>()
  let previousWeekContextSource: PlanGenerationJobTelemetry['previousWeekContextSource'] = 'none'
  const tokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let anyBillableAttempt = false
  let costUsd: number | null = 0

  const observeWeekWrite = (week: TrainingPlanWeek): void => {
    if (firstReadyAt === null && isReadyWeek(week)) firstReadyAt = getNow()
    if (!targetWeekIndexes.includes(week.weekIndex)) return
    if (!terminalTargets.has(week.weekIndex) && (isReadyWeek(week) || week.status === 'error')) {
      terminalTargets.add(week.weekIndex)
      if (terminalTargets.size === targetWeekIndexes.length && allTargetsTerminalAt === null) {
        allTargetsTerminalAt = getNow()
      }
    }
  }

  // Sin `targetWeekIndexes` explícito el loop omite las semanas ya listas, así
  // que nunca reciben un putWeek y `observeWeekWrite` jamás las cuenta. Sin este
  // preload, una corrida mixta (una semana lista + una pendiente) termina
  // `succeeded` con `plan_complete_ms` en null. La condición espeja exactamente
  // el skip de `takeNextWeekIndex`/`generateTargetWeek`: con targets explícitos
  // todas se regeneran, y una semana en `error` también se reintenta, así que
  // ninguna de esas dos es terminal de entrada.
  if (!input.targetWeekIndexes?.length) {
    for (const week of weeks) {
      if (targetWeekIndexes.includes(week.weekIndex) && isReadyWeek(week)) terminalTargets.add(week.weekIndex)
    }
    if (targetWeekIndexes.length > 0 && terminalTargets.size === targetWeekIndexes.length) {
      allTargetsTerminalAt = getNow()
    }
  }

  let jobFinalized = false
  const finalizeJob = async (threwDuringRun: boolean): Promise<void> => {
    if (jobFinalized) return
    jobFinalized = true
    if (!input.writer.putJob || !variant) return

    const terminalAt = getNow()
    const enqueuedAt = input.enqueuedAt ?? startedAt
    const succeeded = weeks.filter((week) => targetWeekIndexes.includes(week.weekIndex) && isReadyWeek(week)).length
    const failed = weeks.filter((week) => targetWeekIndexes.includes(week.weekIndex) && week.status === 'error').length

    const outcome: PlanGenerationJobTelemetry['outcome'] =
      cancelled ? 'cancelled'
        : budgetExhausted ? 'budget_exhausted'
          : succeeded === targetWeekIndexes.length && !threwDuringRun ? 'succeeded'
            : succeeded > 0 && !threwDuringRun ? 'partial'
              : 'failed'

    const job: PlanGenerationJobTelemetry = {
      jobId: input.jobId,
      athleteId: plan.athleteId,
      planId: plan.id,
      enqueuedAt,
      workerStartedAt: startedAt,
      weekCountRequested: targetWeekIndexes.length,
      weekCountSucceeded: succeeded,
      weekCountFailed: failed,
      workerConcurrency: concurrency,
      firstWeekReadyMs: firstReadyAt === null ? null : firstReadyAt - startedAt,
      firstWeekReadyE2eMs: firstReadyAt === null ? null : firstReadyAt - enqueuedAt,
      planCompleteMs: allTargetsTerminalAt === null ? null : allTargetsTerminalAt - startedAt,
      terminalMs: terminalAt - startedAt,
      previousWeekContextSource,
      totalInputTokens: tokenTotals.input,
      totalOutputTokens: tokenTotals.output,
      totalCacheReadTokens: tokenTotals.cacheRead,
      totalCacheCreationTokens: tokenTotals.cacheCreation,
      estimatedCostUsd: anyBillableAttempt ? costUsd : null,
      outcome,
      variant: { ...variant, qualityVersion: effectiveQualityVersion },
      createdAt: terminalAt,
    }
    try {
      await input.writer.putJob(job)
    } catch (error) {
      console.warn(`[plan-builder] putJob failed jobId=${input.jobId}: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  let threw = false
  try {
    // Primera sentencia del try: el `finally` ya está armado, así que a partir
    // de acá toda salida pasa por `finalizeJob`. Notificarlo antes del try
    // dejaría sin emisor a una excepción del preámbulo síncrono.
    input.onJobFinalizerArmed?.()
    await input.writer.putPlan(plan)

    const checkCancelled = async (): Promise<boolean> => {
      try {
        return input.writer.checkCancelled
          ? await input.writer.checkCancelled(plan.id)
          : Boolean((await input.writer.getPlan(plan.id))?.generationSummary?.cancelRequested)
      } catch {
        // No se pudo leer el estado de cancelación — continuar generando
        return false
      }
    }

    const markRemainingBudgetErrors = async (fromPosition: number): Promise<void> => {
      for (const remainingIndex of targetWeekIndexes.slice(fromPosition)) {
        const remainingWeek = weeks.find((week) => week.weekIndex === remainingIndex)
        if (!remainingWeek) continue
        if (!input.targetWeekIndexes?.length && isReadyWeek(remainingWeek)) continue
        const erroredWeek = makeErroredWeek(remainingWeek, WORKER_BUDGET_EXHAUSTED_MESSAGE, getNow(), 'timeout', 0)
        weeks = replaceWeek(weeks, erroredWeek)
        await input.writer.putWeek(erroredWeek)
        observeWeekWrite(erroredWeek)
        budgetExhausted = true
      }
    }

    let takeNextQueue = Promise.resolve()
    const takeNextWeekIndex = (): Promise<number | undefined> => {
      const run = takeNextQueue.then(async (): Promise<number | undefined> => {
        while (!stopLaunching && targetPosition < targetWeekIndexes.length) {
          if (deadlineAt - getNow() < MIN_WEEK_START_BUDGET_MS) {
            await markRemainingBudgetErrors(targetPosition)
            targetPosition = targetWeekIndexes.length
            stopLaunching = true
            return undefined
          }

          if (await checkCancelled()) {
            cancelled = true
            stopLaunching = true
            return undefined
          }

          const weekIndex = targetWeekIndexes[targetPosition]
          targetPosition++
          const target = weeks.find((week) => week.weekIndex === weekIndex)
          if (!target) continue
          if (!input.targetWeekIndexes?.length && isReadyWeek(target)) continue
          return weekIndex
        }

        return undefined
      })
      takeNextQueue = run.then(() => undefined, () => undefined)
      return run
    }

    const generateTargetWeek = async (weekIndex: number): Promise<void> => {
      const target = weeks.find((week) => week.weekIndex === weekIndex)
      if (!target) return
      if (!input.targetWeekIndexes?.length && isReadyWeek(target)) return

      const generatingWeek = makeGeneratingWeek(target, getNow())
      weeks = replaceWeek(weeks, generatingWeek)
      await input.writer.putWeek(generatingWeek)
      observeWeekWrite(generatingWeek)
      plan = buildPlanCheckpoint(plan, weeks, {
        generationState: 'generating',
        jobId: input.jobId,
        startedAt,
        updatedAt: generatingWeek.updatedAt,
      })
      await input.writer.putPlan(plan)

      let providerResult: GenerateWeekCoreResult | undefined
      type WeekQualityReview = ReturnType<typeof reviewPlanQuality>['weeks'][number]
      const attemptQualityBySessions = new WeakMap<
        GenerateWeekCoreResult['sessions'],
        Map<string, WeekQualityReview | undefined>
      >()
      const reviewAttemptWeek = (
        candidateResult: GenerateWeekCoreResult,
      ): WeekQualityReview | undefined => {
        if (candidateResult.sessions.length === 0) return undefined
        const reviewKey = buildAttemptQualityReviewCacheKey(candidateResult.meta)
        const cachedByMeta = attemptQualityBySessions.get(candidateResult.sessions)
        if (cachedByMeta?.has(reviewKey)) {
          return cachedByMeta.get(reviewKey)
        }
        const candidateWeek: TrainingPlanWeek = {
          ...generatingWeek,
          status: 'draft',
          sessions: candidateResult.sessions,
          generationMeta: {
            ...generatingWeek.generationMeta,
            fallbackUsed: candidateResult.meta.fallbackUsed,
            repairedSessionCount: candidateResult.meta.repairedSessionCount,
            movedSessionCount: candidateResult.meta.movedSessionCount,
            addedFallbackCount: candidateResult.meta.addedFallbackCount,
            filteredSportCount: candidateResult.meta.filteredSportCount,
            droppedSessionCount: candidateResult.meta.droppedSessionCount,
            repairTaxonomyVersion: candidateResult.meta.repairTaxonomyVersion,
            qualityVersion: effectiveQualityVersion,
            hydrationActionCount: candidateResult.meta.hydrationActionCount,
            correctiveActionCount: candidateResult.meta.correctiveActionCount,
            structuralActionCount: candidateResult.meta.structuralActionCount,
            hydratedSessionsAffected: candidateResult.meta.hydratedSessionsAffected,
            correctedSessionsAffected: candidateResult.meta.correctedSessionsAffected,
            structurallyRepairedSessionsAffected: candidateResult.meta.structurallyRepairedSessionsAffected,
            generationSource: 'ai',
          },
        }
        const review = reviewPlanQuality(
          plan,
          replaceWeek(weeks, candidateWeek),
          {
            profile: input.profile,
            qualityVersion: effectiveQualityVersion,
            pendingTargetWeekIndexes: targetWeekIndexes.filter(
              (index) => index !== weekIndex && !terminalTargets.has(index),
            ),
          },
        ).weeks.find((weekReview) => weekReview.weekIndex === weekIndex)
        const nextCache = cachedByMeta ?? new Map<string, WeekQualityReview | undefined>()
        nextCache.set(reviewKey, review)
        attemptQualityBySessions.set(candidateResult.sessions, nextCache)
        return review
      }
      try {
        // En generación paralela la semana previa puede no estar lista todavía.
        // Usamos la versión generada si existe (para evitar clonar sesiones), y si
        // no, caemos al shell de la semana previa: conserva fase y carga objetivo
        // para que la directiva de progresión sea correcta y no trate una semana
        // intermedia como "primera semana del plan".
        const previousWeek = weeks.find((week) => week.weekIndex === weekIndex - 1 && isReadyWeek(week))
          ?? weeks.find((week) => week.weekIndex === weekIndex - 1)
        // Clasifica el objeto exacto entregado al prompt (no una re-consulta de
        // `weeks`, que podría observar otra semana completándose entre lecturas).
        const source: PlanGenerationJobTelemetry['previousWeekContextSource'] =
          weekIndex === 0 ? 'none' : previousWeek == null ? 'none' : isReadyWeek(previousWeek) ? 'ready' : 'shell'
        generatingWeek.generationMeta = {
          ...generatingWeek.generationMeta,
          previousWeekContextSource: source,
        }
        if (weekIndex > 0) {
          if (source === 'shell') previousWeekContextSource = 'shell'
          else if (source === 'ready' && previousWeekContextSource === 'none') previousWeekContextSource = 'ready'
        }
        const result = await generateWeekCoreWithRetry({
          plan,
          week: generatingWeek,
          previousWeek,
          planWeekDescriptors: weeks.map((candidate) => ({
            weekIndex: candidate.weekIndex,
            phase: candidate.phase,
          })),
          profile: input.profile,
          wizardConfig: input.wizardConfig,
          recentContext: input.recentContext as never,
          initialRepairInstruction: input.repairInstructions?.[weekIndex],
          traceId: `${input.jobId}-week-${weekIndex}`,
          maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: input.temperature ?? DEFAULT_TEMPERATURE,
          callLLM: input.callLLM,
          getCriticalQualityIssues: (candidateResult) => {
            const weekReview = reviewAttemptWeek(candidateResult)
            return getCriticalWeekQualityIssueMessages(weekReview?.issues ?? [])
          },
          getRemainingBudgetMs: () => deadlineAt - getNow(),
          onBeforeRetry: async () => {
            plan = buildPlanCheckpoint(plan, weeks, {
              generationState: 'generating',
              jobId: input.jobId,
              startedAt,
              updatedAt: getNow(),
            })
            await input.writer.putPlan(plan)
          },
          onAttemptCompleted: async (attempt, attemptResult, createdAt, attemptMaxTokens) => {
            // La acumulación de tokens/costo corre en CADA intento, independiente
            // de `putAttempt` (que es opcional).
            const meta = attemptResult.meta
            anyBillableAttempt = true
            const hasUsage = meta.promptTokens != null && meta.completionTokens != null
            tokenTotals.input += meta.promptTokens ?? 0
            tokenTotals.output += meta.completionTokens ?? 0
            tokenTotals.cacheRead += meta.cacheReadInputTokens ?? 0
            tokenTotals.cacheCreation += meta.cacheCreationInputTokens ?? 0
            if (costUsd !== null) {
              const model = meta.model ?? variant?.model ?? null
              const attemptCost = hasUsage && model
                ? estimateCostUsd({
                    model,
                    at: createdAt,
                    inputTokens: meta.promptTokens ?? 0,
                    outputTokens: meta.completionTokens ?? 0,
                    cacheReadTokens: meta.cacheReadInputTokens ?? 0,
                    cacheCreationTokens: meta.cacheCreationInputTokens ?? 0,
                  })
                : null
              costUsd = attemptCost === null ? null : costUsd + attemptCost
            }
            if (!input.writer.putAttempt) return
            const qualityReview = reviewAttemptWeek(attemptResult)
            await input.writer.putAttempt({
              athleteId: plan.athleteId,
              planId: plan.id,
              jobId: input.jobId,
              weekIndex,
              attempt,
              traceId: meta.traceId,
              provider: meta.provider,
              model: meta.model,
              promptTokens: meta.promptTokens,
              completionTokens: meta.completionTokens,
              cacheCreationInputTokens: meta.cacheCreationInputTokens,
              cacheReadInputTokens: meta.cacheReadInputTokens,
              durationMs: meta.durationMs,
              finishReason: meta.finishReason,
              outcome: classifyAttemptOutcome(attemptResult),
              errorClass: meta.errorClass,
              retryUsed: attempt > 1 || Boolean(meta.retryUsed),
              maxTokens: attemptMaxTokens,
              workerConcurrency: concurrency,
              rawSessionCount: meta.rawSessionCount,
              validSessionCount: meta.validSessionCount,
              droppedSessionCount: meta.droppedSessionCount,
              repairedSessionCount: meta.repairedSessionCount,
              addedFallbackCount: meta.addedFallbackCount,
              qualityScore: qualityReview?.score,
              qualityGrade: qualityReview?.grade,
              qualityCriticalIssueCount: qualityReview?.issues.filter((issue) => issue.severity === 'error').length,
              qualityWarningCount: qualityReview?.issues.filter((issue) => issue.severity === 'warning').length,
              variantId: variant?.variantId,
              effort: variant?.effort,
              thinkingMode: variant?.thinkingMode,
              promptVersion: variant?.promptVersion,
              schemaVersion: variant?.schemaVersion,
              qualityVersion: effectiveQualityVersion,
              repairTaxonomyVersion: meta.repairTaxonomyVersion,
              correctiveActionCount: meta.correctiveActionCount,
              structuralActionCount: meta.structuralActionCount,
              hydrationActionCount: meta.hydrationActionCount,
              movedSessionCount: meta.movedSessionCount,
              filteredSportCount: meta.filteredSportCount,
              hydratedSessionsAffected: meta.hydratedSessionsAffected,
              correctedSessionsAffected: meta.correctedSessionsAffected,
              structurallyRepairedSessionsAffected: meta.structurallyRepairedSessionsAffected,
              createdAt,
            })
          },
        })
        providerResult = result
        if (await checkCancelled()) {
          cancelled = true
          stopLaunching = true
        }
        let fallback: ReturnType<typeof buildLocalFallbackWeek> | undefined
        const fallbackEligible = !NON_FALLBACK_ELIGIBLE_ERROR_CLASSES.has(result.meta.errorClass ?? '')
        if (result.sessions.length === 0 && fallbackEligible) {
          try {
            fallback = buildLocalFallbackWeek({
              plan,
              week: generatingWeek,
              previousWeek,
              planWeekDescriptors: weeks.map((candidate) => ({
                weekIndex: candidate.weekIndex,
                phase: candidate.phase,
              })),
              profile: input.profile,
              wizardConfig: input.wizardConfig,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const erroredWeek = makeErroredWeekFromResult(
              generatingWeek,
              result,
              message,
              getNow(),
              effectiveQualityVersion,
              'local_plan_fallback_failed',
            )
            weeks = replaceWeek(weeks, erroredWeek)
            await input.writer.putWeek(erroredWeek)
            observeWeekWrite(erroredWeek)
            return
          }
        }
        let resolvedWeek = fallback
          ? makeFallbackResolvedWeek(
              generatingWeek,
              result,
              fallback,
              getNow(),
              effectiveQualityVersion,
            )
          : makeResolvedWeek(generatingWeek, result, getNow(), effectiveQualityVersion)
        if (fallback && resolvedWeek.sessions.length > 0) {
          const fallbackReview = reviewPlanQuality(
            plan,
            replaceWeek(weeks, resolvedWeek),
            {
              profile: input.profile,
              qualityVersion: effectiveQualityVersion,
              pendingTargetWeekIndexes: targetWeekIndexes.filter(
                (index) => index !== weekIndex && !terminalTargets.has(index),
              ),
            },
          ).weeks.find((review) => review.weekIndex === weekIndex)
          const fallbackCritical = getCriticalWeekQualityIssueMessages(fallbackReview?.issues ?? [])
          if (fallbackCritical.length > 0) {
            resolvedWeek = {
              ...resolvedWeek,
              status: 'error',
              generationMeta: {
                ...resolvedWeek.generationMeta,
                lastError: `Fallback local rechazado por calidad: ${fallbackCritical.join(' | ')}`,
                errorClass: 'local_plan_fallback_quality',
              },
            }
          }
        }
        weeks = replaceWeek(weeks, resolvedWeek)
        await input.writer.putWeek(resolvedWeek)
        observeWeekWrite(resolvedWeek)
        plan = buildPlanCheckpoint(plan, weeks, {
          generationState: 'generating',
          jobId: input.jobId,
          startedAt,
          updatedAt: resolvedWeek.updatedAt,
          cancelRequested: cancelled || undefined,
        })
        await input.writer.putPlan(plan)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const erroredWeek = providerResult
          ? makeErroredWeekFromResult(
              generatingWeek,
              providerResult,
              message,
              getNow(),
              effectiveQualityVersion,
              'post_generation_failed',
            )
          : makeErroredWeek(generatingWeek, message, getNow())
        weeks = replaceWeek(weeks, erroredWeek)
        await input.writer.putWeek(erroredWeek)
        observeWeekWrite(erroredWeek)
        plan = buildPlanCheckpoint(plan, weeks, {
          generationState: 'generating',
          jobId: input.jobId,
          startedAt,
          updatedAt: erroredWeek.updatedAt,
          cancelRequested: cancelled || undefined,
        })
        await input.writer.putPlan(plan)
      }
    }

    const worker = async (): Promise<void> => {
      while (true) {
        const weekIndex = await takeNextWeekIndex()
        if (weekIndex == null) return
        await generateTargetWeek(weekIndex)
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targetWeekIndexes.length)) }, () => worker()))

    if (!cancelled && await checkCancelled()) {
      cancelled = true
    }

    if (cancelled) {
      const timestamp = getNow()
      plan = buildPlanCheckpoint(plan, weeks, {
        generationState: 'cancelled',
        jobId: input.jobId,
        startedAt,
        updatedAt: timestamp,
        completedAt: timestamp,
        cancelRequested: true,
      })
      await input.writer.putPlan(plan)
      return { plan, weeks, cancelled: true }
    }

    const completedAt = getNow()
    plan = buildPlanCheckpoint(plan, weeks, {
      generationState: deriveAsyncGenerationState(weeks),
      jobId: input.jobId,
      startedAt,
      updatedAt: completedAt,
      completedAt,
    })
    if (plan.generationSummary) {
      plan = {
        ...plan,
        generationSummary: {
          ...plan.generationSummary,
          qualityReview: reviewPlanQuality(plan, weeks, {
            profile: input.profile,
            qualityVersion: effectiveQualityVersion,
          }),
        },
      }
    }
    await input.writer.putPlan(plan)
    return { plan, weeks, cancelled: false }
  } catch (error) {
    threw = true
    throw error
  } finally {
    await finalizeJob(threw)
  }
}
