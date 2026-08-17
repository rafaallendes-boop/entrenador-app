import { AIProviderError } from '../ai/types'

export type UsageGateErrorCode = 'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active'

export interface QuotaExceededDetail {
  bucketId: string
  limit: number
  remaining: number
}

export interface SpendCapExceededDetail {
  scope: 'account' | 'global'
  capUsd: number
}

export function isQuotaExceededDetail(value: unknown): value is QuotaExceededDetail {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<QuotaExceededDetail>
  return typeof candidate.bucketId === 'string' && candidate.bucketId.length > 0
    && typeof candidate.limit === 'number'
    && typeof candidate.remaining === 'number'
}

export function isSpendCapExceededDetail(value: unknown): value is SpendCapExceededDetail {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpendCapExceededDetail>
  return (candidate.scope === 'account' || candidate.scope === 'global')
    && typeof candidate.capUsd === 'number'
}

export class QuotaExceededError extends AIProviderError {
  readonly detail: QuotaExceededDetail

  constructor(detail: QuotaExceededDetail) {
    super('gemini', 'quota_exceeded', 'Alcanzaste el cupo diario de esta función.', false)
    this.name = 'QuotaExceededError'
    this.detail = detail
  }
}

export class SpendCapExceededError extends AIProviderError {
  readonly detail: SpendCapExceededDetail

  constructor(detail: SpendCapExceededDetail) {
    super('gemini', 'spend_cap_exceeded', 'El servicio alcanzó su presupuesto diario.', false)
    this.name = 'SpendCapExceededError'
    this.detail = detail
  }
}

export class KillSwitchActiveError extends AIProviderError {
  constructor() {
    super('gemini', 'kill_switch_active', 'La IA está temporalmente pausada.', false)
    this.name = 'KillSwitchActiveError'
  }
}

/**
 * El gate mismo no pudo resolverse (RPC caída, red, JSON malformado — ver
 * `usageGate.ts`). Deliberadamente distinta de las 3 anteriores: no es un
 * rechazo de política (cuota/gasto/kill switch), es una falla de
 * infraestructura. Aun así debe tratarse como terminal (no reintentable) y
 * NO como fallo del proveedor — reusa `server_error`, código ya existente.
 */
export class UsageGateUnavailableError extends AIProviderError {
  constructor(message: string) {
    super('gemini', 'server_error', message, false)
    this.name = 'UsageGateUnavailableError'
  }
}
