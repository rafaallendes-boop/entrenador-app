import type { AIRequestClass } from '../../types'
import {
  isClassAllowed,
  minTierForClass,
  resolveTier,
  type EntitlementRow,
  type Tier,
} from './entitlementPolicy'
import { bucketForClass, bucketLimitForTier } from './quotaBuckets'

/**
 * Punto único de resolución de acceso a una capacidad de IA. Módulo puro: lo
 * importan tanto las Netlify Functions como el cliente, igual que
 * `entitlementPolicy.ts`. No agregar acá dependencias de E/S ni de interfaz.
 *
 * `targetAthleteId` se acepta y se IGNORA en esta versión. Existe para que el
 * Proyecto 2 —producto Coach, relación coach-atleta y delegación de cuota—
 * sea un cambio en el cuerpo de esta función y no una cacería de tiers por
 * toda la aplicación. Ver §10.1 del spec para la regla destino.
 */
export interface ResolveCapabilityInput {
  /** SIEMPRE derivado del JWT en servidor. Nunca aceptado desde el cliente. */
  actorUserId: string
  targetAthleteId: string | null
  capability: AIRequestClass
  now: number
  entitlement: EntitlementRow | null
}

export interface CapabilityDecision {
  allowed: boolean
  tier: Tier
  /** Capacidad canónica que originó la decisión y su cuota. */
  capability: AIRequestClass
  /** `null` = clase desconocida. El llamador la trata como denegación. */
  requiredTier: Tier | null
  /** Quién aporta la capacidad. Proyecto 2 agrega 'coach' | 'delegated'. */
  entitlementSource: 'self'
  entitlementOwnerUserId: string
  /** Contra quién se contabiliza la cuota. */
  quotaOwnerUserId: string
  /** Bucket a incrementar. `null` si la clase no está permitida. */
  quotaBucketId: string | null
  /**
   * Unidades de cuota que consume esta llamada. Hoy siempre 1, porque la cuota
   * cuenta intentos del proveedor y cada llamada es un intento. Existe desde
   * ahora para que la ponderación por producto (`week = 1`, `pair = 2`, §8 del
   * spec) se resuelva acá y no en el llamador.
   */
  consumptionUnits: number
  /** `null` = clase no permitida. NUNCA 0. */
  limit: number | null
}

export function resolveCapability(input: ResolveCapabilityInput): CapabilityDecision {
  const tier = resolveTier(input.entitlement, input.now)
  const requiredTier = minTierForClass(input.capability)
  const allowed = isClassAllowed(tier, input.capability)

  const bucket = allowed ? bucketForClass(input.capability) : null
  const limit = bucket ? bucketLimitForTier(bucket, tier) : null

  return {
    allowed,
    tier,
    capability: input.capability,
    requiredTier,
    entitlementSource: 'self',
    entitlementOwnerUserId: input.actorUserId,
    quotaOwnerUserId: input.actorUserId,
    quotaBucketId: bucket?.id ?? null,
    consumptionUnits: 1,
    limit,
  }
}
