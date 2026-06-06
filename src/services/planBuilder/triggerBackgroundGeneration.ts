import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { supabase } from '../auth'
import type { PlanBuilderRecentContext } from './recentContext'

const FUNCTION_URL = '/.netlify/functions/generate-plan-background'

export interface TriggerBackgroundGenerationInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: PlanBuilderRecentContext
  targetWeekIndexes?: number[]
  repairInstructions?: Record<number, string>
}

export interface TriggerBackgroundGenerationResult {
  jobId?: string
}

export async function triggerBackgroundGeneration(
  input: TriggerBackgroundGenerationInput,
): Promise<TriggerBackgroundGenerationResult> {
  if (!supabase) {
    throw new Error('Supabase no está configurado; no se puede iniciar generación async.')
  }

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw new Error('Necesitas iniciar sesión para generar el plan en segundo plano.')
  }

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => ({})) as { jobId?: string; error?: string }
  if (!response.ok && response.status !== 202) {
    throw new Error(payload.error ?? `No se pudo iniciar la generación async (${response.status}).`)
  }
  return { jobId: payload.jobId }
}
