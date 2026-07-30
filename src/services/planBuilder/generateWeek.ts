import type { CoachAction, CoachSessionProposal, AthleteProfile, PlanWizardConfig, StageTiming } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { AIProviderError, type AIRawResponse, type AIProvider, type CreateWeekNormalizationDiagnostic } from '../ai/types'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { validatePlanWeek } from './validator'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { repairGeneratedWeek, type RepairContext } from './repairWeek'
import { createStageTracker, type CoachOutcome } from '../ai/stageLogger'
import { assertDailyAIRequestLimit } from '../ai/aiTelemetry'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from './dateRange'
import { generateWeekCore } from './generateWeekCore'
import type { PlanBuilderRecentContext } from './recentContext'
import { summarizeTaxonomy, type RepairTaxonomySummary } from './repairTaxonomy'
import type { PlanWeekDescriptor } from './blockIdentity'
import { isQualityFailClosedRejection } from './fallbackEligibility'

const EMPTY_REPAIR_TAXONOMY: RepairTaxonomySummary = {
  hydrationActionCount: 0,
  correctiveActionCount: 0,
  structuralActionCount: 0,
  hydratedSessionsAffected: 0,
  correctedSessionsAffected: 0,
  structurallyRepairedSessionsAffected: 0,
}

export interface GenerateWeekInput {
  provider: AIProvider
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  planWeekDescriptors: readonly PlanWeekDescriptor[]
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
    repairTaxonomyVersion: 2
    hydrationActionCount: number
    correctiveActionCount: number
    structuralActionCount: number
    hydratedSessionsAffected: number
    correctedSessionsAffected: number
    structurallyRepairedSessionsAffected: number
    strengthAccessoryRotationActionCount?: number
    strengthAccessoryRotationSessionsAffected?: number
    squashDrillRotationActionCount?: number
    squashDrillRotationSessionsAffected?: number
    squashDrillRotationOmittedCount?: number
    repairWarnings?: Array<{ code: string; message: string }>
    stageTimings?: StageTiming[]
    errorClass?: string
  }
}

export interface WeekActionEvaluation extends RepairTaxonomySummary {
  sessions: CoachSessionProposal[]
  error?: string
  errorClass?: string
  rawSessionCount?: number
  validSessionCount?: number
  droppedSessionCount?: number
  repairedSessionCount?: number
  movedSessionCount?: number
  addedFallbackCount?: number
  filteredSportCount?: number
  repairTaxonomyVersion: 2
  strengthAccessoryRotationActionCount?: number
  strengthAccessoryRotationSessionsAffected?: number
  squashDrillRotationActionCount?: number
  squashDrillRotationSessionsAffected?: number
  squashDrillRotationOmittedCount?: number
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
  planWeekDescriptors: readonly PlanWeekDescriptor[] = [{ weekIndex: week.weekIndex, phase: week.phase }],
): WeekActionEvaluation {
  const rawSessionCount = diagnostic?.rawSessions ?? (Array.isArray(action?.sessions) ? action.sessions.length : undefined)
  let normalizedSessionCount = diagnostic?.validSessions ?? (Array.isArray(action?.sessions) ? action.sessions.length : undefined)
  const droppedSessionCount = diagnostic?.droppedSessions ?? (rawSessionCount != null && normalizedSessionCount != null ? rawSessionCount - normalizedSessionCount : 0)

  if (!action || !Array.isArray(action.sessions) || action.sessions.length === 0) {
    return {
      sessions: [],
      ...EMPTY_REPAIR_TAXONOMY,
      repairTaxonomyVersion: 2,
      error: 'El modelo no devolvió sesiones válidas para la semana.',
      rawSessionCount,
      validSessionCount: normalizedSessionCount,
      droppedSessionCount,
    }
  }

  if (action.targetDate !== week.weekStartDate) {
    return {
      sessions: [],
      ...EMPTY_REPAIR_TAXONOMY,
      repairTaxonomyVersion: 2,
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
    planWeekDescriptors,
  }

  const repairResult = repairGeneratedWeek(action.sessions, context)
  if (repairResult.failure) {
    return {
      sessions: [],
      ...EMPTY_REPAIR_TAXONOMY,
      repairTaxonomyVersion: 2,
      error: repairResult.failure.message,
      errorClass: repairResult.failure.errorClass,
      rawSessionCount,
      validSessionCount: 0,
      droppedSessionCount,
    }
  }
  const taxonomySummary = summarizeTaxonomy(repairResult.meta.taxonomy)
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
      ...taxonomySummary,
      repairTaxonomyVersion: 2,
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
      strengthAccessoryRotationActionCount: repairResult.meta.strengthAccessoryRotationActionCount,
      strengthAccessoryRotationSessionsAffected: repairResult.meta.strengthAccessoryRotationSessionsAffected,
      squashDrillRotationActionCount: repairResult.meta.squashDrillRotationActionCount,
      squashDrillRotationSessionsAffected: repairResult.meta.squashDrillRotationSessionsAffected,
      squashDrillRotationOmittedCount: repairResult.meta.squashDrillRotationOmittedCount,
      repairWarnings: repairResult.meta.warnings,
    }
  }

  return {
    sessions: repairResult.sessions,
    ...taxonomySummary,
    repairTaxonomyVersion: 2,
    rawSessionCount,
    validSessionCount: normalizedSessionCount,
    droppedSessionCount: droppedSessionCount + repairResult.meta.droppedSessionCount,
    repairedSessionCount: repairResult.meta.repairedSessionCount,
    movedSessionCount: repairResult.meta.movedSessionCount,
    addedFallbackCount: repairResult.meta.addedFallbackCount,
    filteredSportCount: repairResult.meta.filteredSportCount,
    strengthAccessoryRotationActionCount: repairResult.meta.strengthAccessoryRotationActionCount,
    strengthAccessoryRotationSessionsAffected: repairResult.meta.strengthAccessoryRotationSessionsAffected,
    squashDrillRotationActionCount: repairResult.meta.squashDrillRotationActionCount,
    squashDrillRotationSessionsAffected: repairResult.meta.squashDrillRotationSessionsAffected,
    squashDrillRotationOmittedCount: repairResult.meta.squashDrillRotationOmittedCount,
    repairWarnings: repairResult.meta.warnings,
  }
}

export async function generateWeek(input: GenerateWeekInput): Promise<GenerateWeekResult> {
  const { provider, plan, week, previousWeek, planWeekDescriptors, profile, wizardConfig } = input
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
    promptStage.end({ ok: true })

    useAIDebugStore.getState().startRequest({
      traceId,
      requestClass,
      surface: 'plan_builder',
      startedAt: Date.now(),
    })
    requestStarted = true

    const providerStage = tracker.stage('provider_call')
    const debugRef: { raw?: AIRawResponse } = {}
    const result = await generateWeekCore({
      plan,
      week,
      previousWeek,
      planWeekDescriptors,
      profile,
      wizardConfig,
      retryInstruction: input.retryInstruction,
      strictFormatting: input.strictFormatting,
      recentContext: input.recentContext,
      traceId,
      maxTokens: policy.maxTokens,
      temperature: input.temperature ?? policy.temperature,
      callLLM: async (req) => {
        const raw = await provider.call({
          ...req,
          allowFallback: policy.allowFallback,
          onChunk: (chunk) => {
            chunkCount += 1
            input.onChunk?.(chunk)
          },
        })
        debugRef.raw = raw
        return raw
      },
    })
    providerStage.end({ ok: true })

    const normalizeStage = tracker.stage('normalize')
    normalizeStage.end({ ok: !result.meta.errorClass })

    const repairStage = tracker.stage('repair')
    repairStage.end({ ok: !result.meta.lastError, error: result.meta.lastError })
    if (result.meta.lastError) {
      const qualityRejected = isQualityFailClosedRejection(result.meta.errorClass)
      outcome = qualityRejected ? 'quality_rejected' : 'invalid_schema'
      const raw = debugRef.raw
      useAIDebugStore.getState().failRequest(traceId, {
        provider: raw?.provider ?? result.meta.provider,
        model: raw?.model ?? result.meta.model,
        durationMs: raw?.durationMs ?? result.meta.durationMs,
        errorCode: qualityRejected ? result.meta.errorClass : 'validation_error',
        retryUsed: raw?.retryUsed ?? result.meta.retryUsed,
        fallbackUsed: raw?.fallbackUsed ?? result.meta.fallbackUsed,
        responseCharCount: raw?.text.length,
        responsePreview: raw ? previewResponse(raw.text) : undefined,
        finishReason: raw?.finishReason,
        warnings: [
          `validation_error:${result.meta.lastError}`,
          `sessions:${result.meta.validSessionCount ?? 0}/${result.meta.rawSessionCount ?? 0}`,
          ...(result.meta.repairWarnings ?? []).map((warning) => `${warning.code}:${warning.message}`),
        ],
      })
      return {
        sessions: [],
        meta: {
          ...result.meta,
          provider: provider.name,
          chunkCount,
          stageTimings: tracker.timings(),
        },
      }
    }

    const raw = debugRef.raw
    useAIDebugStore.getState().completeRequest(traceId, {
      provider: raw?.provider ?? result.meta.provider,
      model: raw?.model ?? result.meta.model,
      durationMs: raw?.durationMs ?? result.meta.durationMs,
      retryUsed: raw?.retryUsed ?? result.meta.retryUsed,
      fallbackUsed: raw?.fallbackUsed ?? result.meta.fallbackUsed,
      responseCharCount: raw?.text.length,
      responsePreview: raw ? previewResponse(raw.text) : undefined,
      finishReason: raw?.finishReason,
    })
    outcome = 'ok'
    return {
      sessions: result.sessions,
      meta: {
        ...result.meta,
        provider: provider.name,
        chunkCount,
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
        ...EMPTY_REPAIR_TAXONOMY,
        attempts: 1,
        provider: provider.name,
        requestClass,
        traceId,
        repairTaxonomyVersion: 2,
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
