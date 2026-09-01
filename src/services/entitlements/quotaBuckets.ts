import type { AIRequestClass } from '../../types'
import { isClassAllowed, type Tier } from './entitlementPolicy'

export interface QuotaBucket {
  id: string
  classes: readonly AIRequestClass[]
  limits: Partial<Record<Tier, number>>
}

/**
 * Un bucket agrupa clases que comparten contador. Sólo el chat lo necesita; los
 * demás son buckets de una clase, o sea contadores por clase como hoy.
 *
 * El bucket de chat pagado queda en 120 = 80 + 40 para preservar la capacidad
 * total previa y no introducir una regresión al unificar los dos contadores.
 */
export const QUOTA_BUCKETS: readonly QuotaBucket[] = [
  { id: 'chat', classes: ['chat_general', 'chat_action'], limits: { free: 15, weekly: 120, advanced: 120 } },
  { id: 'import', classes: ['import_extract'], limits: { free: 3, weekly: 10, advanced: 10 } },
  { id: 'weekly_summary', classes: ['weekly_summary'], limits: { weekly: 10, advanced: 10 } },
  { id: 'week_creator', classes: ['week_creator'], limits: { advanced: 8 } },
  { id: 'plan_builder_week', classes: ['plan_builder_week'], limits: { advanced: 12 } },
  { id: 'plan_builder_pair', classes: ['plan_builder_pair'], limits: { advanced: 6 } },
  { id: 'coach_assistant', classes: ['coach_assistant_message'], limits: { advanced: 20 } },
]

export function bucketForClass(requestClass: AIRequestClass): QuotaBucket | null {
  return QUOTA_BUCKETS.find((bucket) => bucket.classes.includes(requestClass)) ?? null
}

/**
 * `null` significa "no aplica cuota porque el plan no permite esta clase".
 * NO devolver 0: el mensaje correcto para ese caso es la oferta de plan.
 */
export function bucketLimitForTier(bucket: QuotaBucket, tier: Tier): number | null {
  if (!isClassAllowed(tier, bucket.classes[0])) return null
  return bucket.limits[tier] ?? null
}
