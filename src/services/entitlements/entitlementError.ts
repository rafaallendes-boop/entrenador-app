import { AIProviderError } from '../ai/types'
import { isTier, type Tier } from './entitlementPolicy'

export const ENTITLEMENT_ERROR_CODE = 'entitlement_required' as const

export interface EntitlementRequiredDetail {
  requestClass: string
  requiredTier: Tier
  currentTier: Tier
}

export function buildEntitlementDetail(
  requestClass: string,
  requiredTier: Tier,
  currentTier: Tier,
): EntitlementRequiredDetail {
  return { requestClass, requiredTier, currentTier }
}

export function isEntitlementRequiredDetail(
  value: unknown,
): value is EntitlementRequiredDetail {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EntitlementRequiredDetail>
  return typeof candidate.requestClass === 'string'
    && candidate.requestClass.length > 0
    && isTier(candidate.requiredTier)
    && isTier(candidate.currentTier)
}

/**
 * Mensaje de respaldo. La UI construye la oferta desde `detail`, NO desde este
 * texto: existe para logs y para el caso en que algo lo muestre igual.
 */
export function formatEntitlementMessage(detail: EntitlementRequiredDetail): string {
  return `Esta función requiere el plan ${detail.requiredTier}.`
}

export class EntitlementRequiredError extends AIProviderError {
  readonly detail: EntitlementRequiredDetail

  constructor(detail: EntitlementRequiredDetail) {
    super('gemini', ENTITLEMENT_ERROR_CODE, formatEntitlementMessage(detail), false)
    this.name = 'EntitlementRequiredError'
    this.detail = detail
  }
}
