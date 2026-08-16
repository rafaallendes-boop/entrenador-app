import { isClassAllowed, type Tier } from '../services/entitlements/entitlementPolicy'
import {
  useEntitlementStore,
  type EntitlementSource,
} from '../store/useEntitlementStore'

export interface EntitlementView {
  tier: Tier
  loading: boolean
  /** 'default' = sin evidencia todavía; la UI muestra neutro, no una oferta. */
  source: EntitlementSource
  canUse: (requestClass: string) => boolean
}

/** Selector puro sobre el store global. No hidrata: eso lo hace App.tsx. */
export function useEntitlement(): EntitlementView {
  const tier = useEntitlementStore((state) => state.tier)
  const loading = useEntitlementStore((state) => state.loading)
  const source = useEntitlementStore((state) => state.source)

  return {
    tier,
    loading,
    source,
    canUse: (requestClass: string) => isClassAllowed(tier, requestClass),
  }
}
