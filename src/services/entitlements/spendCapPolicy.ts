/**
 * Política pura del circuit breaker de gasto. Sin I/O, sin Dexie, sin React —
 * la importan tanto el gate server-side (netlify/functions/_shared/usageGate.ts)
 * como cualquier superficie de cliente que quiera mostrar el mismo número.
 *
 * Los montos son constantes versionadas, no env vars: Netlify captura config
 * por deploy, así que un env var no da ajuste real "en caliente" sin de todas
 * formas desplegar. Un cambio de monto queda auditable en el commit.
 */

export const ACCOUNT_DAILY_SPEND_CAP_USD = 3
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
 * El cap por cuenta se evalúa antes que el global: es más específico y más
 * accionable para quien lo dispara. Ambos usan `>=`, no `>`: el cap es un
 * techo, no un piso — llegar exactamente a él ya cuenta como alcanzado.
 */
export function evaluateSpendCaps(spend: SpendSnapshot): SpendCapCheckResult {
  if (spend.accountCostUsd >= ACCOUNT_DAILY_SPEND_CAP_USD) {
    return { exceeded: true, scope: 'account', capUsd: ACCOUNT_DAILY_SPEND_CAP_USD }
  }
  if (spend.globalCostUsd >= GLOBAL_DAILY_SPEND_CAP_USD) {
    return { exceeded: true, scope: 'global', capUsd: GLOBAL_DAILY_SPEND_CAP_USD }
  }
  return { exceeded: false }
}
