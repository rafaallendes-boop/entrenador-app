import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { AIRawResponse, AIRequest } from '../ai/types'
import type { PlanGenerationSummary, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { generateWeekCore, summarizeWeekGenerationError } from './generateWeekCore'
import { countReadyWeeks, isReadyWeek, sortWeeks } from './weekUtils'
import { getExpectedSessionsForPlanWeek } from './dateRange'
import { buildWeekRetryInstruction } from '../week/shared'
import { reviewPlanQuality } from './qualityReview'

export interface AsyncPlanGenerationWriter {
  /** Consulta ligera opcional: solo lee cancelRequested. Si no está, usa getPlan. */
  checkCancelled?: (planId: string) => Promise<boolean>
  getPlan(planId: string): Promise<TrainingPlan | null>
  putPlan(plan: TrainingPlan): Promise<void>
  putWeek(week: TrainingPlanWeek): Promise<void>
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

function makeErroredWeek(week: TrainingPlanWeek, message: string, timestamp: number, errorClass?: string): TrainingPlanWeek {
  return {
    ...week,
    status: 'error',
    sessions: [],
    generationMeta: {
      ...week.generationMeta,
      attempts: Math.max(1, (week.generationMeta.attempts ?? 0) + 1),
      lastError: message,
      lastAttemptAt: timestamp,
      strategy: 'single',
      generationSource: 'ai',
      errorClass,
    },
    updatedAt: timestamp,
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
}): Promise<GenerateWeekCoreResult> {
  let attempts = 0
  let totalDurationMs = 0
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
    lastResult = result
    lastError = result.meta.lastError

    if (result.sessions.length > 0) {
      return {
        ...result,
        meta: {
          ...result.meta,
          attempts,
          durationMs: totalDurationMs || result.meta.durationMs,
          retryUsed: attempts > 1 || result.meta.retryUsed,
        },
      }
    }

    if (result.meta.errorClass === 'rate_limit') break
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
      const erroredWeek = makeErroredWeek(remainingWeek, WORKER_BUDGET_EXHAUSTED_MESSAGE, getNow(), 'timeout')
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
      })
      const resolvedWeek = makeResolvedWeek(generatingWeek, result, getNow())
      weeks = replaceWeek(weeks, resolvedWeek)
      await input.writer.putWeek(resolvedWeek)
      plan = buildPlanCheckpoint(plan, weeks, {
        generationState: 'generating',
        jobId: input.jobId,
        startedAt,
        updatedAt: resolvedWeek.updatedAt,
      })
      await input.writer.putPlan(plan)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const erroredWeek = makeErroredWeek(generatingWeek, message, getNow())
      weeks = replaceWeek(weeks, erroredWeek)
      await input.writer.putWeek(erroredWeek)
      plan = buildPlanCheckpoint(plan, weeks, {
        generationState: 'generating',
        jobId: input.jobId,
        startedAt,
        updatedAt: erroredWeek.updatedAt,
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
