import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { supabase } from '../auth'
import { trimRecentContextForPayload, type PlanBuilderRecentContext } from './recentContext'
import { resolveApiUrl } from '../apiUrl'
import {
  isEntitlementRequiredDetail,
  type EntitlementRequiredDetail,
} from '../entitlements/entitlementError'

// Synchronous enqueue/ack endpoint. Unlike the background function (which always
// replies 202 with an empty body), this one validates auth/payload, writes a
// durable jobId, kicks off the background worker and returns a real result, so
// the client can surface genuine errors instead of waiting for a stalled poll.
const ENQUEUE_PATH = '/.netlify/functions/enqueue-plan-generation'

// Netlify caps synchronous function request bodies around 256 KB. We keep a
// safety margin and fail fast with a recoverable error instead of letting the
// platform drop the request before the handler writes durable state.
export const MAX_PAYLOAD_BYTES = 200 * 1024

/**
 * Thrown when the generation request is definitively rejected before any worker
 * can start. Callers should surface it rather than falling back to polling; that
 * path is reserved for ambiguous network failures where the request may still
 * have reached the server.
 */
export class PlanEnqueueRejectedError extends Error {
  readonly statusCode: number
  /** Metadata de oferta cuando el rechazo fue por plan; `null` en el resto. */
  readonly entitlement: EntitlementRequiredDetail | null

  constructor(
    message: string,
    statusCode: number,
    entitlement: EntitlementRequiredDetail | null = null,
  ) {
    super(message)
    this.name = 'PlanEnqueueRejectedError'
    this.statusCode = statusCode
    this.entitlement = entitlement
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
    throw new PlanEnqueueRejectedError(
      'Supabase no está configurado; no se puede iniciar generación async.',
      503,
    )
  }

  const { data } = await supabase.auth.getSession().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new PlanEnqueueRejectedError(`No se pudo verificar la sesión: ${message}`, 401)
  })
  const token = data.session?.access_token
  if (!token) {
    throw new PlanEnqueueRejectedError(
      'Necesitas iniciar sesión para generar el plan en segundo plano.',
      401,
    )
  }

  const payload: TriggerBackgroundGenerationInput = {
    ...input,
    recentContext: input.recentContext ? trimRecentContextForPayload(input.recentContext) : undefined,
  }
  const body = JSON.stringify(payload)
  const sizeBytes = byteLength(body)
  if (sizeBytes > MAX_PAYLOAD_BYTES) {
    throw new PlanEnqueueRejectedError(
      `El plan es demasiado grande para enviarlo a generación (${Math.round(sizeBytes / 1024)} KB sobre el límite de ${Math.round(MAX_PAYLOAD_BYTES / 1024)} KB). Reduce el rango de semanas y vuelve a intentarlo.`,
      413,
    )
  }

  const response = await fetch(resolveApiUrl(ENQUEUE_PATH), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  })
  const result = await response.json().catch(() => ({})) as {
    jobId?: string
    error?: string
    errorCode?: string
    detail?: unknown
  }
  if (!response.ok) {
    // Sólo el 403 contractual se convierte en oferta. Un 500 que por accidente
    // copie esa metadata sigue siendo un fallo técnico.
    const entitlement = response.status === 403
      && result.errorCode === 'entitlement_required'
      && isEntitlementRequiredDetail(result.detail)
      ? result.detail
      : null
    throw new PlanEnqueueRejectedError(
      result.error ?? `No se pudo iniciar la generación async (${response.status}).`,
      response.status,
      entitlement,
    )
  }
  return { jobId: result.jobId }
}
