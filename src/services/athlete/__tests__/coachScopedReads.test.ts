import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import type { Session } from '../../../types'
import { getWeekSessionsForAthlete } from '../coachScopedReads'

const now = Date.now()

function session(partial: Partial<Session>): Session {
  return {
    id: 'session',
    date: '2026-07-13',
    timeBlock: 'am',
    type: 'squash',
    status: 'planned',
    title: 'Sesión',
    durationMin: 60,
    createdAt: now,
    updatedAt: now,
    ...partial,
  } as Session
}

describe('getWeekSessionsForAthlete', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    await db.athletes.bulkPut([
      {
        id: 'ath_user-1',
        ownerAccountId: 'user-1',
        linkedAccountId: 'user-1',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'ath_m_a',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.sessions.bulkPut([
      session({ id: 's-managed', athleteId: 'ath_m_a', date: '2026-07-14' }),
      session({ id: 's-managed-pm', athleteId: 'ath_m_a', date: '2026-07-14', timeBlock: 'pm' }),
      session({ id: 's-managed-out', athleteId: 'ath_m_a', date: '2026-07-21' }),
      session({ id: 's-legacy', athleteId: undefined, date: '2026-07-15' }),
      session({ id: 's-legacy-default', athleteId: 'default', date: '2026-07-15', timeBlock: 'pm' }),
      session({ id: 's-legacy-empty', athleteId: '', date: '2026-07-17' }),
      session({ id: 's-self', athleteId: 'ath_user-1', date: '2026-07-16' }),
    ])
  })

  afterEach(() => {
    db.close()
  })

  it('gestionado: devuelve solo sus filas de la semana, jamas legacy', async () => {
    const rows = await getWeekSessionsForAthlete('user-1', 'ath_m_a', '2026-07-13')
    expect(rows.map((row) => row.id)).toEqual(['s-managed', 's-managed-pm'])
  })

  it('self: incluye sus filas y las legacy de la semana', async () => {
    const rows = await getWeekSessionsForAthlete('user-1', 'ath_user-1', '2026-07-13')
    expect(rows.map((row) => row.id)).toEqual([
      's-legacy',
      's-legacy-default',
      's-self',
      's-legacy-empty',
    ])
  })

  it('ordena por fecha y luego por bloque horario', async () => {
    await db.sessions.bulkPut([
      session({ id: 's-pm-first', athleteId: 'ath_m_a', date: '2026-07-13', timeBlock: 'pm' }),
      session({ id: 's-am-second', athleteId: 'ath_m_a', date: '2026-07-13', timeBlock: 'am' }),
    ])
    const rows = await getWeekSessionsForAthlete('user-1', 'ath_m_a', '2026-07-13')
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual(['s-am-second', 's-pm-first'])
  })

  it('valida roster y owner', async () => {
    await expect(getWeekSessionsForAthlete('user-2', 'ath_m_a', '2026-07-13')).rejects.toThrow(
      'El atleta no pertenece a tu roster.',
    )
    await expect(getWeekSessionsForAthlete('user-1', 'ath_missing', '2026-07-13')).rejects.toThrow(
      'El atleta no pertenece a tu roster.',
    )
  })

  it('no escribe al leer', async () => {
    const before = await db.sessions.count()
    await getWeekSessionsForAthlete('user-1', 'ath_m_a', '2026-07-13')
    expect(await db.sessions.count()).toBe(before)
  })
})
