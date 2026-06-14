import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { supabase } from '../auth'
import { trimRecentContextForPayload, type PlanBuilderRecentContext } from './recentContext'

// Synchronous enqueue/ack endpoint. Unlike the background function (which always
// replies 202 with an empty body), this one validates auth/payload, writes a
// durable jobId, kicks off the background worker and returns a real result, so
// the client can surface genuine errors instead of waiting for a stalled poll.
const ENQUEUE_URL = '/.netlify/functions/enqueue-plan-generation'

// Netlify caps synchronous function request bodies around 256 KB. We keep a
// safety margin and fail fast with a recoverable error instead of letting the
// platform drop the request before the handler writes durable state.
export const MAX_PAYLOAD_BYTES = 200 * 1024

/**
 * Thrown when the enqueue endpoint definitively rejects the request (non-2xx).
 * The worker did NOT start, so callers should surface the error rather than
 * fall back to "keep polling" — that path is reserved for ambiguous network
 * failures where the request may still have reached the server.
 */
export class PlanEnqueueRejectedError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'PlanEnqueueRejectedError'
    this.statusCode = statusCode
  }
}

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

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length
  return value.length
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

  const payload: TriggerBackgroundGenerationInput = {
    ...input,
    recentContext: input.recentContext ? trimRecentContextForPayload(input.recentContext) : undefined,
  }
  const body = JSON.stringify(payload)
  const sizeBytes = byteLength(body)
  if (sizeBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `El plan es demasiado grande para enviarlo a generación (${Math.round(sizeBytes / 1024)} KB sobre el límite de ${Math.round(MAX_PAYLOAD_BYTES / 1024)} KB). Reduce el rango de semanas y vuelve a intentarlo.`,
    )
  }

  const response = await fetch(ENQUEUE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  })
  const result = await response.json().catch(() => ({})) as { jobId?: string; error?: string }
  if (!response.ok) {
    throw new PlanEnqueueRejectedError(
      result.error ?? `No se pudo iniciar la generación async (${response.status}).`,
      response.status,
    )
  }
  return { jobId: result.jobId }
}
