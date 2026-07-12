import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { AIRawResponse, AIRequest } from '../ai/types'
import type { PlanGenerationSummary, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { generateWeekCore, summarizeWeekGenerationError } from './generateWeekCore'
import { countReadyWeeks, isReadyWeek, sortWeeks } from './weekUtils'
import { getExpectedSessionsForPlanWeek } from './dateRange'
import { buildWeekRetryInstruction } from '../week/shared'
import { reviewPlanQuality } from './qualityReview'
import { buildLocalFallbackWeek } from './fallbackWeek'

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
const DEFAULT_MAX_TOKENS = 5000
const TRUNCATED_RETRY_MAX_TOKENS = 12000
const DEFAULT_TEMPERATURE = 0.25
const MAX_WEEK_ATTEMPTS = 2
const DEFAULT_CONCURRENCY = 3
const MAX_CONCURRENCY = 6
// Netlify background functions se cortan a los 15 min; reservamos margen para
// cerrar el plan con un estado terminal en vez de morir a mitad de una semana.
const DEFAULT_WORKER_BUDGET_MS = 13 * 60_000
const MIN_WEEK_START_BUDGET_MS = 150_000
const MIN_RETRY_BUDGET_MS = 150_000
const WORKER_BUDGET_EXHAUSTED_MESSAGE = 'Generación detenida: se agotó el presupuesto de tiempo del worker antes de llegar a esta semana. Reintenta para generar las semanas pendientes.'

type GenerateWeekCoreResult = Awaited<ReturnType<typeof generateWeekCore>>

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

function normalizeConcurrency(value: number | undefined): number {
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
    cancelRequested: input.cancelRequested ?? plan.generationSummary?.cancelRequested,
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
): TrainingPlanWeek {
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
  errorClass = 'post_generation_failed',
): TrainingPlanWeek {
  const resolved = makeResolvedWeek(week, result, timestamp)
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
  await input.writer.putPlan(plan)

  const targetWeekIndexes = input.targetWeekIndexes?.length
    ? [...input.targetWeekIndexes].sort((a, b) => a - b)
    : weeks.map((week) => week.weekIndex)

  const deadlineAt = getNow() + (input.budgetMs ?? DEFAULT_WORKER_BUDGET_MS)
  const concurrency = normalizeConcurrency(input.concurrency)
  let targetPosition = 0
  let stopLaunching = false
  let cancelled = false

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
    plan = buildPlanCheckpoint(plan, weeks, {
      generationState: 'generating',
      jobId: input.jobId,
      startedAt,
      updatedAt: generatingWeek.updatedAt,
    })
    await input.writer.putPlan(plan)

    let providerResult: GenerateWeekCoreResult | undefined
    try {
      // En generación paralela la semana previa puede no estar lista todavía.
      // Usamos la versión generada si existe (para evitar clonar sesiones), y si
      // no, caemos al shell de la semana previa: conserva fase y carga objetivo
      // para que la directiva de progresión sea correcta y no trate una semana
      // intermedia como "primera semana del plan".
      const previousWeek = weeks.find((week) => week.weekIndex === weekIndex - 1 && isReadyWeek(week))
        ?? weeks.find((week) => week.weekIndex === weekIndex - 1)
      const result = await generateWeekCoreWithRetry({
        plan,
        week: generatingWeek,
        previousWeek,
        profile: input.profile,
        wizardConfig: input.wizardConfig,
        recentContext: input.recentContext as never,
        initialRepairInstruction: input.repairInstructions?.[weekIndex],
        traceId: `${input.jobId}-week-${weekIndex}`,
        maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: input.temperature ?? DEFAULT_TEMPERATURE,
        callLLM: input.callLLM,
        getCriticalQualityIssues: (candidateResult) => {
          const candidateWeek: TrainingPlanWeek = {
            ...generatingWeek,
            status: 'draft',
            sessions: candidateResult.sessions,
            generationMeta: {
              ...generatingWeek.generationMeta,
              attempts: candidateResult.meta.attempts,
              fallbackUsed: candidateResult.meta.fallbackUsed,
              repairedSessionCount: candidateResult.meta.repairedSessionCount,
              movedSessionCount: candidateResult.meta.movedSessionCount,
              addedFallbackCount: candidateResult.meta.addedFallbackCount,
              filteredSportCount: candidateResult.meta.filteredSportCount,
              droppedSessionCount: candidateResult.meta.droppedSessionCount,
              generationSource: 'ai',
            },
          }
          const weekReview = reviewPlanQuality(
            plan,
            replaceWeek(weeks, candidateWeek),
            { profile: input.profile },
          ).weeks.find((review) => review.weekIndex === weekIndex)
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
        onAttemptCompleted: input.writer.putAttempt
          ? async (attempt, attemptResult, createdAt, attemptMaxTokens) => {
            const scoredWeek: TrainingPlanWeek = {
              ...generatingWeek,
              status: attemptResult.sessions.length > 0 ? 'draft' : 'error',
              sessions: attemptResult.sessions,
              generationMeta: {
                ...generatingWeek.generationMeta,
                attempts: 1,
                repairedSessionCount: attemptResult.meta.repairedSessionCount,
                movedSessionCount: attemptResult.meta.movedSessionCount,
                addedFallbackCount: attemptResult.meta.addedFallbackCount,
                filteredSportCount: attemptResult.meta.filteredSportCount,
                droppedSessionCount: attemptResult.meta.droppedSessionCount,
                errorClass: attemptResult.meta.errorClass,
                generationSource: 'ai',
              },
            }
            const qualityReview = attemptResult.sessions.length > 0
              ? reviewPlanQuality(plan, replaceWeek(weeks, scoredWeek), { profile: input.profile })
                .weeks.find((review) => review.weekIndex === weekIndex)
              : undefined
            await input.writer.putAttempt!({
              athleteId: plan.athleteId,
              planId: plan.id,
              jobId: input.jobId,
              weekIndex,
              attempt,
              traceId: attemptResult.meta.traceId,
              provider: attemptResult.meta.provider,
              model: attemptResult.meta.model,
              promptTokens: attemptResult.meta.promptTokens,
              completionTokens: attemptResult.meta.completionTokens,
              cacheCreationInputTokens: attemptResult.meta.cacheCreationInputTokens,
              cacheReadInputTokens: attemptResult.meta.cacheReadInputTokens,
              durationMs: attemptResult.meta.durationMs,
              finishReason: attemptResult.meta.finishReason,
              outcome: classifyAttemptOutcome(attemptResult),
              errorClass: attemptResult.meta.errorClass,
              retryUsed: attempt > 1 || Boolean(attemptResult.meta.retryUsed),
              maxTokens: attemptMaxTokens,
              workerConcurrency: concurrency,
              rawSessionCount: attemptResult.meta.rawSessionCount,
              validSessionCount: attemptResult.meta.validSessionCount,
              droppedSessionCount: attemptResult.meta.droppedSessionCount,
              repairedSessionCount: attemptResult.meta.repairedSessionCount,
              addedFallbackCount: attemptResult.meta.addedFallbackCount,
              qualityScore: qualityReview?.score,
              qualityGrade: qualityReview?.grade,
              qualityCriticalIssueCount: qualityReview?.issues.filter((issue) => issue.severity === 'error').length,
              qualityWarningCount: qualityReview?.issues.filter((issue) => issue.severity === 'warning').length,
              createdAt,
            })
          }
          : undefined,
      })
      providerResult = result
      if (await checkCancelled()) {
        cancelled = true
        stopLaunching = true
      }
      let fallback: ReturnType<typeof buildLocalFallbackWeek> | undefined
      if (result.sessions.length === 0) {
        try {
          fallback = buildLocalFallbackWeek({
            plan,
            week: generatingWeek,
            previousWeek,
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
            'local_plan_fallback_failed',
          )
          weeks = replaceWeek(weeks, erroredWeek)
          await input.writer.putWeek(erroredWeek)
          return
        }
      }
      let resolvedWeek = fallback
        ? makeFallbackResolvedWeek(generatingWeek, result, fallback, getNow())
        : makeResolvedWeek(generatingWeek, result, getNow())
      if (fallback && resolvedWeek.sessions.length > 0) {
        const fallbackReview = reviewPlanQuality(
          plan,
          replaceWeek(weeks, resolvedWeek),
          { profile: input.profile },
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
        ? makeErroredWeekFromResult(generatingWeek, providerResult, message, getNow(), 'post_generation_failed')
        : makeErroredWeek(generatingWeek, message, getNow())
      weeks = replaceWeek(weeks, erroredWeek)
      await input.writer.putWeek(erroredWeek)
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
        qualityReview: reviewPlanQuality(plan, weeks, { profile: input.profile }),
      },
    }
  }
  await input.writer.putPlan(plan)
  return { plan, weeks, cancelled: false }
}
