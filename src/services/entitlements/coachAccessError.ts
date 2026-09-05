import { AIProviderError } from '../ai/types'
import type { DenialReason } from './resolveCapability'

/**
 * Una denegación de ROL o de MEMBRESÍA no es una oferta de plan. Representarla
 * como `entitlement_required` le dice a un coach Avanzado sin vínculo con el
 * atleta que «suba a Avanzado», que es el plan que ya tiene: el usuario no
 * puede actuar sobre ese mensaje y la métrica de upsell queda contaminada con
 * rechazos que ningún pago resuelve.
 */
export const COACH_ACCESS_ERROR_CODE = 'coach_access_required' as const

/** Subconjunto de `DenialReason` que NO se resuelve cambiando de plan. */
export type CoachAccessReason = Extract<DenialReason, 'role' | 'membership' | 'identity'>

const COACH_ACCESS_REASONS: readonly CoachAccessReason[] = ['role', 'membership', 'identity']

export function isCoachAccessReason(value: unknown): value is CoachAccessReason {
  return typeof value === 'string'
    && (COACH_ACCESS_REASONS as readonly string[]).includes(value)
}

export interface CoachAccessRequiredDetail {
  requestClass: string
  reason: CoachAccessReason
}

export function isCoachAccessRequiredDetail(
  value: unknown,
): value is CoachAccessRequiredDetail {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CoachAccessRequiredDetail>
  return typeof candidate.requestClass === 'string'
    && candidate.requestClass.length > 0
    && isCoachAccessReason(candidate.reason)
}

/**
 * Copy honesto por causa. Ninguno menciona planes ni invita a pagar, porque
 * ninguna de las tres causas se destraba pagando.
 */
export function formatCoachAccessMessage(detail: CoachAccessRequiredDetail): string {
  switch (detail.reason) {
    case 'membership':
      return 'No tienes acceso a este atleta. Pídele a quien lo gestiona que te lo comparta.'
    case 'role':
      return 'Esta función es del espacio de entrenador y tu cuenta no lo es.'
    case 'identity':
      return 'No pudimos verificar tu cuenta. Vuelve a intentarlo en unos minutos.'
  }
}

export class CoachAccessRequiredError extends AIProviderError {
  readonly detail: CoachAccessRequiredDetail

  constructor(detail: CoachAccessRequiredDetail) {
    super('gemini', COACH_ACCESS_ERROR_CODE, formatCoachAccessMessage(detail), false)
    this.name = 'CoachAccessRequiredError'
    this.detail = detail
  }
}
