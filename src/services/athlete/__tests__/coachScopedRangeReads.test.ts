import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import type { Session, WeekSummary } from '../../../types'
import { getRosterTriageData } from '../coachScopedReads'

const OWNER = 'acc_1'
const SELF_ID = 'ath_self'
const MANAGED_ID = 'ath_managed'
const NOW = 1_700_000_000_000
const WINDOWS = {
  dayLogsFromISO: '2026-08-15',
  dayLogsToISO: '2026-08-29',
  sessionsFromISO: '2026-08-15',
  sessionsToISO: '2026-08-28',
  summariesFromISO: '2026-08-17',
  summariesToISO: '2026-08-17',
}

async function readRoster(athleteIds = [SELF_ID, MANAGED_ID]) {
  return getRosterTriageData(OWNER, athleteIds, SELF_ID, WINDOWS)
}

function session(partial: Partial<Session>): Session {
  return {
    id: 'session',
    athleteId: SELF_ID,
    date: '2026-08-20',
    timeBlock: 'AM',
    type: 'squash',
    status: 'planned',
    title: 'Sesión',
    durationMin: 60,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  } as Session
}

function weekSummary(partial: Partial<WeekSummary>): WeekSummary {
  return {
    id: 'summary',
    athleteId: SELF_ID,
    weekStartDate: '2026-08-17',
    totalSessions: 0,
    totalMinutes: 0,
    plannedSessions: 0,
    completedSessions: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    squashSessions: 0,
    runningSessions: 0,
    strengthSessions: 0,
    ...partial,
  }
}

describe('lecturas scoped por rango', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    await db.athletes.bulkPut([
      {
        id: SELF_ID,
        ownerAccountId: OWNER,
        linkedAccountId: OWNER,
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: MANAGED_ID,
        ownerAccountId: OWNER,
        linkedAccountId: null,
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'ath_other',
        ownerAccountId: OWNER,
        linkedAccountId: null,
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    db.close()
  })

  it('no devuelve filas de otro atleta', async () => {
    await db.dayLogs.bulkPut([
      { id: 'self', athleteId: SELF_ID, date: '2026-08-20', updatedAt: 1 },
      { id: 'other', athleteId: 'ath_other', date: '2026-08-20', updatedAt: 1 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.dayLogsInPainWindow.map((row) => row.id))
      .toEqual(['self'])
  })

  it('un gestionado nunca ve filas legacy', async () => {
    await db.dayLogs.put({ id: 'legacy', date: '2026-08-20', updatedAt: 1 })

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(MANAGED_ID)?.dayLogsInPainWindow).toEqual([])
  })

  it('ante colisión scoped/legacy del self en la misma fecha, gana la scoped', async () => {
    await db.dayLogs.bulkPut([
      { id: 'scoped', athleteId: SELF_ID, date: '2026-08-20', energyLevel: 8, updatedAt: 2 },
      { id: 'legacy', date: '2026-08-20', energyLevel: 3, updatedAt: 1 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.dayLogsInPainWindow).toHaveLength(1)
    expect(rowsByAthlete.get(SELF_ID)?.dayLogsInPainWindow[0]?.id).toBe('scoped')
  })

  it('ante filas legacy duplicadas conserva la de updatedAt más reciente', async () => {
    await db.dayLogs.bulkPut([
      { id: 'legacy-new', date: '2026-08-20', energyLevel: 8, updatedAt: 20 },
      { id: 'legacy-old', date: '2026-08-20', energyLevel: 3, updatedAt: 10 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.dayLogsInPainWindow).toHaveLength(1)
    expect(rowsByAthlete.get(SELF_ID)?.dayLogsInPainWindow[0]?.id).toBe('legacy-new')
  })

  it('weekSummaries deduplica por weekStartDate con la misma precedencia', async () => {
    await db.weekSummaries.bulkPut([
      weekSummary({ id: 'scoped', athleteId: SELF_ID, plannedSessions: 4, completedSessions: 4 }),
      weekSummary({ id: 'legacy', athleteId: undefined, plannedSessions: 1 }),
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.summariesInWindow).toHaveLength(1)
    expect(rowsByAthlete.get(SELF_ID)?.summariesInWindow[0]?.id).toBe('scoped')
  })

  it('sessions no deduplica: dos sesiones el mismo día son dos filas', async () => {
    await db.sessions.bulkPut([
      session({ id: 's1', timeBlock: 'AM' }),
      session({ id: 's2', timeBlock: 'PM' }),
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.sessionsInWindow.map((row) => row.id))
      .toEqual(['s1', 's2'])
  })

  it('devuelve el último registro scoped mediante el índice aunque esté fuera de la ventana', async () => {
    await db.dayLogs.bulkPut([
      { id: 'old', athleteId: SELF_ID, date: '2026-07-01', updatedAt: 1 },
      { id: 'latest', athleteId: SELF_ID, date: '2026-07-20', updatedAt: 1 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.latestDayLog).toMatchObject({ id: 'latest' })
  })

  it('ignora check-ins con fecha futura al resolver el último registro', async () => {
    // Un check-in guardado desde DayDetail en un día posterior de la semana en
    // curso dejaría daysSinceCheckIn negativo y suprimiría la señal
    // `no-check-in` hasta esa fecha. El techo aplica a scoped y a legacy.
    await db.dayLogs.bulkPut([
      { id: 'self-past', athleteId: SELF_ID, date: '2026-08-27', updatedAt: 1 },
      { id: 'self-future', athleteId: SELF_ID, date: '2026-09-05', updatedAt: 1 },
      { id: 'legacy-future', date: '2026-09-04', updatedAt: 1 },
      { id: 'managed-past', athleteId: MANAGED_ID, date: '2026-08-26', updatedAt: 1 },
      { id: 'managed-future', athleteId: MANAGED_ID, date: '2026-09-03', updatedAt: 1 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.latestDayLog).toMatchObject({ id: 'self-past' })
    expect(rowsByAthlete.get(MANAGED_ID)?.latestDayLog).toMatchObject({ id: 'managed-past' })
  })

  it('con backfill completo no recorre el historial legacy fuera de la ventana', async () => {
    const storage = new Map<string, string>([
      [`entrenador_athlete_scope_backfill_v2:${OWNER}`, SELF_ID],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })
    const where = vi.spyOn(db.dayLogs, 'where')

    await readRoster()

    expect(where.mock.calls.filter(([index]) => index === 'date')).toHaveLength(1)
    expect(where).toHaveBeenCalledWith('[athleteId+date]')
  })

  it('compara scoped con legacy y prefiere scoped ante empate', async () => {
    await db.dayLogs.bulkPut([
      { id: 'scoped', athleteId: SELF_ID, date: '2026-08-20', updatedAt: 2 },
      { id: 'legacy-same-date', date: '2026-08-20', updatedAt: 1 },
      { id: 'legacy-older', date: '2026-08-19', updatedAt: 3 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.latestDayLog).toMatchObject({ id: 'scoped' })
  })

  it('adopta el legacy más reciente sólo para el self', async () => {
    await db.dayLogs.bulkPut([
      { id: 'self-scoped-old', athleteId: SELF_ID, date: '2026-08-18', updatedAt: 1 },
      { id: 'legacy-new', date: '2026-08-21', updatedAt: 1 },
      { id: 'managed-old', athleteId: MANAGED_ID, date: '2026-08-17', updatedAt: 1 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.latestDayLog).toMatchObject({ id: 'legacy-new' })
    expect(rowsByAthlete.get(MANAGED_ID)?.latestDayLog).toMatchObject({ id: 'managed-old' })
  })

  it('desempata legacy duplicados por updatedAt', async () => {
    await db.dayLogs.bulkPut([
      { id: 'legacy-new', date: '2026-08-21', updatedAt: 20 },
      { id: 'legacy-old', date: '2026-08-21', updatedAt: 10 },
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.latestDayLog).toMatchObject({ id: 'legacy-new' })
  })

  it('agrupa todo el roster en memoria y asigna legacy sólo al self canónico', async () => {
    await db.dayLogs.bulkPut([
      { id: 'self', athleteId: SELF_ID, date: '2026-08-20', updatedAt: 1 },
      { id: 'managed', athleteId: MANAGED_ID, date: '2026-08-20', updatedAt: 1 },
      { id: 'legacy', date: '2026-08-19', updatedAt: 1 },
    ])
    await db.sessions.bulkPut([
      session({ id: 'self-session', athleteId: SELF_ID }),
      session({ id: 'managed-session', athleteId: MANAGED_ID }),
    ])

    const { rowsByAthlete } = await readRoster()

    expect(rowsByAthlete.get(SELF_ID)?.dayLogsInPainWindow.map((row) => row.id))
      .toEqual(['legacy', 'self'])
    expect(rowsByAthlete.get(MANAGED_ID)?.dayLogsInPainWindow.map((row) => row.id))
      .toEqual(['managed'])
    expect(rowsByAthlete.get(SELF_ID)?.sessionsInWindow.map((row) => row.id))
      .toEqual(['self-session'])
    expect(rowsByAthlete.get(MANAGED_ID)?.sessionsInWindow.map((row) => row.id))
      .toEqual(['managed-session'])
  })

  it('omite sin rechazar a un atleta archivado durante la lectura agregada', async () => {
    await db.athletes.update(MANAGED_ID, { status: 'archived' })

    const { rowsByAthlete, skippedAthleteIds } = await readRoster()

    expect(rowsByAthlete.has(SELF_ID)).toBe(true)
    expect(rowsByAthlete.has(MANAGED_ID)).toBe(false)
    expect(skippedAthleteIds).toEqual(new Set([MANAGED_ID]))
  })
})
