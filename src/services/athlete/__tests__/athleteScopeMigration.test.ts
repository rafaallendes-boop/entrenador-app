import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory fake Dexie tables (the project mocks ../../db/db instead of using a
// real IndexedDB). Defined via vi.hoisted so the vi.mock factory can reference them.
const fakes = vi.hoisted(() => {
  interface Row { id: string; athleteId?: string; [k: string]: unknown }
  function fakeTable(initial: Row[] = []) {
    let rows: Row[] = initial.map((r) => ({ ...r }))
    return {
      async get(id: string) {
        return rows.find((r) => r.id === id)
      },
      async put(row: Row) {
        const i = rows.findIndex((r) => r.id === row.id)
        if (i >= 0) rows[i] = row
        else rows.push(row)
        return row.id
      },
      async bulkPut(items: Row[]) {
        for (const it of items) {
          const i = rows.findIndex((r) => r.id === it.id)
          if (i >= 0) rows[i] = it
          else rows.push(it)
        }
      },
      async toArray() {
        return rows.map((r) => ({ ...r }))
      },
      async count() {
        return rows.length
      },
      async clear() {
        rows = []
      },
    }
  }
  const db = {
    athletes: fakeTable(),
    sessions: fakeTable(),
    dayLogs: fakeTable(),
    weekSummaries: fakeTable(),
    chatMessages: fakeTable(),
    coachProposals: fakeTable(),
    athleteProfiles: fakeTable(),
    trainingPlans: fakeTable(),
    trainingPlanWeeks: fakeTable(),
    planGenerationJobs: fakeTable(),
  }
  return { db, fakeTable }
})

vi.mock('../../../db/db', () => ({ db: fakes.db }))

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return state.size
      },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => {
        state.set(key, value)
      },
      removeItem: (key: string) => {
        state.delete(key)
      },
      clear: () => {
        state.clear()
      },
    },
  })
}

import {
  athleteIdForOwner,
  backfillLocalAthleteScope,
  planAthleteScopeMigration,
} from '../athleteScopeMigration'

describe('athleteIdForOwner', () => {
  it('mirrors the SQL deterministic id', () => {
    expect(athleteIdForOwner('user-1')).toBe('ath_user-1')
  })
})

describe('planAthleteScopeMigration (dry-run)', () => {
  it('reports rows to map vs already mapped, without mutating', () => {
    const snapshot = {
      tables: {
        sessions: [{ athleteId: 'ath_1' }, { athleteId: null }, {}],
        dayLogs: [{ athleteId: undefined }],
        trainingPlans: [{ athleteId: 'default' }], // legacy 'default' counts as pending
      },
    }
    const report = planAthleteScopeMigration(snapshot)
    expect(report.perTable.sessions).toEqual({ total: 3, toMap: 2, alreadyMapped: 1 })
    expect(report.perTable.dayLogs).toEqual({ total: 1, toMap: 1, alreadyMapped: 0 })
    expect(report.perTable.trainingPlans).toEqual({ total: 1, toMap: 1, alreadyMapped: 0 })
    expect(report.totalToMap).toBe(4)
    expect(snapshot.tables.sessions[1]).toEqual({ athleteId: null })
  })
})

describe('backfillLocalAthleteScope', () => {
  beforeEach(async () => {
    for (const t of Object.values(fakes.db)) await t.clear()
    if (typeof localStorage !== 'undefined') localStorage.clear()
  })

  it('creates the athlete row and stamps athleteId on legacy rows', async () => {
    await fakes.db.athleteProfiles.put({ id: 'default', updatedAt: Date.now() })
    await fakes.db.sessions.put({ id: 's1', date: '2026-06-29' })
    await fakes.db.trainingPlans.put({ id: 'p1', athleteId: 'default' })

    const id = await backfillLocalAthleteScope('user-1')
    expect(id).toBe('ath_user-1')

    const athlete = await fakes.db.athletes.get('ath_user-1')
    expect(athlete?.ownerAccountId).toBe('user-1')
    expect((await fakes.db.sessions.get('s1'))?.athleteId).toBe('ath_user-1')
    // legacy 'default' on the plan is rewritten to the real id
    expect((await fakes.db.trainingPlans.get('p1'))?.athleteId).toBe('ath_user-1')
  })

  it('is idempotent (running twice keeps a single athlete row)', async () => {
    await backfillLocalAthleteScope('user-1')
    await backfillLocalAthleteScope('user-1')
    expect(await fakes.db.athletes.count()).toBe(1)
  })

  it('does not rescan tables after a completed local backfill marker', async () => {
    installLocalStorage()
    const toArraySpy = vi.spyOn(fakes.db.sessions, 'toArray')

    await backfillLocalAthleteScope('user-1')
    toArraySpy.mockClear()
    await backfillLocalAthleteScope('user-1')

    expect(toArraySpy).not.toHaveBeenCalled()
    toArraySpy.mockRestore()
  })

  it('patches legacy rows even when the athlete row already exists', async () => {
    await fakes.db.athletes.put({
      id: 'ath_user-1',
      ownerAccountId: 'user-1',
      linkedAccountId: 'user-1',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })
    await fakes.db.sessions.put({ id: 's-legacy', date: '2026-06-29' })

    await backfillLocalAthleteScope('user-1')

    expect((await fakes.db.sessions.get('s-legacy'))?.athleteId).toBe('ath_user-1')
  })

  it('does not overwrite an already-scoped row', async () => {
    await fakes.db.sessions.put({ id: 's2', date: 'x', athleteId: 'ath_other' })
    await backfillLocalAthleteScope('user-1')
    expect((await fakes.db.sessions.get('s2'))?.athleteId).toBe('ath_other')
  })
})
