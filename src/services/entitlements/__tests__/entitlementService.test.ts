import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }))

vi.mock('../../auth', () => ({
  supabase: { from: () => ({ select: selectMock }) },
}))

const { hydrateEntitlement, readMirroredTier } = await import('../entitlementService')

const USER = 'user-1'
const NOW = Date.parse('2026-08-15T12:00:00Z')

function remoteReturns(data: unknown, error: unknown = null) {
  selectMock.mockReturnValue({
    eq: () => ({ maybeSingle: async () => ({ data, error }) }),
  })
}

describe('hydrateEntitlement — reconciliacion', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    selectMock.mockReset()
  })

  afterEach(() => db.close())

  it('fila presente escribe el espejo', async () => {
    remoteReturns({ tier: 'advanced', expires_at: null, account_role: 'athlete' })

    const result = await hydrateEntitlement(USER)

    expect(result).toEqual({ ok: true, tier: 'advanced', accountRole: 'athlete' })
    expect(await db.entitlements.get(USER)).toMatchObject({
      userId: USER,
      tier: 'advanced',
      accountRole: 'athlete',
    })
  })

  it('ausencia CONFIRMADA borra el espejo y resuelve free', async () => {
    await db.entitlements.put({
      userId: USER,
      tier: 'advanced',
      expiresAt: null,
      confirmedAt: 1,
    })
    remoteReturns(null)

    const result = await hydrateEntitlement(USER)

    expect(result).toEqual({ ok: true, tier: 'free', accountRole: 'athlete' })
    expect(await db.entitlements.get(USER)).toBeUndefined()
  })

  it('error de red CONSERVA el espejo', async () => {
    await db.entitlements.put({
      userId: USER,
      tier: 'advanced',
      expiresAt: null,
      confirmedAt: 1,
    })
    remoteReturns(null, { message: 'network' })

    const result = await hydrateEntitlement(USER)

    expect(result).toEqual({ ok: false, tier: 'advanced', accountRole: 'unknown' })
    expect(await db.entitlements.get(USER)).toMatchObject({ tier: 'advanced' })
  })

  it('vencimiento ILEGIBLE se trata como ausencia confirmada, no como sin vencimiento', async () => {
    await db.entitlements.put({
      userId: USER,
      tier: 'advanced',
      expiresAt: null,
      confirmedAt: 1,
    })
    remoteReturns({ tier: 'advanced', expires_at: 'no-es-fecha', account_role: 'athlete' })

    const result = await hydrateEntitlement(USER)

    expect(result).toEqual({ ok: true, tier: 'free', accountRole: 'unknown' })
    expect(await db.entitlements.get(USER)).toBeUndefined()
  })

  it('vencimiento AUSENTE no se confunde con null sin vencimiento', async () => {
    await db.entitlements.put({
      userId: USER,
      tier: 'advanced',
      expiresAt: null,
      confirmedAt: 1,
    })
    remoteReturns({ tier: 'advanced', account_role: 'athlete' })

    const result = await hydrateEntitlement(USER)

    expect(result).toEqual({ ok: true, tier: 'free', accountRole: 'unknown' })
    expect(await db.entitlements.get(USER)).toBeUndefined()
  })
})

describe('readMirroredTier', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    selectMock.mockReset()
  })

  afterEach(() => db.close())

  it('sin espejo devuelve null (no free): permite distinguir "no se" de "free"', async () => {
    expect(await readMirroredTier(USER, NOW)).toBeNull()
  })

  it('espejo vigente devuelve su tier', async () => {
    await db.entitlements.put({
      userId: USER,
      tier: 'weekly',
      expiresAt: NOW + 1000,
      confirmedAt: 1,
    })

    expect(await readMirroredTier(USER, NOW)).toBe('weekly')
  })

  it('espejo vencido resuelve free sin red', async () => {
    await db.entitlements.put({
      userId: USER,
      tier: 'advanced',
      expiresAt: NOW - 1,
      confirmedAt: 1,
    })

    expect(await readMirroredTier(USER, NOW)).toBe('free')
  })

  it('el espejo de otro usuario no se lee', async () => {
    await db.entitlements.put({
      userId: 'otro',
      tier: 'advanced',
      expiresAt: null,
      confirmedAt: 1,
    })

    expect(await readMirroredTier(USER, NOW)).toBeNull()
  })
})
