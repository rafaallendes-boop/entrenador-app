import type { CoachAction, CoachSessionProposal, AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { AIProviderError, type AIProvider, type CreateWeekNormalizationDiagnostic } from '../ai/types'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { normalizeResponse } from '../ai/responseNormalizer'
import { buildWeekStructuredSystemPromptMinimal, buildWeekUserPrompt } from '../week/prompts/weekPrompt'
import { validatePlanWeek } from './validator'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { pickCreateWeekDiagnostic } from '../week/shared'
import { repairGeneratedWeek, type RepairContext } from './repairWeek'
import { createStageTracker, type CoachOutcome, type StageTiming } from '../ai/stageLogger'
import { assertDailyAIRequestLimit } from '../ai/aiTelemetry'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from './dateRange'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from './planBuilderResponseSchema'
import type { PlanBuilderRecentContext } from './recentContext'

export interface GenerateWeekInput {
  provider: AIProvider
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  temperature?: number
  onChunk?: (chunk: string) => void
  retryInstruction?: string
  strictFormatting?: boolean
  recentContext?: PlanBuilderRecentContext
}

export interface GenerateWeekResult {
  sessions: CoachSessionProposal[]
  meta: {
    attempts: number
    provider: AIProvider['name']
    model?: string
    requestClass: 'plan_builder_week'
    traceId: string
    lastError?: string
    promptTokens?: number
    completionTokens?: number
    durationMs?: number
    chunkCount?: number
    retryUsed?: boolean
    fallbackUsed?: boolean
    rawSessionCount?: number
    validSessionCount?: number
    droppedSessionCount?: number
    repairedSessionCount?: number
    movedSessionCount?: number
    addedFallbackCount?: number
    filteredSportCount?: number
    repairWarnings?: Array<{ code: string; message: string }>
    stageTimings?: StageTiming[]
    errorClass?: string
  }
}

export interface WeekActionEvaluation {
  sessions: CoachSessionProposal[]
  error?: string
  rawSessionCount?: number
  validSessionCount?: number
  droppedSessionCount?: number
  repairedSessionCount?: number
  movedSessionCount?: number
  addedFallbackCount?: number
  filteredSportCount?: number
  repairWarnings?: Array<{ code: string; message: string }>
}

export function pickCreateWeekAction(actions: CoachAction[] | undefined, weekStartDate: string): CoachAction | undefined {
  if (!actions || actions.length === 0) return undefined
  return actions.find((a) => a.type === 'create_week' && a.targetDate === weekStartDate)
}

export function summarizeWeekGenerationError(
  error: string | undefined,
  week: TrainingPlanWeek,
  plan?: TrainingPlan,
): string {
  const validRange = plan ? getPlanWeekDateRange(plan, week) : undefined
  if (!error) {
    return validRange
      ? `La semana ${week.weekIndex + 1} debe contener sesiones válidas dentro del rango ${validRange.startDate} a ${validRange.endDate}.`
      : `La semana ${week.weekIndex + 1} debe contener sesiones válidas dentro del rango ${week.weekStartDate} a los 6 días siguientes.`
  }
  if (error.includes('fuera de la semana') || error.includes('fuera del rango')) {
    return validRange
      ? `Todas las sesiones deben caer dentro del rango válido ${validRange.startDate} a ${validRange.endDate}.`
      : `Todas las sesiones deben caer dentro de la semana que comienza el ${week.weekStartDate}.`
  }
  if (error.includes('no devolvió sesiones válidas')) {
    return `Devuelve una acción create_week válida con targetDate=${week.weekStartDate} y sesiones no vacías.`
  }
  if ((error.includes('sesiones válidas de') || error.includes('sesiones válidas completas')) && error.includes('se descartaron')) {
    return `Devuelve exactamente el número pedido de sesiones válidas completas para la semana ${week.weekStartDate}; no omitas campos ni devuelvas sesiones inválidas.`
  }
  if (error.includes('tiene ') && error.includes('sesiones')) {
    return `Devuelve exactamente el número de sesiones pedido, con sesiones válidas completas para la semana que empieza el ${week.weekStartDate}.`
  }
  return `Corrige este problema del intento previo: ${error}`
}

function getRetryableWeekIssues(plan: TrainingPlan, week: TrainingPlanWeek) {
  return validatePlanWeek(plan, week)
    .filter((issue) => issue.severity === 'error')
}

function formatCountMismatchError(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  diagnostic: CreateWeekNormalizationDiagnostic | undefined,
  repairedValidSessions?: number,
  repairedDroppedSessions = 0,
): string {
  const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)
  if (diagnostic && diagnostic.droppedSessions > 0) {
    return `La semana ${week.weekIndex + 1} quedó con ${diagnostic.validSessions} sesiones válidas de ${diagnostic.rawSessions} propuestas; se descartaron ${diagnostic.droppedSessions} por inválidas y el rango válido permite ${expectedSessions}.`
  }

  if (repairedDroppedSessions > 0) {
    return `La semana ${week.weekIndex + 1} quedó con ${repairedValidSessions ?? 0} sesiones válidas completas; se descartaron ${repairedDroppedSessions} por inválidas y el rango válido permite ${expectedSessions}.`
  }

  return `La semana ${week.weekIndex + 1} tiene menos sesiones válidas de las esperadas; devuelve exactamente ${expectedSessions} sesiones para ${week.weekStartDate}.`
}

export function validateGeneratedWeekAction(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  profile: AthleteProfile,
  action: CoachAction | undefined,
  diagnostic?: CreateWeekNormalizationDiagnostic,
  previousWeek?: TrainingPlanWeek,
): WeekActionEvaluation {
  const rawSessionCount = diagnostic?.rawSessions ?? (Array.isArray(action?.sessions) ? action.sessions.length : undefined)
  let normalizedSessionCount = diagnostic?.validSessions ?? (Array.isArray(action?.sessions) ? action.sessions.length : undefined)
  const droppedSessionCount = diagnostic?.droppedSessions ?? (rawSessionCount != null && normalizedSessionCount != null ? rawSessionCount - normalizedSessionCount : 0)

  if (!action || !Array.isArray(action.sessions) || action.sessions.length === 0) {
    return {
      sessions: [],
      error: 'El modelo no devolvió sesiones válidas para la semana.',
      rawSessionCount,
      validSessionCount: normalizedSessionCount,
      droppedSessionCount,
    }
  }

  if (action.targetDate !== week.weekStartDate) {
    return {
      sessions: [],
      error: `El modelo devolvió create_week para ${action.targetDate ?? 'sin targetDate'}, no para ${week.weekStartDate}.`,
      rawSessionCount,
      validSessionCount: normalizedSessionCount,
      droppedSessionCount,
    }
  }

  const context: RepairContext = {
    plan,
    week,
    profile,
    wizardConfig: plan.wizardConfig,
    previousWeek,
  }

  const repairResult = repairGeneratedWeek(action.sessions, context)
  normalizedSessionCount = repairResult.sessions.length

  const retryableIssues = getRetryableWeekIssues(plan, {
    ...week,
    status: 'draft',
    sessions: repairResult.sessions,
  })
  if (retryableIssues.length > 0) {
    const hasCountMismatch = retryableIssues.some((issue) => issue.code === 'week.sessions.count_mismatch')
    return {
      sessions: [],
      error: hasCountMismatch
        ? formatCountMismatchError(plan, week, diagnostic, normalizedSessionCount, repairResult.meta.droppedSessionCount)
        : retryableIssues.slice(0, 2).map((issue) => issue.message).join(' '),
      rawSessionCount,
      validSessionCount: normalizedSessionCount,
      droppedSessionCount: droppedSessionCount + repairResult.meta.droppedSessionCount,
      repairedSessionCount: repairResult.meta.repairedSessionCount,
      movedSessionCount: repairResult.meta.movedSessionCount,
      addedFallbackCount: repairResult.meta.addedFallbackCount,
      filteredSportCount: repairResult.meta.filteredSportCount,
      repairWarnings: repairResult.meta.warnings,
    }
  }

  return {
    sessions: repairResult.sessions,
    rawSessionCount,
    validSessionCount: normalizedSessionCount,
    droppedSessionCount: droppedSessionCount + repairResult.meta.droppedSessionCount,
    repairedSessionCount: repairResult.meta.repairedSessionCount,
    movedSessionCount: repairResult.meta.movedSessionCount,
    addedFallbackCount: repairResult.meta.addedFallbackCount,
    filteredSportCount: repairResult.meta.filteredSportCount,
    repairWarnings: repairResult.meta.warnings,
  }
}

export async function generateWeek(input: GenerateWeekInput): Promise<GenerateWeekResult> {
  const { provider, plan, week, previousWeek, profile, wizardConfig } = input
  const requestClass = 'plan_builder_week' as const
  const traceId = buildAITraceId(requestClass)
  const policy = getAIRequestPolicy(requestClass)
  const tracker = createStageTracker(traceId, requestClass)
  let outcome: CoachOutcome = 'error'
  let chunkCount = 0
  let requestStarted = false

  try {
    await assertDailyAIRequestLimit(requestClass)

    const promptStage = tracker.stage('prompt_build')
    const systemPrompt = buildWeekStructuredSystemPromptMinimal()
    const userMessage = buildWeekUserPrompt({
      plan,
      week,
      previousWeek,
      profile,
      wizardConfig,
      retryInstruction: input.retryInstruction,
      strictFormatting: input.strictFormatting,
      outputFormat: 'json',
      recentContext: input.recentContext,
    })
    promptStage.end({ ok: true })

    useAIDebugStore.getState().startRequest({
      traceId,
      requestClass,
      surface: 'plan_builder',
      startedAt: Date.now(),
    })
    requestStarted = true

    const providerStage = tracker.stage('provider_call')
    const raw = await provider.call({
      requestClass,
      traceId,
      systemPrompt,
      userMessage,
      maxTokens: policy.maxTokens,
      temperature: input.temperature ?? policy.temperature,
      allowFallback: policy.allowFallback,
      responseMimeType: 'application/json',
      responseSchema: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
      onChunk: (chunk) => {
        chunkCount += 1
        input.onChunk?.(chunk)
      },
    })
    providerStage.end({ ok: true })

    const normalizeStage = tracker.stage('normalize')
    const normalized = normalizeResponse(raw)
    const action = pickCreateWeekAction(normalized.actions, week.weekStartDate)
    const diagnostic = pickCreateWeekDiagnostic(normalized, week.weekStartDate, action)
    normalizeStage.end({ ok: !!action })

    const repairStage = tracker.stage('repair')
    const evaluation = validateGeneratedWeekAction(plan, week, profile, action, diagnostic, previousWeek)
    repairStage.end({ ok: !evaluation.error, error: evaluation.error })
    if (evaluation.error) {
      outcome = 'invalid_schema'
      useAIDebugStore.getState().failRequest(traceId, {
        provider: raw.provider,
        model: raw.model,
        durationMs: raw.durationMs,
        errorCode: 'validation_error',
        retryUsed: raw.retryUsed,
        fallbackUsed: raw.fallbackUsed,
        outcome: normalized.meta?.outcome,
        responseCharCount: raw.text.length,
        responsePreview: previewResponse(raw.text),
        finishReason: raw.finishReason,
        actionCount: normalized.actions?.length ?? 0,
        warnings: [
          `validation_error:${evaluation.error}`,
          `sessions:${evaluation.validSessionCount ?? 0}/${evaluation.rawSessionCount ?? 0}`,
          `normalizer_outcome:${normalized.meta?.outcome ?? 'unknown'}`,
          ...(evaluation.repairWarnings ?? []).map((warning) => `${warning.code}:${warning.message}`),
        ],
      })
      return {
        sessions: [],
        meta: {
          attempts: 1,
          provider: provider.name,
          model: raw.model,
          requestClass,
          traceId: raw.traceId ?? traceId,
          lastError: evaluation.error,
          durationMs: raw.durationMs,
          chunkCount,
          retryUsed: raw.retryUsed,
          fallbackUsed: raw.fallbackUsed,
          rawSessionCount: evaluation.rawSessionCount,
          validSessionCount: evaluation.validSessionCount,
          droppedSessionCount: evaluation.droppedSessionCount,
          repairedSessionCount: evaluation.repairedSessionCount,
          movedSessionCount: evaluation.movedSessionCount,
          addedFallbackCount: evaluation.addedFallbackCount,
          filteredSportCount: evaluation.filteredSportCount,
          repairWarnings: evaluation.repairWarnings,
          stageTimings: tracker.timings(),
          errorClass: normalized.meta?.errorClass,
        },
      }
    }

    useAIDebugStore.getState().completeRequest(traceId, {
      provider: raw.provider,
      model: raw.model,
      durationMs: raw.durationMs,
      retryUsed: raw.retryUsed,
      fallbackUsed: raw.fallbackUsed,
      outcome: normalized.meta?.outcome,
      responseCharCount: raw.text.length,
      responsePreview: previewResponse(raw.text),
      finishReason: raw.finishReason,
      actionCount: normalized.actions?.length ?? 0,
      warnings: normalized.meta?.warnings,
    })
    outcome = 'ok'
    return {
      sessions: evaluation.sessions,
      meta: {
        attempts: 1,
        provider: provider.name,
        model: raw.model,
        requestClass,
        traceId: raw.traceId ?? traceId,
        durationMs: raw.durationMs,
        chunkCount,
        retryUsed: raw.retryUsed,
        fallbackUsed: raw.fallbackUsed,
        rawSessionCount: evaluation.rawSessionCount,
        validSessionCount: evaluation.validSessionCount,
        droppedSessionCount: evaluation.droppedSessionCount,
        repairedSessionCount: evaluation.repairedSessionCount,
        movedSessionCount: evaluation.movedSessionCount,
        addedFallbackCount: evaluation.addedFallbackCount,
        filteredSportCount: evaluation.filteredSportCount,
        repairWarnings: evaluation.repairWarnings,
        stageTimings: tracker.timings(),
      },
    }
  } catch (error) {
    outcome = 'error'
    const errorCode = error instanceof AIProviderError ? error.code : undefined
    const message = error instanceof Error ? error.message : String(error)
    if (requestStarted) {
      useAIDebugStore.getState().failRequest(traceId, {
        errorCode: errorCode ?? message,
      })
    }
    return {
      sessions: [],
      meta: {
        attempts: 1,
        provider: provider.name,
        requestClass,
        traceId,
        lastError: message,
        chunkCount,
        stageTimings: tracker.timings(),
        errorClass: errorCode,
      },
    }
  } finally {
    tracker.flush(outcome, { weekIndex: week.weekIndex })
  }
}

function previewResponse(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, 500)
}
