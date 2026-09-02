import type { Tier } from './entitlementPolicy'

/**
 * Política pura del circuit breaker de gasto. Sin I/O, sin Dexie, sin React —
 * la importan tanto el gate server-side (netlify/functions/_shared/usageGate.ts)
 * como cualquier superficie de cliente que quiera mostrar el mismo número.
 *
 * Los montos son constantes versionadas, no env vars: Netlify captura config
 * por deploy, así que un env var no da ajuste real "en caliente" sin de todas
 * formas desplegar. Un cambio de monto queda auditable en el commit.
 *
 * QUÉ NO ES ESTO (spec §9.1): un breaker ADICIONAL, con overshoot y cobertura
 * incompleta. El costo se registra después de una respuesta exitosa y es
 * best-effort —un intento con timeout o con modelo sin precio no suma nada— y
 * varias requests concurrentes pueden leer todas un total bajo el cap. No es
 * un tope de pérdida y no reemplaza una cuota por unidad de producto.
 */

export const ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER: Record<Tier, number> = {
  free: 0.3,
  weekly: 0.8,
  advanced: 3,
}

export const GLOBAL_DAILY_SPEND_CAP_USD = 5

export type SpendCapScope = 'account' | 'global'

export type SpendCapCheckResult =
  | { exceeded: false }
  | { exceeded: true; scope: SpendCapScope; capUsd: number }

export interface SpendSnapshot {
  accountCostUsd: number
  globalCostUsd: number
}

/**
 * Fail-closed: un tier que no está en la unión —una cadena que llegó por la
 * red— cae al cap más restrictivo, nunca al más permisivo.
 */
export function resolveAccountDailySpendCapUsd(tier: Tier): number {
  return ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER[tier]
    ?? ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER.free
}

/**
 * El cap por cuenta se evalúa antes que el global: es más específico y más
 * accionable para quien lo dispara. Ambos usan `>=`, no `>`: el cap es un
 * techo, no un piso — llegar exactamente a él ya cuenta como alcanzado.
 */
export function evaluateSpendCaps(spend: SpendSnapshot, tier: Tier): SpendCapCheckResult {
  const accountCap = resolveAccountDailySpendCapUsd(tier)
  if (spend.accountCostUsd >= accountCap) {
    return { exceeded: true, scope: 'account', capUsd: accountCap }
  }
  if (spend.globalCostUsd >= GLOBAL_DAILY_SPEND_CAP_USD) {
    return { exceeded: true, scope: 'global', capUsd: GLOBAL_DAILY_SPEND_CAP_USD }
  }
  return { exceeded: false }
}
