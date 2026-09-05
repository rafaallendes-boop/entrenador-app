import { create } from 'zustand'
import {
  hydrateEntitlement,
  readMirroredEntitlementRole,
  readMirroredTier,
} from '../services/entitlements/entitlementService'
import { type ResolvedAccountRole, type Tier } from '../services/entitlements/entitlementPolicy'
import { setAccountRole } from '../services/entitlements/accountRoleHolder'
import {
  ENTITLEMENT_SOURCE,
  type EntitlementSource,
} from '../types/entitlement'

export type { EntitlementSource } from '../types/entitlement'

interface EntitlementState {
  tier: Tier
  /** Identidad de producto: unknown hasta que una lectura remota la confirme. */
  accountRole: ResolvedAccountRole
  loading: boolean
  source: EntitlementSource
  /**
   * `true` en cuanto una hidratación TERMINA, con o sin éxito. `source` no
   * sirve para eso: un fallo de lectura sin espejo deja `default` para siempre,
   * y una UI que espere "evidencia" quedaría colgada sin salida en el primer
   * arranque sin red. Terminada la hidratación, la ausencia de evidencia ya es
   * una respuesta: `free`, igual que resuelve el servidor.
   */
  hydrated: boolean
  userId: string | null
  hydrate: (userId: string) => Promise<void>
  reset: () => void
}

/** Deduplica hidrataciones concurrentes de la misma cuenta. */
let inFlight: { userId: string; promise: Promise<void> } | null = null

/** Descarta respuestas tardías de una cuenta que ya no es la activa. */
let epoch = 0

export const useEntitlementStore = create<EntitlementState>((set, get) => ({
  tier: 'free',
  accountRole: 'unknown',
  loading: false,
  source: ENTITLEMENT_SOURCE.DEFAULT,
  hydrated: false,
  userId: null,

  hydrate: async (userId: string) => {
    if (inFlight?.userId === userId) return inFlight.promise

    // Cambiar de cuenta descarta el tier anterior de inmediato: heredarlo aunque
    // sea por un frame le mostraría a la cuenta nueva un plan que no tiene.
    if (get().userId !== userId) {
      setAccountRole('unknown')
      set({
        userId,
        tier: 'free',
        accountRole: 'unknown',
        source: ENTITLEMENT_SOURCE.DEFAULT,
        hydrated: false,
        loading: true,
      })
    } else {
      set({ loading: true })
    }

    const myEpoch = ++epoch
    const promise = (async () => {
      const [mirrored, mirroredRole] = await Promise.all([
        readMirroredTier(userId),
        readMirroredEntitlementRole(userId),
      ])
      if (myEpoch !== epoch) return
      if (mirrored) {
        setAccountRole(mirroredRole)
        set({
          tier: mirrored,
          accountRole: mirroredRole,
          source: ENTITLEMENT_SOURCE.MIRROR,
        })
      }

      const remote = await hydrateEntitlement(userId)
      if (myEpoch !== epoch) return
      // Todo desenlace remoto explícitamente transporta rol. El fallback sólo
      // existe para mocks/bundles intermedios y sigue siendo fail-closed.
      const accountRole = remote.accountRole ?? 'unknown'
      setAccountRole(accountRole)
      set({
        tier: remote.tier,
        accountRole,
        source: remote.ok
          ? ENTITLEMENT_SOURCE.REMOTE
          : (mirrored ? ENTITLEMENT_SOURCE.MIRROR : ENTITLEMENT_SOURCE.DEFAULT),
        hydrated: true,
        loading: false,
      })
    })().finally(() => {
      if (inFlight?.userId === userId) inFlight = null
    })

    inFlight = { userId, promise }
    return promise
  },

  reset: () => {
    epoch += 1
    inFlight = null
    setAccountRole('unknown')
    set({
      tier: 'free',
      accountRole: 'unknown',
      loading: false,
      source: ENTITLEMENT_SOURCE.DEFAULT,
      hydrated: false,
      userId: null,
    })
  },
}))

/**
 * Verdadero mientras el tier todavía no es una respuesta: nadie hidrató aún o
 * hay una hidratación en vuelo. Siempre termina.
 */
export function isEntitlementPending(state: Pick<EntitlementState, 'loading' | 'hydrated'>): boolean {
  return state.loading || !state.hydrated
}

/** Lectura sincrónica para consumidores fuera de React (cuotas, chat store). */
export function getEntitlementTier(): Tier {
  return useEntitlementStore.getState().tier
}
