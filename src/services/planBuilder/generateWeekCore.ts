import type { AthleteProfile, CoachAction, CoachSessionProposal, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import type { AIRawResponse, AIRequest, CreateWeekNormalizationDiagnostic } from '../ai/types'
import { normalizeResponse } from '../ai/responseNormalizer'
import { buildWeekStructuredSystemPromptMinimal, buildWeekUserPrompt } from '../week/prompts/weekPrompt'
import { pickCreateWeekDiagnostic } from '../week/shared'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from './dateRange'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from './planBuilderResponseSchema'
import { repairGeneratedWeek, type RepairContext } from './repairWeek'
import { validatePlanWeek } from './validator'

export interface GenerateWeekResult {
  sessions: CoachSessionProposal[]
  meta: {
    attempts: number
    provider: AIRawResponse['provider']
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
    stageTimings?: Array<{ stage: string; durationMs: number; ok: boolean; error?: string }>
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

export type WeekLLMCaller = (req: AIRequest) => Promise<AIRawResponse>

export interface GenerateWeekCoreInput {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: unknown
  retryInstruction?: string
  strictFormatting?: boolean
  temperature?: number
  maxTokens?: number
  traceId: string
  callLLM: WeekLLMCaller
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

export async function generateWeekCore(input: GenerateWeekCoreInput): Promise<GenerateWeekResult> {
  const requestClass = 'plan_builder_week' as const
  const systemPrompt = buildWeekStructuredSystemPromptMinimal()
  const userMessage = buildWeekUserPrompt({
    plan: input.plan,
    week: input.week,
    previousWeek: input.previousWeek,
    profile: input.profile,
    wizardConfig: input.wizardConfig,
    retryInstruction: input.retryInstruction,
    strictFormatting: input.strictFormatting,
    outputFormat: 'json',
    recentContext: input.recentContext as never,
  })

  const raw = await input.callLLM({
    requestClass,
    traceId: input.traceId,
    systemPrompt,
    userMessage,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    responseMimeType: 'application/json',
    responseSchema: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
  })

  const normalized = normalizeResponse(raw)
  const action = pickCreateWeekAction(normalized.actions, input.week.weekStartDate)
  const diagnostic = pickCreateWeekDiagnostic(normalized, input.week.weekStartDate, action)
  const evaluation = validateGeneratedWeekAction(input.plan, input.week, input.profile, action, diagnostic, input.previousWeek)

  return {
    sessions: evaluation.error ? [] : evaluation.sessions,
    meta: {
      attempts: 1,
      provider: raw.provider,
      model: raw.model,
      requestClass,
      traceId: raw.traceId ?? input.traceId,
      lastError: evaluation.error,
      durationMs: raw.durationMs,
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
      errorClass: normalized.meta?.errorClass,
    },
  }
}
