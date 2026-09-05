import type { AccountRole, Tier } from '../services/entitlements/entitlementPolicy'

export const ENTITLEMENT_SOURCE = {
  REMOTE: 'remote',
  MIRROR: 'mirror',
  DEFAULT: 'default',
} as const

export type EntitlementSource =
  (typeof ENTITLEMENT_SOURCE)[keyof typeof ENTITLEMENT_SOURCE]

/** Espejo local de lo que Supabase confirmó. Nunca se escribe un tier local. */
export interface StoredEntitlement {
  userId: string
  tier: Tier
  /** Epoch ms; `null` = sin vencimiento. Se conserva para resolver offline. */
  expiresAt: number | null
  confirmedAt: number
  /**
   * Ausente en espejos escritos antes de la separación de roles. Una ausencia
   * no es evidencia de que la cuenta sea atleta: el runtime la resuelve como
   * `unknown` y mantiene el scope cerrado hasta una lectura remota válida.
   */
  accountRole?: AccountRole
}
