import type { CoachAction, CoachSessionProposal, AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import type { AIProvider, CoachNormalizedResponse, CreateWeekNormalizationDiagnostic } from '../ai/types'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { normalizeResponse } from '../ai/responseNormalizer'
import { buildWeekSystemPrompt, buildWeekUserPrompt } from './prompts/weekPrompt'
import { validatePlanWeek } from './validator'
import { useAIDebugStore } from '../../store/useAIDebugStore'

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
  }
}

export interface WeekActionEvaluation {
  sessions: CoachSessionProposal[]
  error?: string
  rawSessionCount?: number
  validSessionCount?: number
  droppedSessionCount?: number
}

export function pickCreateWeekAction(actions: CoachAction[] | undefined, weekStartDate: string): CoachAction | undefined {
  if (!actions || actions.length === 0) return undefined
  return actions.find((a) => a.type === 'create_week' && a.targetDate === weekStartDate)
}

export function pickCreateWeekDiagnostic(
  normalized: Pick<CoachNormalizedResponse, 'meta'>,
  weekStartDate: string,
  action?: CoachAction,
): CreateWeekNormalizationDiagnostic | undefined {
  const diagnostics = normalized.meta?.createWeekDiagnostics
  if (!diagnostics || diagnostics.length === 0) return undefined

  if (action?.targetDate) {
    const exact = diagnostics.find((diagnostic) => diagnostic.targetDate === action.targetDate)
    if (exact) return exact
  }

  const byWeek = diagnostics.find((diagnostic) => diagnostic.targetDate === weekStartDate)
  if (byWeek) return byWeek

  return diagnostics.length === 1 ? diagnostics[0] : undefined
}

function isStrictISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

export function filterSessionsToWeek(
  sessions: CoachSessionProposal[],
  weekStartDate: string,
): CoachSessionProposal[] {
  const [y, m, d] = weekStartDate.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  const end = start + 7 * 24 * 60 * 60 * 1000
  return sessions.filter((s) => {
    if (!isStrictISODate(s.date)) return false
    const [sy, sm, sd] = s.date.split('-').map(Number)
    const ts = new Date(sy, sm - 1, sd).getTime()
    return ts >= start && ts < end
  })
}

export function summarizeWeekGenerationError(
  error: string | undefined,
  week: TrainingPlanWeek,
): string {
  if (!error) {
    return `La semana ${week.weekIndex + 1} debe contener sesiones válidas dentro del rango ${week.weekStartDate} a los 6 días siguientes.`
  }
  if (error.includes('fuera de la semana')) {
    return `Todas las sesiones deben caer dentro de la semana que comienza el ${week.weekStartDate}.`
  }
  if (error.includes('no devolvió sesiones válidas')) {
    return `Devuelve una acción create_week válida con targetDate=${week.weekStartDate} y sesiones no vacías.`
  }
  if (error.includes('sesiones válidas de') && error.includes('se descartaron')) {
    return `Devuelve exactamente el número pedido de sesiones válidas completas para la semana ${week.weekStartDate}; no omitas campos ni devuelvas sesiones inválidas.`
  }
  if (error.includes('tiene ') && error.includes('sesiones')) {
    return `Devuelve exactamente el número de sesiones solicitado por el wizard para la semana que empieza el ${week.weekStartDate}.`
  }
  return `Corrige este problema del intento previo: ${error}`
}

function getRetryableWeekIssues(plan: TrainingPlan, week: TrainingPlanWeek) {
  return validatePlanWeek(plan, week)
    .filter((issue) =>
      issue.severity === 'error'
      || issue.code === 'week.sessions.count_mismatch'
      || issue.code === 'week.sessions.out_of_allowed_day'
      || issue.code === 'week.primary_sport.underweighted'
      || issue.code.endsWith('missing_details'),
    )
}

function formatCountMismatchError(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  diagnostic: CreateWeekNormalizationDiagnostic | undefined,
): string {
  if (diagnostic && diagnostic.droppedSessions > 0) {
    return `La semana ${week.weekIndex + 1} quedó con ${diagnostic.validSessions} sesiones válidas de ${diagnostic.rawSessions} propuestas; se descartaron ${diagnostic.droppedSessions} por inválidas y el wizard esperaba ${plan.wizardConfig.sessionsPerWeek}.`
  }

  return `La semana ${week.weekIndex + 1} tiene menos sesiones válidas de las esperadas; devuelve exactamente ${plan.wizardConfig.sessionsPerWeek} sesiones para ${week.weekStartDate}.`
}

export function validateGeneratedWeekAction(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  action: CoachAction | undefined,
  diagnostic?: CreateWeekNormalizationDiagnostic,
): WeekActionEvaluation {
  const rawSessionCount = diagnostic?.rawSessions ?? (Array.isArray(action?.sessions) ? action.sessions.length : undefined)
  const normalizedSessionCount = diagnostic?.validSessions ?? (Array.isArray(action?.sessions) ? action.sessions.length : undefined)
  const droppedSessionCount = diagnostic?.droppedSessions ?? (rawSessionCount != null && normalizedSessionCount != null ? rawSessionCount - normalizedSessionCount : undefined)

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

  const sessions = filterSessionsToWeek(action.sessions, week.weekStartDate)
  if (sessions.length !== action.sessions.length) {
    return {
      sessions: [],
      error: 'Las sesiones devueltas no respetaron exactamente la semana objetivo.',
      rawSessionCount,
      validSessionCount: sessions.length,
      droppedSessionCount,
    }
  }

  const retryableIssues = getRetryableWeekIssues(plan, {
    ...week,
    status: 'draft',
    sessions,
  })
  if (retryableIssues.length > 0) {
    const hasCountMismatch = retryableIssues.some((issue) => issue.code === 'week.sessions.count_mismatch')
    return {
      sessions: [],
      error: hasCountMismatch
        ? formatCountMismatchError(plan, week, diagnostic)
        : retryableIssues.slice(0, 2).map((issue) => issue.message).join(' '),
      rawSessionCount,
      validSessionCount: sessions.length,
      droppedSessionCount,
    }
  }

  return {
    sessions,
    rawSessionCount,
    validSessionCount: sessions.length,
    droppedSessionCount,
  }
}

export async function generateWeek(input: GenerateWeekInput): Promise<GenerateWeekResult> {
  const { provider, plan, week, previousWeek, profile, wizardConfig } = input
  const systemPrompt = buildWeekSystemPrompt()
  const userMessage = buildWeekUserPrompt({
    plan,
    week,
    previousWeek,
    profile,
    wizardConfig,
    retryInstruction: input.retryInstruction,
    strictFormatting: input.strictFormatting,
  })

  let chunkCount = 0
  const requestClass = 'plan_builder_week' as const
  const traceId = buildAITraceId(requestClass)
  const policy = getAIRequestPolicy(requestClass)
  useAIDebugStore.getState().startRequest({
    traceId,
    requestClass,
    surface: 'plan_builder',
    startedAt: Date.now(),
  })

  try {
    const raw = await provider.call({
      requestClass,
      traceId,
      systemPrompt,
      userMessage,
      maxTokens: policy.maxTokens,
      temperature: input.temperature ?? policy.temperature,
      allowFallback: policy.allowFallback,
      onChunk: (chunk) => {
        chunkCount += 1
        if (chunkCount === 1) {
          useAIDebugStore.getState().markFirstChunk(traceId)
        }
        input.onChunk?.(chunk)
      },
    })
    const normalized = normalizeResponse(raw)
    const action = pickCreateWeekAction(normalized.actions, week.weekStartDate)
    const diagnostic = pickCreateWeekDiagnostic(normalized, week.weekStartDate, action)
    const evaluation = validateGeneratedWeekAction(plan, week, action, diagnostic)
    if (evaluation.error) {
      useAIDebugStore.getState().failRequest(traceId, {
        provider: raw.provider,
        model: raw.model,
        durationMs: raw.durationMs,
        errorCode: 'validation_error',
        retryUsed: raw.retryUsed,
        fallbackUsed: raw.fallbackUsed,
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
        },
      }
    }

    useAIDebugStore.getState().completeRequest(traceId, {
      provider: raw.provider,
      model: raw.model,
      durationMs: raw.durationMs,
      retryUsed: raw.retryUsed,
      fallbackUsed: raw.fallbackUsed,
    })
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
      },
    }
  } catch (error) {
    useAIDebugStore.getState().failRequest(traceId, {
      errorCode: error instanceof Error ? error.message : 'unknown',
    })
    return {
      sessions: [],
      meta: {
        attempts: 1,
        provider: provider.name,
        requestClass,
        traceId,
        lastError: error instanceof Error ? error.message : String(error),
        chunkCount,
      },
    }
  }
}
