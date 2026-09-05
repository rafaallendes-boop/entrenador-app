import type { AIRequestClass, MembershipRole } from '../../types'
import {
  CLASS_REQUIRES_COACH_ROLE,
  isClassAllowed,
  minTierForClass,
  resolveTier,
  type EntitlementRow,
  type ResolvedAccountRole,
  type Tier,
} from './entitlementPolicy'
import {
  bucketForClass,
  bucketLimitForTier,
  bucketLimitIgnoringTierGate,
  perSubjectLimitForTier,
} from './quotaBuckets'

/**
 * Punto único de resolución de acceso a una capacidad de IA. Módulo puro: lo
 * importan tanto las Netlify Functions como el cliente, igual que
 * `entitlementPolicy.ts`. No agregar acá dependencias de E/S ni de interfaz.
 *
 * El rol y la membresía llegan YA VERIFICADOS por el llamador: esta función no
 * consulta Supabase, Dexie ni red para confirmarlos.
 */
export interface VerifiedMembership {
  athleteId: string
  role: MembershipRole
}

export interface ResolveCapabilityInput {
  /** SIEMPRE derivado del JWT en servidor. Nunca aceptado desde el cliente. */
  actorUserId: string
  targetAthleteId: string | null
  capability: AIRequestClass
  now: number
  entitlement: EntitlementRow | null
  accountRole: ResolvedAccountRole
  /** Membresía sobre `targetAthleteId`, YA VERIFICADA por el llamador. */
  membership: VerifiedMembership | null
  /** 'off' = comportamiento legacy exacto. 'on' = reglas de rol y delegación. */
  roleGate: 'off' | 'on'
}

/** Tope adicional del par (coach, atleta) para esta llamada delegada. */
export interface QuotaSubject {
  athleteId: string
  limit: number
}

/**
 * Por qué se denegó. Existe para que el borde HTTP no represente un problema
 * de ROL o de MEMBRESÍA como una oferta de plan: a un coach Avanzado sin
 * vínculo con el atleta, «sube a Avanzado» es literalmente falso.
 * `null` cuando `allowed` es true.
 */
export type DenialReason = 'tier' | 'role' | 'membership' | 'identity' | 'unknown_class'

export interface CapabilityDecision {
  allowed: boolean
  denialReason: DenialReason | null
  tier: Tier
  /** Capacidad canónica que originó la decisión y su cuota. */
  capability: AIRequestClass
  /** `null` = clase desconocida. El llamador la trata como denegación. */
  requiredTier: Tier | null
  /** Quién aporta la capacidad: el propio actor o el coach que delega. */
  entitlementSource: 'self' | 'coach'
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
  /**
   * Tope por atleta cuando la llamada es delegada, estrictamente menor que
   * `limit`. `null` cuando no hay delegación o el bucket no declara tope
   * propio para el tier — nunca 0.
   */
  quotaSubject: QuotaSubject | null
}

export function resolveCapability(input: ResolveCapabilityInput): CapabilityDecision {
  const tier = resolveTier(input.entitlement, input.now)
  const requiredTier = minTierForClass(input.capability)

  const base = {
    tier,
    capability: input.capability,
    requiredTier,
    entitlementOwnerUserId: input.actorUserId,
    quotaOwnerUserId: input.actorUserId,
    consumptionUnits: 1,
  }
  const denied = (
    reason: DenialReason,
    source: 'self' | 'coach' = 'self',
  ): CapabilityDecision => ({
    ...base, allowed: false, denialReason: reason, entitlementSource: source,
    quotaBucketId: null, limit: null, quotaSubject: null,
  })

  // ── Ruta legacy: idéntica al comportamiento anterior a esta entrega ───────
  if (input.roleGate === 'off') {
    const allowed = isClassAllowed(tier, input.capability)
    const bucket = allowed ? bucketForClass(input.capability) : null
    const limit = bucket ? bucketLimitForTier(bucket, tier) : null
    return {
      ...base, allowed, entitlementSource: 'self',
      denialReason: allowed ? null : (requiredTier == null ? 'unknown_class' : 'tier'),
      quotaBucketId: bucket?.id ?? null, limit, quotaSubject: null,
    }
  }

  // ── Ruta role-aware ──────────────────────────────────────────────────────
  // Un rol ilegible no habilita nada, ni las clases `free`: degradar identidad
  // CONCEDE, no sólo quita (§5.1).
  if (input.accountRole === 'unknown') return denied('identity')

  const roleGated = CLASS_REQUIRES_COACH_ROLE.has(input.capability)
  if (roleGated && input.accountRole !== 'coach') return denied('role')

  // La ausencia de vínculo NUNCA se reinterpreta como "actúa sobre sí mismo".
  const delegating = input.targetAthleteId != null
  if (delegating) {
    if (input.accountRole !== 'coach') return denied('role')
    if (input.membership == null) return denied('membership', 'coach')
    if (input.membership.athleteId !== input.targetAthleteId) return denied('membership', 'coach')
    if (input.membership.role !== 'coach') return denied('membership', 'coach')
  }

  const source: 'self' | 'coach' = delegating ? 'coach' : 'self'
  if (!roleGated && !isClassAllowed(tier, input.capability)) {
    return denied(requiredTier == null ? 'unknown_class' : 'tier', source)
  }

  const bucket = bucketForClass(input.capability)
  if (bucket == null) return denied('unknown_class', source)

  // Para una clase gateada por rol el tier no decide, así que su cuota tampoco
  // puede resolverse a través del gate de tier.
  const limit = roleGated
    ? bucketLimitIgnoringTierGate(bucket, tier)
    : bucketLimitForTier(bucket, tier)
  if (limit == null) return denied('tier', source)

  const perSubject = delegating ? perSubjectLimitForTier(bucket, tier) : null

  return {
    ...base, allowed: true, denialReason: null, entitlementSource: source,
    quotaBucketId: bucket.id, limit,
    quotaSubject: perSubject == null ? null : { athleteId: input.targetAthleteId as string, limit: perSubject },
  }
}
