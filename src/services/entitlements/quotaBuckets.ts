import type { AIRequestClass } from '../../types'
import { isClassAllowed, type Tier } from './entitlementPolicy'

export interface QuotaBucket {
  id: string
  classes: readonly AIRequestClass[]
  limits: Partial<Record<Tier, number>>
  /**
   * Tope adicional del par (coach, atleta) cuando la capacidad se ejerce por
   * delegación. Omitir la clave = sin tope; NUNCA 0. Estrictamente menor que
   * `limits` del mismo tier. Provisional hasta la Fase 0, igual que `limits`.
   */
  perSubjectLimits?: Partial<Record<Tier, number>>
}

/**
 * Un bucket agrupa clases que comparten contador. Sólo el chat lo necesita; los
 * demás son buckets de una clase.
 *
 * ATENCIÓN: estos límites cuentan INTENTOS DEL PROVEEDOR, no acciones de
 * producto. `assertUsageGate` se llama inmediatamente antes de cada llamada
 * real, así que un retry o un fallback consumen otra unidad, y un `pair`
 * produce dos semanas con una sola unidad. Nunca traducir estos números a
 * "mensajes" o "semanas" en copy visible. Ver §7 del spec.
 *
 * Provisionales hasta que cierre la Fase 0 (línea base de costo real).
 */
export const QUOTA_BUCKETS: readonly QuotaBucket[] = [
  { id: 'chat', classes: ['chat_general', 'chat_action'], limits: { free: 15, weekly: 40, advanced: 120 }, perSubjectLimits: { weekly: 15, advanced: 40 } },
  { id: 'import', classes: ['import_extract'], limits: { free: 3, weekly: 10, advanced: 10 } },
  { id: 'weekly_summary', classes: ['weekly_summary'], limits: { weekly: 5, advanced: 10 } },
  { id: 'week_creator', classes: ['week_creator'], limits: { weekly: 3, advanced: 8 }, perSubjectLimits: { advanced: 3 } },
  // 16 y 8 llevan holgura de retry: con límite igual al largo del plan, la
  // semana 13 —que puede ser el segundo intento de la semana 4— rompería un
  // plan de 12 semanas.
  { id: 'plan_builder_week', classes: ['plan_builder_week'], limits: { advanced: 16 } },
  { id: 'plan_builder_pair', classes: ['plan_builder_pair'], limits: { advanced: 8 } },
  // Gateado por ROL, no por tier: los tres valores existen para que un coach
  // con cualquier tier tenga cuota resoluble.
  { id: 'coach_assistant', classes: ['coach_assistant_message'], limits: { free: 20, weekly: 20, advanced: 20 } },
]

export function bucketForClass(requestClass: AIRequestClass): QuotaBucket | null {
  return QUOTA_BUCKETS.find((bucket) => bucket.classes.includes(requestClass)) ?? null
}

/**
 * `null` significa "no aplica cuota porque el plan no permite NINGUNA clase de
 * este bucket". NO devolver 0: el mensaje correcto para ese caso es la oferta
 * de plan.
 *
 * El predicado pregunta por `some`, no por `classes[0]`: desde que
 * `chat_general` y `chat_action` tienen tiers distintos, apoyarse en la
 * posición haría que reordenar el literal cambiara el comportamiento en
 * silencio. Un tier que puede usar al menos una clase del bucket tiene cuota
 * en ese bucket; el entitlement rechaza por separado las clases que no puede.
 */
export function bucketLimitForTier(bucket: QuotaBucket, tier: Tier): number | null {
  if (!bucket.classes.some((cls) => isClassAllowed(tier, cls))) return null
  return bucket.limits[tier] ?? null
}

/**
 * Igual que `bucketLimitForTier` pero para el tope adicional por sujeto
 * (par coach/atleta). Mismo gate de tier que el global: si ningún tier puede
 * usar ninguna clase del bucket, `null` — nunca 0. Ausencia de la clave en
 * `perSubjectLimits` también es `null`: sin tope propio, no cero.
 */
export function perSubjectLimitForTier(bucket: QuotaBucket, tier: Tier): number | null {
  // Un sujeto no puede tener un límite independiente si el contador global de
  // ese mismo bucket/tier no existe. `bucketLimitForTier` conserva además la
  // guarda de clase permitida; usar sólo `isClassAllowed` acá aceptaría una
  // configuración inválida (clase permitida, pero sin límite global).
  if (bucketLimitForTier(bucket, tier) == null) return null
  return bucket.perSubjectLimits?.[tier] ?? null
}

/**
 * Límite del bucket SIN consultar el gate de tier. Es para las clases cuyo
 * requisito real es el ROL (§5.3): su entrada en REQUEST_CLASS_MIN_TIER sigue
 * en `advanced` para no alterar la ruta legacy, así que `bucketLimitForTier`
 * devolvería `null` para un coach Free y lo denegaría por falta de cuota.
 * NO usar para clases gateadas por tier.
 */
export function bucketLimitIgnoringTierGate(bucket: QuotaBucket, tier: Tier): number | null {
  return bucket.limits[tier] ?? null
}
