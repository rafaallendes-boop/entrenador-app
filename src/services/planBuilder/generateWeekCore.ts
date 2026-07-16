import type { AthleteProfile, CoachAction, CoachSessionProposal, PlanWizardConfig, StageTiming } from '../../types'
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
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
    finishReason?: string
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

const DROP_REASON_HINTS: ReadonlyArray<readonly [token: string, hint: string]> = [
  ['squashDetails', 'Cada sesión de squash debe incluir squashDetails con trainingFocus en {technical, tactical, physical, conditioned_games}, sessionMode en {drill_session, practice_match, competition_match} y drills[] con al menos un drill con name.'],
  ['durationMin', 'durationMin debe ser un número entero >= 5 en cada sesión.'],
  ['timeBlock', 'timeBlock debe ser exactamente "AM" o "PM" en cada sesión.'],
  ['sessionType', 'sessionType debe ser uno de: squash, running, cycling, strength, mobility, recovery.'],
  ['title', 'Cada sesión necesita title no vacío.'],
  ['date', 'Cada sesión necesita date en formato YYYY-MM-DD dentro del rango válido de la semana.'],
]

function buildDropReasonHints(error: string | undefined): string {
  if (!error) return ''
  const hints = DROP_REASON_HINTS
    .filter(([token]) => error.includes(token))
    .map(([, hint]) => hint)
  return hints.length > 0 ? ` ${hints.join(' ')}` : ''
}

export function summarizeDroppedSessionReasons(
  reasons: Array<{ index: number; reason: string }> | undefined,
): string | undefined {
  if (!reasons || reasons.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const { reason } of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => (count > 1 ? `${reason} x${count}` : reason))
    .join(', ')
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
    return `Devuelve exactamente el número pedido de sesiones válidas completas para la semana ${week.weekStartDate}; no omitas campos ni devuelvas sesiones inválidas.${buildDropReasonHints(error)}`
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
    const reasons = summarizeDroppedSessionReasons(diagnostic.droppedSessionReasons)
    return `La semana ${week.weekIndex + 1} quedó con ${diagnostic.validSessions} sesiones válidas de ${diagnostic.rawSessions} propuestas; se descartaron ${diagnostic.droppedSessions} por inválidas y el rango válido permite ${expectedSessions}.${reasons ? ` Motivos de descarte: ${reasons}.` : ''}`
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

function isProviderTruncated(raw: AIRawResponse): boolean {
  if (raw.truncated === true || raw.errorClass === 'truncated') return true
  if (!raw.finishReason) return false
  const normalized = raw.finishReason.toLowerCase()
  return normalized === 'max_tokens' ||
    normalized === 'max_output_tokens' ||
    normalized === 'length' ||
    normalized.includes('max_token')
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
  const wasTruncated = isProviderTruncated(raw)
  const lastError = evaluation.error && wasTruncated
    ? `La respuesta del modelo fue truncada por presupuesto de tokens antes de devolver sesiones válidas para la semana ${input.week.weekIndex + 1}.`
    : evaluation.error

  return {
    sessions: evaluation.error ? [] : evaluation.sessions,
    meta: {
      attempts: 1,
      provider: raw.provider,
      model: raw.model,
      requestClass,
      traceId: raw.traceId ?? input.traceId,
      lastError,
      durationMs: raw.durationMs,
      promptTokens: raw.promptTokens,
      completionTokens: raw.completionTokens,
      cacheCreationInputTokens: raw.cacheCreationInputTokens,
      cacheReadInputTokens: raw.cacheReadInputTokens,
      finishReason: raw.finishReason,
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
      errorClass: evaluation.error
        ? (wasTruncated ? 'truncated' : 'validation')
        : normalized.meta?.errorClass,
    },
  }
}
