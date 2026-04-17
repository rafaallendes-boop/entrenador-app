import type { CoachAction, CoachSessionProposal, AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import type { AIProvider } from '../ai/types'
import { normalizeResponse } from '../ai/responseNormalizer'
import { buildWeekSystemPrompt, buildWeekUserPrompt } from './prompts/weekPrompt'

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
    lastError?: string
    promptTokens?: number
    completionTokens?: number
    durationMs?: number
    chunkCount?: number
  }
}

export function pickCreateWeekAction(actions: CoachAction[] | undefined, weekStartDate: string): CoachAction | undefined {
  if (!actions || actions.length === 0) return undefined
  const forDate = actions.find((a) => a.type === 'create_week' && a.targetDate === weekStartDate)
  if (forDate) return forDate
  return actions.find((a) => a.type === 'create_week')
}

export function filterSessionsToWeek(
  sessions: CoachSessionProposal[],
  weekStartDate: string,
): CoachSessionProposal[] {
  const [y, m, d] = weekStartDate.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  const end = start + 7 * 24 * 60 * 60 * 1000
  return sessions.filter((s) => {
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
  return `Corrige este problema del intento previo: ${error}`
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

  try {
    const raw = await provider.call({
      systemPrompt,
      userMessage,
      maxTokens: 3500,
      temperature: input.temperature ?? 0.4,
      onChunk: (chunk) => {
        chunkCount += 1
        input.onChunk?.(chunk)
      },
    })
    const normalized = normalizeResponse(raw)
    const action = pickCreateWeekAction(normalized.actions, week.weekStartDate)
    if (!action || !Array.isArray(action.sessions) || action.sessions.length === 0) {
      return {
        sessions: [],
        meta: {
          attempts: 1,
          provider: provider.name,
          model: raw.model,
          lastError: 'El modelo no devolvió sesiones válidas para la semana.',
          durationMs: raw.durationMs,
          chunkCount,
        },
      }
    }

    const sessions = filterSessionsToWeek(action.sessions, week.weekStartDate)
    if (sessions.length === 0) {
      return {
        sessions: [],
        meta: {
          attempts: 1,
          provider: provider.name,
          model: raw.model,
          lastError: 'Las sesiones devueltas cayeron fuera de la semana objetivo.',
          durationMs: raw.durationMs,
          chunkCount,
        },
      }
    }

    return {
      sessions,
      meta: {
        attempts: 1,
        provider: provider.name,
        model: raw.model,
        durationMs: raw.durationMs,
        chunkCount,
      },
    }
  } catch (error) {
    return {
      sessions: [],
      meta: {
        attempts: 1,
        provider: provider.name,
        lastError: error instanceof Error ? error.message : String(error),
        chunkCount,
      },
    }
  }
}
