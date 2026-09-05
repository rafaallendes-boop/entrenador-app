import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../db/db'
import { useAuthStore } from '../../store/useAuthStore'
import { setActiveAthleteId } from '../athlete/activeAthlete'
import { exportAppData, importAppDataFromFile, parseAppDataExport } from '../dataExport'

function weekSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'week-1',
    weekStartDate: '2026-06-29',
    updatedAt: 1,
    totalSessions: 0,
    totalMinutes: 0,
    plannedSessions: 0,
    completedSessions: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    squashSessions: 0,
    runningSessions: 0,
    strengthSessions: 0,
    ...overrides,
  }
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    date: '2026-06-30',
    weekStartDate: '2026-06-29',
    timeBlock: 'AM',
    type: 'running',
    status: 'planned',
    title: 'Easy run',
    durationMin: 30,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function backupFixture(overrides: {
  sessions?: unknown[]
  dayLogs?: unknown[]
  weekSummaries?: unknown[]
  athleteProfiles?: unknown[]
  athletes?: unknown[]
} = {}) {
  return {
    app: 'RallyIQ',
    version: 3,
    exportedAt: '2026-06-30T12:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: overrides.sessions ?? [],
      dayLogs: overrides.dayLogs ?? [],
      weekSummaries: overrides.weekSummaries ?? [],
      trainingPlans: [],
      trainingPlanWeeks: [],
      chatMessages: [],
      coachProposals: [],
      athleteProfiles: overrides.athleteProfiles ?? [],
      athletes: overrides.athletes ?? [],
    },
  }
}

function backupFile(overrides: Parameters<typeof backupFixture>[0] = {}): File {
  return new File([JSON.stringify(backupFixture(overrides))], 'backup.json', { type: 'application/json' })
}

function installLocalStorage() {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => state.set(key, value),
      removeItem: (key: string) => state.delete(key),
    },
  })
}

describe('dataExport athleteId import support', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setActiveAthleteId(null)
    useAuthStore.setState({ user: null })
  })

  afterEach(() => {
    setActiveAthleteId(null)
    useAuthStore.setState({ user: null })
    db.close()
    delete (globalThis as { localStorage?: Storage }).localStorage
  })

  it('preserves athleteId in parsed sessions, day logs, and week summaries', () => {
    const parsed = parseAppDataExport(backupFixture({
      sessions: [session({ athleteId: 'ath_A' })],
      dayLogs: [{ id: 'day-1', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1 }],
      weekSummaries: [weekSummary({ athleteId: 'ath_A' })],
    }))

    expect(parsed.tables.sessions[0].athleteId).toBe('ath_A')
    expect(parsed.tables.dayLogs[0].athleteId).toBe('ath_A')
    expect(parsed.tables.weekSummaries[0].athleteId).toBe('ath_A')
  })

  it('preserves athletes and enriched goal event fields in parsed backups', () => {
    const parsed = parseAppDataExport(backupFixture({
      athletes: [{
        id: 'ath_m_1',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        displayName: 'Cliente 1',
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      }],
      athleteProfiles: [{
        id: 'ath_m_1',
        athleteId: 'ath_m_1',
        onboardingDeferredAt: 4,
        updatedAt: 3,
        goalEvents: [{
          id: 'event-1',
          title: '10K',
          date: '2026-08-01',
          sport: 'running',
          priority: 'primary',
          notes: 'A race',
          eventType: 'race',
          objective: 'personal_best',
          competitiveLevel: 'competitive',
        }],
        planWizardConfig: {
          goalEventId: 'event-1',
          trainingDays: ['monday', 'wednesday'],
          sessionsPerWeek: 4,
          sessionDurationMins: 60,
          allowDoubleSession: true,
          doubleSessionDays: ['wednesday'],
          scheduleConstraints: 'miércoles doble',
          partnerAvailability: 'either',
          complementarySports: ['strength'],
          currentFitnessLevel: 'fit',
          currentFatigue: 'normal',
          injuryNotes: 'sin dolor',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
      }],
    }))

    expect(parsed.tables.athletes).toEqual([{
      id: 'ath_m_1',
      ownerAccountId: 'user-1',
      linkedAccountId: null,
      displayName: 'Cliente 1',
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    }])
    expect(parsed.tables.athleteProfiles[0].goalEvents?.[0]).toMatchObject({
      eventType: 'race',
      objective: 'personal_best',
      competitiveLevel: 'competitive',
    })
    expect(parsed.tables.athleteProfiles[0]).toMatchObject({
      athleteId: 'ath_m_1',
      onboardingDeferredAt: 4,
      planWizardConfig: {
        goalEventId: 'event-1',
        trainingDays: ['monday', 'wednesday'],
        doubleSessionDays: ['wednesday'],
        scheduleConstraints: 'miércoles doble',
        partnerAvailability: 'either',
      },
    })
  })

  it('survives the export/import round-trip for a declared performance limiter', async () => {
    await db.athleteProfiles.put({
      id: 'default',
      updatedAt: 1,
      name: 'Rafa',
      performanceLimiter: 'recuperación cardíaca entre puntos',
    })

    const exported = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(exported.json))

    expect(parsed.tables.athleteProfiles[0].performanceLimiter).toBe('recuperación cardíaca entre puntos')
  })

  it('exports athletes with the rest of the app data', async () => {
    await db.athletes.put({
      id: 'ath_m_1',
      ownerAccountId: 'user-1',
      linkedAccountId: null,
      displayName: 'Cliente 1',
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })

    const exported = await exportAppData()
    const parsed = JSON.parse(exported.json) as { tables: { athletes: unknown[] } }

    expect(parsed.tables.athletes).toHaveLength(1)
    expect(parsed.tables.athletes[0]).toMatchObject({ id: 'ath_m_1', displayName: 'Cliente 1' })
  })

  it('leaves old backup day/week athleteId undefined when absent', () => {
    const parsed = parseAppDataExport(backupFixture({
      dayLogs: [{ id: 'day-1', date: '2026-06-30', updatedAt: 1 }],
      weekSummaries: [weekSummary()],
    }))

    expect(parsed.tables.dayLogs[0].athleteId).toBeUndefined()
    expect(parsed.tables.weekSummaries[0].athleteId).toBeUndefined()
  })

  it('merge coalesces an imported day log onto a local row with the same natural key', async () => {
    setActiveAthleteId('ath_A')
    await db.dayLogs.put({ id: 'local-id', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 5 })

    await importAppDataFromFile(backupFile({
      dayLogs: [{ id: 'backup-id', date: '2026-06-30', updatedAt: 9, sleepHours: 8 }],
    }), 'merge')

    const rows = await db.dayLogs.where('[athleteId+date]').equals(['ath_A', '2026-06-30']).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'local-id',
      athleteId: 'ath_A',
      sleepHours: 8,
    })
    expect(await db.dayLogs.get('backup-id')).toBeUndefined()
  })

  it('merge absorbs a legacy local straggler when a scoped local row already owns the natural key', async () => {
    setActiveAthleteId('ath_A')
    await db.dayLogs.bulkPut([
      { id: 'scoped-id', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 5 },
      { id: 'legacy-id', date: '2026-06-30', updatedAt: 8, sleepHours: 7 },
    ])

    await importAppDataFromFile(backupFile({
      dayLogs: [{ id: 'backup-id', date: '2026-06-30', updatedAt: 9, sleepHours: 8 }],
    }), 'merge')

    const rows = await db.dayLogs.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'scoped-id',
      athleteId: 'ath_A',
      date: '2026-06-30',
      sleepHours: 8,
    })
    expect(await db.dayLogs.get('legacy-id')).toBeUndefined()
  })

  it('merge does not clean unrelated local duplicate groups when the backup does not touch their key', async () => {
    setActiveAthleteId('ath_A')
    await db.dayLogs.bulkPut([
      { id: 'scoped-id', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 5 },
      { id: 'legacy-id', date: '2026-06-30', updatedAt: 8, sleepHours: 7 },
    ])

    await importAppDataFromFile(backupFile({
      dayLogs: [{ id: 'backup-id', date: '2026-07-01', updatedAt: 9, sleepHours: 8 }],
    }), 'merge')

    expect(await db.dayLogs.get('scoped-id')).toMatchObject({ sleepHours: 5 })
    expect(await db.dayLogs.get('legacy-id')).toMatchObject({ sleepHours: 7 })
    expect(await db.dayLogs.where('[athleteId+date]').equals(['ath_A', '2026-07-01']).first())
      .toMatchObject({ id: 'backup-id', sleepHours: 8 })
  })

  it('merge writes the normalized local survivor when local duplicate data beats the backup row', async () => {
    setActiveAthleteId('ath_A')
    await db.dayLogs.bulkPut([
      { id: 'scoped-id', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 5 },
      { id: 'legacy-id', date: '2026-06-30', updatedAt: 8, sleepHours: 7 },
    ])

    await importAppDataFromFile(backupFile({
      dayLogs: [{ id: 'backup-id', date: '2026-06-30', updatedAt: 2, sleepHours: 6 }],
    }), 'merge')

    const rows = await db.dayLogs.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'scoped-id',
      athleteId: 'ath_A',
      date: '2026-06-30',
      updatedAt: 8,
      sleepHours: 7,
    })
  })

  it('merge generates a new id when an imported row id belongs to a different local natural key', async () => {
    setActiveAthleteId('ath_A')
    await db.dayLogs.put({
      id: 'backup-id',
      athleteId: 'ath_A',
      date: '2026-07-01',
      updatedAt: 10,
      sleepHours: 5,
    })

    await importAppDataFromFile(backupFile({
      dayLogs: [{ id: 'backup-id', date: '2026-06-30', updatedAt: 9, sleepHours: 8 }],
    }), 'merge')

    const existing = await db.dayLogs.get('backup-id')
    expect(existing).toMatchObject({ date: '2026-07-01', sleepHours: 5 })
    const imported = await db.dayLogs.where('[athleteId+date]').equals(['ath_A', '2026-06-30']).first()
    expect(imported).toMatchObject({ athleteId: 'ath_A', date: '2026-06-30', sleepHours: 8 })
    expect(imported?.id).not.toBe('backup-id')
  })

  it('replace coalesces backup rows that collide after athlete stamping', async () => {
    setActiveAthleteId('ath_A')

    await importAppDataFromFile(backupFile({
      dayLogs: [
        { id: 'old-id', date: '2026-06-30', updatedAt: 1, sleepHours: 5 },
        { id: 'new-id', date: '2026-06-30', updatedAt: 9, sleepHours: 8 },
      ],
    }), 'replace')

    const rows = await db.dayLogs.where('[athleteId+date]').equals(['ath_A', '2026-06-30']).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'old-id',
      athleteId: 'ath_A',
      sleepHours: 8,
    })
    expect(await db.dayLogs.get('new-id')).toBeUndefined()
  })

  it('replace restores athletes before the next backfill/sync cycle', async () => {
    await db.athletes.put({
      id: 'ath_old',
      ownerAccountId: 'user-1',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })

    await importAppDataFromFile(backupFile({
      athletes: [{
        id: 'ath_m_1',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        displayName: 'Cliente 1',
        status: 'active',
        createdAt: 10,
        updatedAt: 11,
      }],
    }), 'replace')

    expect(await db.athletes.get('ath_old')).toBeUndefined()
    expect(await db.athletes.get('ath_m_1')).toMatchObject({
      ownerAccountId: 'user-1',
      displayName: 'Cliente 1',
    })
  })

  it('merge keeps a newer local athlete row over the backup roster row', async () => {
    await db.athletes.put({
      id: 'ath_m_1',
      ownerAccountId: 'user-1',
      linkedAccountId: null,
      displayName: 'Nombre local',
      status: 'active',
      createdAt: 1,
      updatedAt: 20,
    })

    await importAppDataFromFile(backupFile({
      athletes: [{
        id: 'ath_m_1',
        ownerAccountId: 'user-1',
        linkedAccountId: null,
        displayName: 'Nombre backup',
        status: 'active',
        createdAt: 1,
        updatedAt: 10,
      }],
    }), 'merge')

    expect(await db.athletes.get('ath_m_1')).toMatchObject({
      displayName: 'Nombre local',
      updatedAt: 20,
    })
  })

  it('invalidates the owner backfill marker after import', async () => {
    installLocalStorage()
    useAuthStore.setState({ user: { id: 'user-1' } as never })
    localStorage.setItem('entrenador_athlete_scope_backfill_v2:user-1', 'ath_user-1')

    await importAppDataFromFile(backupFile(), 'merge')

    expect(localStorage.getItem('entrenador_athlete_scope_backfill_v2:user-1')).toBeNull()
  })

  it('marks global backfill dirty when importing without a signed-in owner', async () => {
    installLocalStorage()

    await importAppDataFromFile(backupFile(), 'merge')

    expect(localStorage.getItem('entrenador_athlete_scope_import_dirty_v1')).toBe('1')
  })
})
