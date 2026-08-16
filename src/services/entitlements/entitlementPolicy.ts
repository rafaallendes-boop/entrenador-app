import type { AIRequestClass } from '../../types'

/**
 * Política de acceso por plan. Módulo puro y sin dependencias: lo importan
 * tanto el cliente como las funciones de Netlify, igual que
 * WHOOP_WORKOUT_ZONE_COLUMNS. No agregar acá lecturas de red, Dexie ni React.
 */

export type Tier = 'free' | 'weekly' | 'advanced'

export interface EntitlementRow {
  tier: Tier
  /** Epoch ms. `null` significa sin vencimiento. */
  expiresAt: number | null
}

export const TIER_ORDER: Record<Tier, number> = {
  free: 0,
  weekly: 1,
  advanced: 2,
}

/**
 * Exhaustivo por construcción: agregar una AIRequestClass sin entrada acá
 * rompe la compilación, que es exactamente lo que queremos. El default nunca
 * puede ser "free por olvido".
 */
export const REQUEST_CLASS_MIN_TIER: Record<AIRequestClass, Tier> = {
  chat_general: 'free',
  chat_action: 'free',
  import_extract: 'free',
  weekly_summary: 'weekly',
  week_creator: 'weekly',
  plan_builder_week: 'advanced',
  plan_builder_pair: 'advanced',
}

export function isTier(value: unknown): value is Tier {
  return value === 'free' || value === 'weekly' || value === 'advanced'
}

export function resolveTier(
  row: EntitlementRow | null | undefined,
  now: number,
): Tier {
  if (!row) return 'free'
  if (!isTier(row.tier)) return 'free'
  if (row.expiresAt != null && row.expiresAt <= now) return 'free'
  return row.tier
}

/**
 * `null` para una clase que no está en el mapa. El llamador tiene que tratar
 * ese caso como denegación, no como ausencia de requisito.
 */
export function minTierForClass(requestClass: string): Tier | null {
  const required = (REQUEST_CLASS_MIN_TIER as Record<string, Tier | undefined>)[requestClass]
  return required ?? null
}

export function isClassAllowed(tier: Tier, requestClass: string): boolean {
  const required = minTierForClass(requestClass)
  // Clase desconocida: se deniega para todos, incluido advanced. Una cadena
  // que llegó por la red y no está en la unión no tiene requisito conocido,
  // y "sin requisito" no puede significar "permitido".
  if (required == null) return false
  return TIER_ORDER[tier] >= TIER_ORDER[required]
}
