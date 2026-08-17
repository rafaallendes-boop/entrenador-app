import {
  EntitlementRequiredError,
  isEntitlementRequiredDetail,
} from '../../entitlements/entitlementError'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  isQuotaExceededDetail,
  isSpendCapExceededDetail,
} from '../../entitlements/usageGateError'
import { createProviderError } from '../types'
import type { AIErrorCode } from '../types'

export interface ProxyErrorPayload {
  error?: string
  errorCode?: AIErrorCode
  detail?: unknown
}

/**
 * Clasifica respuestas HTTP fallidas del proxy sin perder sus precedencias
 * historicas. La unica excepcion al aplanado de 403 es el contrato tipado de
 * entitlement: su metadata se necesita para presentar la oferta correcta.
 */
export function classifyProxyHttpError(
  res: Response,
  data: ProxyErrorPayload,
): never {
  const message = data.error ?? `Error del servidor (${res.status}).`

  if (
    res.status === 403
    && data.errorCode === 'entitlement_required'
    && isEntitlementRequiredDetail(data.detail)
  ) {
    throw new EntitlementRequiredError(data.detail)
  }

  if (
    res.status === 429
    && data.errorCode === 'quota_exceeded'
    && isQuotaExceededDetail(data.detail)
  ) {
    throw new QuotaExceededError(data.detail)
  }

  if (
    res.status === 429
    && data.errorCode === 'spend_cap_exceeded'
    && isSpendCapExceededDetail(data.detail)
  ) {
    throw new SpendCapExceededError(data.detail)
  }

  if (res.status === 503 && data.errorCode === 'kill_switch_active') {
    throw new KillSwitchActiveError()
  }

  if (res.status === 401 || res.status === 403) {
    throw createProviderError(
      'gemini',
      data.errorCode === 'misconfigured' ? 'misconfigured' : 'unauthorized',
      message,
    )
  }

  if (res.status === 429 || data.errorCode === 'rate_limit') {
    throw createProviderError('gemini', 'rate_limit', message, true)
  }

  if (
    res.status === 502
    || res.status === 503
    || res.status === 504
    || data.errorCode === 'timeout'
  ) {
    throw createProviderError('gemini', 'timeout', message, true)
  }

  if (data.errorCode === 'misconfigured') {
    throw createProviderError('gemini', 'misconfigured', message)
  }

  if (data.errorCode === 'unauthorized') {
    throw createProviderError('gemini', 'unauthorized', message)
  }

  if (res.status >= 500 || data.errorCode === 'server_error') {
    throw createProviderError('gemini', 'server_error', message)
  }

  throw createProviderError('gemini', data.errorCode ?? 'unknown', message)
}
