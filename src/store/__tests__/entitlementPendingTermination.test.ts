import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  remoteOk: true,
  mirrored: null as 'free' | 'weekly' | 'advanced' | null,
}))

vi.mock('../../services/entitlements/entitlementService', () => ({
  readMirroredEntitlementRole: async () => 'unknown',
  readMirroredTier: async () => h.mirrored,
  hydrateEntitlement: async () => (h.remoteOk
    ? { ok: true, tier: 'advanced' as const }
    : { ok: false, tier: 'free' as const }),
}))

import { isEntitlementPending, useEntitlementStore } from '../useEntitlementStore'

describe('el estado de espera del entitlement siempre termina', () => {
  beforeEach(() => {
    h.remoteOk = true
    h.mirrored = null
    useEntitlementStore.getState().reset()
  })

  it('antes de hidratar está pendiente', () => {
    const { loading, hydrated } = useEntitlementStore.getState()
    expect(isEntitlementPending({ loading, hydrated })).toBe(true)
  })

  // La regresión concreta: `source` se quedaba en 'default' cuando la lectura
  // remota fallaba sin espejo, y la UI que esperaba "evidencia" nunca salía de
  // "Verificando el acceso a tu plan" — en el primer arranque sin red, para
  // siempre y sin reintento.
  it('una hidratación fallida sin espejo deja de estar pendiente y resuelve free', async () => {
    h.remoteOk = false

    await useEntitlementStore.getState().hydrate('user-1')

    const state = useEntitlementStore.getState()
    expect(state.source).toBe('default')
    expect(state.tier).toBe('free')
    expect(isEntitlementPending(state)).toBe(false)
  })

  it('una hidratación exitosa deja de estar pendiente', async () => {
    await useEntitlementStore.getState().hydrate('user-1')

    const state = useEntitlementStore.getState()
    expect(state.tier).toBe('advanced')
    expect(isEntitlementPending(state)).toBe(false)
  })

  it('cambiar de cuenta vuelve a poner el tier en espera', async () => {
    await useEntitlementStore.getState().hydrate('user-1')
    const pendingDuringSwitch = useEntitlementStore.getState().hydrate('user-2')
    expect(isEntitlementPending(useEntitlementStore.getState())).toBe(true)
    await pendingDuringSwitch
    expect(isEntitlementPending(useEntitlementStore.getState())).toBe(false)
  })
})
