import { markMembershipsHydrated } from '../membershipCache'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import type { Session } from '../../../types'
import { ATHLETE_PROFILE_LOCAL_ID, setSelfAthleteId } from '../activeAthlete'
import {
  assertActiveRosterAthlete,
  assertRosterAthlete,
  getRosterTriageData,
  getAthleteProfileForAthlete,
  getWeekSessionsForAthlete,
} from '../coachScopedReads'

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
      {
        id: 'ath_archived',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        status: 'archived',
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
    setSelfAthleteId(null)
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

  it('self reclamado por membresía adopta legacy', async () => {
    setSelfAthleteId('ath_claimed')
    await db.athletes.put({
      id: 'ath_claimed', ownerAccountId: 'user-1', linkedAccountId: 'user-1',
      status: 'active', createdAt: now, updatedAt: now,
    })
    await db.sessions.put(session({ id: 's-for-claimed', athleteId: 'ath_claimed', date: '2026-07-14' }))
    const rows = await getWeekSessionsForAthlete('user-1', 'ath_claimed', '2026-07-13')
    expect(rows.map((row) => row.id)).toContain('s-legacy')
    expect(rows.map((row) => row.id)).toContain('s-for-claimed')
  })
})

describe('assertActiveRosterAthlete', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    await db.athletes.bulkPut([
      {
        id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null,
        status: 'active', createdAt: now, updatedAt: now,
      },
      {
        id: 'ath_archived', ownerAccountId: 'user-1', linkedAccountId: null,
        status: 'archived', createdAt: now, updatedAt: now,
      },
    ])
  })

  afterEach(() => db.close())

  it('acepta un atleta activo', async () => {
    await expect(assertActiveRosterAthlete('user-1', 'ath_m_a')).resolves.toMatchObject({ id: 'ath_m_a' })
  })

  it('rechaza un atleta archivado con copy propio', async () => {
    await expect(assertActiveRosterAthlete('user-1', 'ath_archived'))
      .rejects.toThrow('Este atleta está archivado; restauralo para editar su semana.')
  })

  it('rechaza atletas fuera del roster', async () => {
    await expect(assertActiveRosterAthlete('user-1', 'ath_ajeno'))
      .rejects.toThrow('El atleta no pertenece a tu roster.')
  })

  it('la aserción base sigue aceptando archivados', async () => {
    await expect(assertRosterAthlete('user-1', 'ath_archived')).resolves.toMatchObject({ id: 'ath_archived' })
  })
})

describe('getAthleteProfileForAthlete', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId(null)
  })

  afterEach(() => {
    setSelfAthleteId(null)
    db.close()
  })

  it('encuentra la fila singleton para el self resuelto', async () => {
    setSelfAthleteId('ath_user-1')
    await db.athleteProfiles.put({
      id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: now, primarySport: 'running',
    } as never)
    const profile = await getAthleteProfileForAthlete('user-1', 'ath_user-1')
    expect(profile?.primarySport).toBe('running')
  })

  it('encuentra un gestionado por athleteId y nunca adopta el singleton', async () => {
    await db.athleteProfiles.put({
      id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: now, primarySport: 'running',
    } as never)
    await db.athleteProfiles.put({
      id: 'p-managed', athleteId: 'ath_m_a', updatedAt: now, primarySport: 'squash',
    } as never)
    expect((await getAthleteProfileForAthlete('user-1', 'ath_m_a'))?.primarySport).toBe('squash')
    await db.athleteProfiles.delete('p-managed')
    expect(await getAthleteProfileForAthlete('user-1', 'ath_m_a')).toBeUndefined()
  })

  it('usa la PK histórica del gestionado como fallback', async () => {
    await db.athleteProfiles.put({ id: 'ath_m_a', updatedAt: now, primarySport: 'cycling' } as never)
    expect((await getAthleteProfileForAthlete('user-1', 'ath_m_a'))?.primarySport).toBe('cycling')
  })
})
describe('roster por membresía', () => {
  const now = Date.now()

  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    await db.athletes.bulkPut([
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_revoked', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'R', status: 'active', createdAt: now, updatedAt: now },
    ] as never)
    await db.athleteMemberships.bulkPut([
      { athleteId: 'ath_user-1', accountId: 'user-1', role: 'self', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now },
    ])
    await markMembershipsHydrated('user-1')
    await db.sessions.put(session({ id: 't-1', athleteId: 'ath_m_t', date: '2026-07-14' }))
    setSelfAthleteId('ath_user-1')
  })

  afterEach(() => {
    setSelfAthleteId(null)
    db.close()
  })

  it('assertRosterAthlete acepta el transferido y rechaza el revocado', async () => {
    await expect(assertRosterAthlete('user-1', 'ath_m_t')).resolves.toMatchObject({ id: 'ath_m_t' })
    await expect(assertRosterAthlete('user-1', 'ath_m_revoked')).rejects.toThrow('El atleta no pertenece a tu roster.')
  })

  it('getWeekSessionsForAthlete lee la semana del transferido sin adoptar legacy', async () => {
    await db.sessions.put(session({ id: 'legacy-1', date: '2026-07-15' }))

    const rows = await getWeekSessionsForAthlete('user-1', 'ath_m_t', '2026-07-13')

    expect(rows.map((row) => row.id)).toEqual(['t-1'])
  })

  it('getRosterTriageData salta al revocado y conserva al transferido', async () => {
    const { rowsByAthlete, skippedAthleteIds } = await getRosterTriageData(
      'user-1',
      ['ath_user-1', 'ath_m_t', 'ath_m_revoked'],
      'ath_user-1',
      {
        dayLogsFromISO: '2026-07-01', dayLogsToISO: '2026-07-20',
        sessionsFromISO: '2026-07-01', sessionsToISO: '2026-07-20',
        summariesFromISO: '2026-07-06', summariesToISO: '2026-07-06',
      },
    )

    expect([...skippedAthleteIds]).toEqual(['ath_m_revoked'])
    expect(rowsByAthlete.get('ath_m_t')?.sessionsInWindow.map((row) => row.id)).toEqual(['t-1'])
  })
})
