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
  maxAttempts?: number
  temperature?: number
}

export interface GenerateWeekResult {
  sessions: CoachSessionProposal[]
  meta: {
    attempts: number
    provider: string
    model?: string
    lastError?: string
    promptTokens?: number
    completionTokens?: number
  }
}

function pickCreateWeekAction(actions: CoachAction[] | undefined, weekStartDate: string): CoachAction | undefined {
  if (!actions || actions.length === 0) return undefined
  const forDate = actions.find((a) => a.type === 'create_week' && a.targetDate === weekStartDate)
  if (forDate) return forDate
  return actions.find((a) => a.type === 'create_week')
}

function filterSessionsToWeek(
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

export async function generateWeek(input: GenerateWeekInput): Promise<GenerateWeekResult> {
  const { provider, plan, week, previousWeek, profile, wizardConfig } = input
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3)
  const systemPrompt = buildWeekSystemPrompt()
  const userMessage = buildWeekUserPrompt({ plan, week, previousWeek, profile, wizardConfig })

  let lastError: string | undefined
  let attempts = 0
  let lastModel: string | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts++
    const temperature = attempt === 0 ? (input.temperature ?? 0.4) : 0.25
    try {
      const raw = await provider.call({
        systemPrompt,
        userMessage,
        maxTokens: 3500,
        temperature,
      })
      lastModel = raw.model
      const normalized = normalizeResponse(raw)
      const action = pickCreateWeekAction(normalized.actions, week.weekStartDate)
      if (!action || !Array.isArray(action.sessions) || action.sessions.length === 0) {
        lastError = 'El modelo no devolvió sesiones válidas para la semana.'
        continue
      }
      const sessions = filterSessionsToWeek(action.sessions, week.weekStartDate)
      if (sessions.length === 0) {
        lastError = 'Las sesiones devueltas cayeron fuera de la semana objetivo.'
        continue
      }
      return {
        sessions,
        meta: {
          attempts,
          provider: provider.name,
          model: lastModel,
        },
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    sessions: [],
    meta: {
      attempts,
      provider: provider.name,
      model: lastModel,
      lastError,
    },
  }
}
