import type { CapabilityDecision } from './resolveCapability'

export type CoachAuthzMode = 'audit' | 'enforce'

/** Sólo el literal exacto habilita el corte; todo lo demás conserva auditoría. */
export function resolveCoachAuthzMode(
  env: { COACH_AUTHZ_MODE?: string | undefined } = {},
): CoachAuthzMode {
  return env['COACH_AUTHZ_MODE'] === 'enforce' ? 'enforce' : 'audit'
}

/**
 * Por qué no se pudo construir la decisión sombra. En `audit` esto NO puede
 * cortar el request: la sombra no decide nada, así que un fallo de lectura
 * tiene que quedar como evidencia y dejar pasar la ruta legacy intacta.
 */
export type ShadowUnavailableReason = 'entitlement_unreadable' | 'membership_unreadable'

/** Campos de auditoría deliberadamente libres de identificadores personales. */
export interface CoachAuthzAudit {
  capability: string
  legacyAllowed: boolean
  /** `null` cuando la sombra no se pudo construir. */
  shadowAllowed: boolean | null
  wouldDeny: boolean
  wouldGrant: boolean
  /** `null` cuando la sombra no se pudo construir. */
  entitlementSource: CapabilityDecision['entitlementSource'] | null
  hadSubjectCap: boolean
  /** `null` cuando la sombra sí se construyó. */
  shadowUnavailable: ShadowUnavailableReason | null
  /**
   * Divergencias de forma de cuota entre legacy y sombra con el MISMO
   * `allowed`. Sin esto la ventana de auditoría no registra lo que `enforce`
   * cambiaría en bucket, límite, dueño del entitlement o tope por atleta, que
   * es justamente la evidencia que habilita el corte de la Entrega 1b.
   */
  quotaDivergence: readonly string[]
}

const NO_SHADOW = {
  shadowAllowed: null,
  entitlementSource: null,
  hadSubjectCap: false,
  quotaDivergence: [] as readonly string[],
} as const

/**
 * Evidencia para el caso en que la sombra no se pudo construir. La decisión
 * efectiva es la legacy, exactamente como antes de introducir roles.
 */
export function auditUnavailableShadow(
  legacy: CapabilityDecision,
  reason: ShadowUnavailableReason,
): { decision: CapabilityDecision; audit: CoachAuthzAudit } {
  return {
    decision: legacy,
    audit: {
      ...NO_SHADOW,
      capability: legacy.capability,
      legacyAllowed: legacy.allowed,
      wouldDeny: false,
      wouldGrant: false,
      shadowUnavailable: reason,
    },
  }
}

/** Campos cuya diferencia cambia la cuota aunque ambas decisiones permitan. */
function quotaDivergence(legacy: CapabilityDecision, shadow: CapabilityDecision): string[] {
  const diff: string[] = []
  if (legacy.quotaBucketId !== shadow.quotaBucketId) diff.push('quotaBucketId')
  if (legacy.limit !== shadow.limit) diff.push('limit')
  if (legacy.entitlementSource !== shadow.entitlementSource) diff.push('entitlementSource')
  if (legacy.quotaOwnerUserId !== shadow.quotaOwnerUserId) diff.push('quotaOwnerUserId')
  if ((legacy.quotaSubject?.limit ?? null) !== (shadow.quotaSubject?.limit ?? null)) {
    diff.push('quotaSubject')
  }
  return diff
}

/**
 * Durante la auditoría la decisión efectiva es la legacy, exactamente como
 * antes de introducir roles. La decisión role-aware sólo genera evidencia.
 * `enforce` queda para el corte posterior y hace efectiva la sombra.
 */
export function reconcileDecision(
  legacy: CapabilityDecision,
  shadow: CapabilityDecision,
  mode: CoachAuthzMode,
): { decision: CapabilityDecision; audit: CoachAuthzAudit | null } {
  if (mode === 'enforce') return { decision: shadow, audit: null }

  const divergence = legacy.allowed === shadow.allowed
    ? quotaDivergence(legacy, shadow)
    : []
  if (legacy.allowed === shadow.allowed && divergence.length === 0) {
    return { decision: legacy, audit: null }
  }

  return {
    decision: legacy,
    audit: {
      capability: legacy.capability,
      legacyAllowed: legacy.allowed,
      shadowAllowed: shadow.allowed,
      wouldDeny: legacy.allowed && !shadow.allowed,
      wouldGrant: !legacy.allowed && shadow.allowed,
      entitlementSource: shadow.entitlementSource,
      hadSubjectCap: shadow.quotaSubject != null,
      shadowUnavailable: null,
      quotaDivergence: divergence,
    },
  }
}
