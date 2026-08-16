import { beforeEach, describe, expect, it, vi } from 'vitest'

const hydrateEntitlement = vi.fn()
const readMirroredTier = vi.fn()

vi.mock('../../services/entitlements/entitlementService', () => ({
  hydrateEntitlement: (...args: unknown[]) => hydrateEntitlement(...args),
  readMirroredTier: (...args: unknown[]) => readMirroredTier(...args),
}))

const { useEntitlementStore, getEntitlementTier } = await import('../useEntitlementStore')

beforeEach(() => {
  hydrateEntitlement.mockReset()
  readMirroredTier.mockReset()
  useEntitlementStore.getState().reset()
})

describe('hidratacion unica', () => {
  it('dos llamadas concurrentes para el mismo usuario hacen UN solo fetch', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'advanced' })

    await Promise.all([
      useEntitlementStore.getState().hydrate('user-1'),
      useEntitlementStore.getState().hydrate('user-1'),
    ])

    expect(hydrateEntitlement).toHaveBeenCalledTimes(1)
    expect(useEntitlementStore.getState().tier).toBe('advanced')
  })

  it('cambiar de cuenta descarta el tier anterior antes de hidratar', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'advanced' })
    await useEntitlementStore.getState().hydrate('user-1')
    expect(useEntitlementStore.getState().tier).toBe('advanced')

    // La cuenta nueva no puede heredar el tier de la anterior ni por un frame.
    hydrateEntitlement.mockImplementation(() => new Promise(() => {}))
    void useEntitlementStore.getState().hydrate('user-2')

    expect(useEntitlementStore.getState().tier).toBe('free')
    expect(useEntitlementStore.getState().source).toBe('default')
    expect(useEntitlementStore.getState().loading).toBe(true)
  })

  it('una respuesta tardia de la cuenta anterior no pisa a la nueva', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOld = resolve
    }))
    void useEntitlementStore.getState().hydrate('user-1')
    await vi.waitFor(() => expect(hydrateEntitlement).toHaveBeenCalledTimes(1))

    hydrateEntitlement.mockResolvedValueOnce({ ok: true, tier: 'free' })
    await useEntitlementStore.getState().hydrate('user-2')

    resolveOld({ ok: true, tier: 'advanced' })
    await Promise.resolve()

    expect(useEntitlementStore.getState().userId).toBe('user-2')
    expect(useEntitlementStore.getState().tier).toBe('free')
  })
})

describe('estado neutro', () => {
  it('sin espejo arranca loading y source default', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockImplementation(() => new Promise(() => {}))

    void useEntitlementStore.getState().hydrate('user-1')
    await Promise.resolve()

    expect(useEntitlementStore.getState().loading).toBe(true)
    expect(useEntitlementStore.getState().source).toBe('default')
  })

  it('con espejo lo usa antes de que responda la red', async () => {
    readMirroredTier.mockResolvedValue('advanced')
    hydrateEntitlement.mockImplementation(() => new Promise(() => {}))

    void useEntitlementStore.getState().hydrate('user-1')
    await vi.waitFor(() => expect(useEntitlementStore.getState().source).toBe('mirror'))
    expect(useEntitlementStore.getState().tier).toBe('advanced')
  })
})

describe('getEntitlementTier', () => {
  it('permite leer el tier fuera de React', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'weekly' })
    await useEntitlementStore.getState().hydrate('user-1')
    expect(getEntitlementTier()).toBe('weekly')
  })

  it('sin hidratar devuelve free', () => {
    expect(getEntitlementTier()).toBe('free')
  })
})

describe('reset', () => {
  it('vuelve a free al cerrar sesion', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'advanced' })
    await useEntitlementStore.getState().hydrate('user-1')

    useEntitlementStore.getState().reset()

    expect(useEntitlementStore.getState().tier).toBe('free')
    expect(useEntitlementStore.getState().userId).toBeNull()
  })
})
