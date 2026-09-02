import type { AIRequestClass } from '../types'
import { isClassAllowed, type Tier } from '../services/entitlements/entitlementPolicy'
import {
  resolveCapability,
  type CapabilityDecision,
} from '../services/entitlements/resolveCapability'
import {
  isEntitlementPending,
  useEntitlementStore,
  type EntitlementSource,
} from '../store/useEntitlementStore'

export interface EntitlementView {
  tier: Tier
  loading: boolean
  /** 'default' = sin evidencia todavía; la UI muestra neutro, no una oferta. */
  source: EntitlementSource
  /**
   * `true` mientras el tier todavía no es una respuesta. Termina siempre: una
   * hidratación fallida resuelve a `free`, que es lo mismo que decide el
   * servidor. No usar `source === 'default'` para esto — ese estado sobrevive a
   * un fallo de lectura y dejaría la UI colgada sin red.
   */
  pending: boolean
  canUse: (requestClass: string) => boolean
  /** Consulta preventiva para la UI; el servidor siempre autoriza con su JWT. */
  decide: (capability: AIRequestClass) => CapabilityDecision
}

/** Selector puro sobre el store global. No hidrata: eso lo hace App.tsx. */
export function useEntitlement(): EntitlementView {
  const tier = useEntitlementStore((state) => state.tier)
  const loading = useEntitlementStore((state) => state.loading)
  const source = useEntitlementStore((state) => state.source)
  const hydrated = useEntitlementStore((state) => state.hydrated)

  return {
    tier,
    loading,
    source,
    pending: isEntitlementPending({ loading, hydrated }),
    canUse: (requestClass: string) => isClassAllowed(tier, requestClass),
    decide: (capability: AIRequestClass): CapabilityDecision => resolveCapability({
      // Literal a propósito. `useEntitlementStore` no expone identidad y esta
      // llamada es CONSULTIVA: sólo decide si la UI muestra la oferta antes de
      // gastar una request. El servidor resuelve de nuevo con su propio JWT;
      // pasar un id de sesión sugeriría, falsamente, que el cliente autoriza.
      actorUserId: 'local',
      targetAthleteId: null,
      capability,
      now: Date.now(),
      entitlement: { tier, expiresAt: null },
    }),
  }
}
