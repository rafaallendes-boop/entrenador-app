import type { AIProvider } from '../ai/types'
import { ClaudeProvider } from '../ai/providers/ClaudeProvider'
import { OpenAIProvider } from '../ai/providers/OpenAIProvider'
import { GeminiProvider } from '../ai/providers/GeminiProvider'
import { MockProvider } from '../ai/providers/MockProvider'
import { ProxyProvider } from '../ai/providers/ProxyProvider'
import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { generateWeek } from './generateWeek'

function getActiveProvider(): AIProvider {
  if (import.meta.env.PROD) return new ProxyProvider()
  const name = (import.meta.env.VITE_AI_PROVIDER ?? 'mock').toLowerCase()
  switch (name) {
    case 'proxy': return new ProxyProvider()
    case 'claude': return new ClaudeProvider()
    case 'openai': return new OpenAIProvider()
    case 'gemini': return new GeminiProvider()
    default: return new MockProvider()
  }
}

export interface GeneratePlanWeeksInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  provider?: AIProvider
  onWeekUpdate?: (week: TrainingPlanWeek) => void
  abortSignal?: AbortSignal
  seedPreviousWeek?: TrainingPlanWeek
}

/**
 * Sequentially generates sessions for each week in the plan.
 * Each week is an independent LLM request so failures are localized.
 * Calls onWeekUpdate whenever a week transitions state so the UI can stream.
 */
export async function generatePlanWeeks(input: GeneratePlanWeeksInput): Promise<TrainingPlanWeek[]> {
  const provider = input.provider ?? getActiveProvider()
  const results: TrainingPlanWeek[] = []
  let previousWeek: TrainingPlanWeek | undefined = input.seedPreviousWeek
  for (const week of input.weeks) {
    if (input.abortSignal?.aborted) {
      results.push(week)
      continue
    }
    const generating: TrainingPlanWeek = { ...week, status: 'generating', updatedAt: Date.now() }
    input.onWeekUpdate?.(generating)

    const result = await generateWeek({
      provider,
      plan: input.plan,
      week,
      previousWeek,
      profile: input.profile,
      wizardConfig: input.wizardConfig,
    })

    const nowTs = Date.now()
    const resolved: TrainingPlanWeek = {
      ...week,
      status: result.sessions.length > 0 ? 'draft' : 'error',
      sessions: result.sessions,
      generationMeta: {
        ...week.generationMeta,
        attempts: (week.generationMeta.attempts ?? 0) + result.meta.attempts,
        provider: result.meta.provider,
        model: result.meta.model,
        lastError: result.meta.lastError,
        lastAttemptAt: nowTs,
      },
      updatedAt: nowTs,
    }
    input.onWeekUpdate?.(resolved)
    results.push(resolved)
    if (resolved.status === 'draft') {
      previousWeek = resolved
    }
  }
  return results
}
