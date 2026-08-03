import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'
import {
  acceptConsent,
  getMissingConsents,
  hasAnyPreviousAcceptance,
  hydrateConsents,
  verifyCurrentConsentRemotely,
} from '../consentService'
import { getCurrentVersion } from '../consentDocuments'

const USER = 'user-1'
const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('../../auth', () => ({
  supabase: { from: (...args: unknown[]) => from(...args) },
}))

function remoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'remote-1',
    user_id: USER,
    document: 'terms',
    version: getCurrentVersion('terms'),
    accepted_at: '2026-08-03T10:00:00.000Z',
    ...overrides,
  }
}

function setRemote(options: { rows?: unknown[]; insertRow?: unknown; insertError?: { code: string }; readError?: boolean }) {
  const rows = options.rows ?? []
  from.mockReturnValue({
    select: () => ({
      eq: async () => options.readError
        ? { data: null, error: { code: '500' } }
        : { data: rows, error: null },
    }),
    insert: () => ({
      select: () => ({
        single: async () => options.insertError
          ? { data: null, error: options.insertError }
          : { data: options.insertRow ?? rows[0] ?? null, error: null },
      }),
    }),
  })
}

async function seedLocal(userId: string, document: 'terms' | 'privacy' | 'health', version: string) {
  await db.consentAcceptances.put({
    id: `${userId}-${document}-${version}`,
    userId,
    document,
    version,
    acceptedAt: '2026-08-03T10:00:00.000Z',
  })
}

describe('consentService', () => {
  beforeEach(async () => {
    from.mockReset()
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('deriva los documentos faltantes por pertenencia a la versión vigente', async () => {
    expect(await getMissingConsents(USER)).toEqual(['terms', 'privacy', 'health'])
    await seedLocal(USER, 'terms', getCurrentVersion('terms'))
    expect(await getMissingConsents(USER)).toEqual(['privacy', 'health'])
  })

  it('no usa aceptaciones de otra cuenta ni versiones anteriores', async () => {
    await seedLocal('otra-cuenta', 'terms', getCurrentVersion('terms'))
    await seedLocal(USER, 'privacy', '2026-01-01')
    expect(await getMissingConsents(USER)).toEqual(['terms', 'privacy', 'health'])
    expect(await hasAnyPreviousAcceptance(USER, ['privacy'])).toBe(true)
  })

  it('hidrata únicamente filas válidas de la cuenta solicitada', async () => {
    setRemote({ rows: [
      remoteRow(),
      remoteRow({ id: 'other', user_id: 'otra-cuenta' }),
      remoteRow({ id: 'invalid', document: 'inventado' }),
    ] })
    expect(await hydrateConsents(USER)).toEqual({ ok: true })
    expect(await db.consentAcceptances.toArray()).toEqual([expect.objectContaining({ id: 'remote-1', userId: USER })])
  })

  it('si la lectura remota falla no escribe el espejo', async () => {
    setRemote({ readError: true })
    expect(await hydrateConsents(USER)).toEqual({ ok: false })
    expect(await db.consentAcceptances.count()).toBe(0)
  })

  it('verifica autoritativamente la versión vigente y espeja la fila remota', async () => {
    setRemote({ rows: [remoteRow()] })
    expect(await verifyCurrentConsentRemotely(USER, 'terms')).toEqual({ ok: true, current: true })
    expect(await db.consentAcceptances.get('remote-1')).toMatchObject({ userId: USER })

    await db.consentAcceptances.clear()
    setRemote({ rows: [remoteRow({ version: '2026-01-01' })] })
    expect(await verifyCurrentConsentRemotely(USER, 'terms')).toEqual({ ok: true, current: false })
  })

  it('la verificación autoritativa falla cerrado si Supabase no responde', async () => {
    setRemote({ readError: true })
    expect(await verifyCurrentConsentRemotely(USER, 'terms')).toEqual({ ok: false, current: false })
  })

  it('un insert exitoso espeja exactamente la fila retornada por el servidor', async () => {
    setRemote({ insertRow: remoteRow({ id: 'server-row', accepted_at: '2030-01-01T00:00:00.000Z' }) })
    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: true })
    expect(await db.consentAcceptances.get('server-row')).toMatchObject({
      acceptedAt: '2030-01-01T00:00:00.000Z',
    })
  })

  it('trata 23505 como éxito solo si el select confirma la fila exacta', async () => {
    setRemote({ rows: [remoteRow()], insertError: { code: '23505' } })
    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: true })
    expect(await getMissingConsents(USER)).not.toContain('terms')

    await db.consentAcceptances.clear()
    setRemote({ rows: [remoteRow({ version: '2020-01-01' })], insertError: { code: '23505' } })
    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: false })
    expect(await db.consentAcceptances.count()).toBe(0)
  })

  it('un error de insert no se refleja localmente', async () => {
    setRemote({ insertError: { code: '500' } })
    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: false })
    expect(await db.consentAcceptances.count()).toBe(0)
  })
})
