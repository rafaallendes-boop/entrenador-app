import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { getDayLog, getDayLogsForWeek, getWeekSummary, upsertDayLog, upsertWeekSummary } from '../queries'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { setAccountRole } from '../../services/entitlements/accountRoleHolder'
import type { WeekSummary } from '../../types'

vi.mock('../../services/syncService', () => ({
  pushWeekSummary: vi.fn(),
}))

describe('upsertDayLog athlete scope', () => {
  beforeEach(async () => {
    setAccountRole('athlete')
    db.close()
    await db.delete()
    await db.open()
    // Single-athlete scenario: the owner's self athlete IS the active one.
    setSelfAthleteId('ath_A')
  })

  afterEach(() => {
    setAccountRole('unknown')
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('stamps the active athlete id when creating', async () => {
    setActiveAthleteId('ath_A')
    const log = await upsertDayLog('2026-06-30', { sleepHours: 7 })
    expect(log.athleteId).toBe('ath_A')
  })

  it('does not write athleteId when no active athlete exists', async () => {
    setActiveAthleteId(null)
    const log = await upsertDayLog('2026-06-30', { sleepHours: 7 })
    expect(log.athleteId).toBeUndefined()
    expect('athleteId' in log && log.athleteId === null).toBe(false)
  })

  it('backfills athleteId on update when a legacy row lacks it', async () => {
    await db.dayLogs.put({ id: 'legacy', date: '2026-06-30', updatedAt: 1 })
    setActiveAthleteId('ath_A')
    const log = await upsertDayLog('2026-06-30', { sleepHours: 8 })
    expect(log.id).toBe('legacy')
    expect(log.athleteId).toBe('ath_A')
    expect(await db.dayLogs.count()).toBe(1)
  })

  it("stamps over the legacy 'default' sentinel on update", async () => {
    await db.dayLogs.put({ id: 'legacy', athleteId: 'default', date: '2026-06-30', updatedAt: 1 })
    setActiveAthleteId('ath_A')
    const log = await upsertDayLog('2026-06-30', { sleepHours: 8 })
    expect(log.athleteId).toBe('ath_A')
  })

  it('a patch cannot override the resolved athlete scope', async () => {
    setActiveAthleteId('ath_A')
    const created = await upsertDayLog('2026-06-30', { athleteId: 'ath_B' } as never)
    expect(created.athleteId).toBe('ath_A')
    const updated = await upsertDayLog('2026-06-30', { athleteId: 'ath_B', sleepHours: 6 } as never)
    expect(updated.athleteId).toBe('ath_A')
  })
})

describe('upsertWeekSummary athlete scope', () => {
  beforeEach(async () => {
    setAccountRole('athlete')
    db.close()
    await db.delete()
    await db.open()
    // Single-athlete scenario: the owner's self athlete IS the active one.
    setSelfAthleteId('ath_A')
  })

  afterEach(() => {
    setAccountRole('unknown')
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('stamps the active athlete id when creating', async () => {
    setActiveAthleteId('ath_A')
    const summary = await upsertWeekSummary('2026-06-29', { totalSessions: 1 })
    expect(summary.athleteId).toBe('ath_A')
  })

  it('does not write athleteId when no active athlete exists', async () => {
    setActiveAthleteId(null)
    const summary = await upsertWeekSummary('2026-06-29', { totalSessions: 1 })
    expect(summary.athleteId).toBeUndefined()
  })

  it('stamps a legacy summary even when the patch changes no metrics', async () => {
    await db.weekSummaries.put(makeWeekSummary({ id: 'legacy', weekStartDate: '2026-06-29', totalSessions: 3 }))
    setActiveAthleteId('ath_A')
    const summary = await upsertWeekSummary('2026-06-29', { totalSessions: 3 })
    expect(summary.id).toBe('legacy')
    expect(summary.athleteId).toBe('ath_A')
  })

  it("stamps over the legacy 'default' sentinel on update", async () => {
    await db.weekSummaries.put(makeWeekSummary({ id: 'legacy', athleteId: 'default', weekStartDate: '2026-06-29', totalSessions: 3 }))
    setActiveAthleteId('ath_A')
    const summary = await upsertWeekSummary('2026-06-29', { totalSessions: 3 })
    expect(summary.athleteId).toBe('ath_A')
  })

  it('a patch cannot override the resolved athlete scope', async () => {
    setActiveAthleteId('ath_A')
    const created = await upsertWeekSummary('2026-06-29', { athleteId: 'ath_B' } as never)
    expect(created.athleteId).toBe('ath_A')
    const updated = await upsertWeekSummary('2026-06-29', { athleteId: 'ath_B', totalSessions: 9 } as never)
    expect(updated.athleteId).toBe('ath_A')
  })
})

describe('athlete-aware lookups', () => {
  beforeEach(async () => {
    setAccountRole('athlete')
    db.close()
    await db.delete()
    await db.open()
    // Single-athlete scenario: the owner's self athlete IS the active one.
    setSelfAthleteId('ath_A')
  })

  afterEach(() => {
    setAccountRole('unknown')
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('getDayLog returns the active athlete row', async () => {
    await db.dayLogs.bulkPut([
      { id: 'a', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 7 },
      { id: 'b', athleteId: 'ath_B', date: '2026-06-30', updatedAt: 1, sleepHours: 5 },
    ])
    setActiveAthleteId('ath_A')
    expect((await getDayLog('2026-06-30'))?.id).toBe('a')
  })

  it('getDayLog fallback finds a legacy row without mutating reads, never another athlete', async () => {
    await db.dayLogs.bulkPut([
      { id: 'legacy', date: '2026-06-30', updatedAt: 1 },
      { id: 'other', athleteId: 'ath_B', date: '2026-07-01', updatedAt: 1 },
    ])
    setActiveAthleteId('ath_A')
    const found = await getDayLog('2026-06-30')
    expect(found?.id).toBe('legacy')
    expect((await db.dayLogs.get('legacy'))?.athleteId).toBeUndefined()
    expect(await getDayLog('2026-07-01')).toBeUndefined()
  })

  it('getWeekSummary returns legacy fallback without mutating reads', async () => {
    await db.weekSummaries.bulkPut([
      makeWeekSummary({ id: 'legacy', weekStartDate: '2026-06-29' }),
      makeWeekSummary({ id: 'other', athleteId: 'ath_B', weekStartDate: '2026-07-06' }),
    ])
    setActiveAthleteId('ath_A')
    expect((await getWeekSummary('2026-06-29'))?.id).toBe('legacy')
    expect((await db.weekSummaries.get('legacy'))?.athleteId).toBeUndefined()
    expect(await getWeekSummary('2026-07-06')).toBeUndefined()
  })

  it('getDayLogsForWeek scopes and coalesces legacy rows without mutating reads', async () => {
    await db.dayLogs.bulkPut([
      { id: 'scoped', athleteId: 'ath_A', date: '2026-06-29', updatedAt: 2 },
      { id: 'legacy', date: '2026-06-29', updatedAt: 1 },
      { id: 'legacy2', date: '2026-06-30', updatedAt: 1 },
      { id: 'other', athleteId: 'ath_B', date: '2026-07-01', updatedAt: 1 },
    ])
    setActiveAthleteId('ath_A')
    const rows = await getDayLogsForWeek('2026-06-29')
    expect(rows.map((row) => row.id)).toEqual(['scoped', 'legacy2'])
    expect((await db.dayLogs.get('legacy2'))?.athleteId).toBeUndefined()
  })

  it('no-active lookups prefer legacy and avoid arbitrary multi-athlete rows', async () => {
    await db.dayLogs.bulkPut([
      { id: 'a', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1 },
      { id: 'b', athleteId: 'ath_B', date: '2026-06-30', updatedAt: 1 },
    ])
    await db.weekSummaries.bulkPut([
      makeWeekSummary({ id: 'wa', athleteId: 'ath_A', weekStartDate: '2026-06-29' }),
      makeWeekSummary({ id: 'wb', athleteId: 'ath_B', weekStartDate: '2026-06-29' }),
    ])

    expect(await getDayLog('2026-06-30')).toBeUndefined()
    expect(await getWeekSummary('2026-06-29')).toBeUndefined()

    await db.dayLogs.put({ id: 'legacy', date: '2026-07-01', updatedAt: 1 })
    await db.weekSummaries.put(makeWeekSummary({ id: 'wlegacy', weekStartDate: '2026-07-06' }))

    expect((await getDayLog('2026-07-01'))?.id).toBe('legacy')
    expect((await getWeekSummary('2026-07-06'))?.id).toBe('wlegacy')
  })
})

function makeWeekSummary(overrides: Partial<WeekSummary> = {}): WeekSummary {
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
