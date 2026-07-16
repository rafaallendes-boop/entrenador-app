import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pages: [] as Array<Array<Record<string, unknown>>>,
  rangeCalls: [] as Array<[number, number]>,
  tombstonedAthletes: new Set<string>(),
  snapshotCalls: 0,
}))

function queryBuilder() {
  return {
    eq: vi.fn(function () { return this }),
    in: vi.fn(function () { return this }),
    or: vi.fn(function () { return this }),
    range: vi.fn(async (from: number, to: number) => {
      mocks.rangeCalls.push([from, to])
      return { data: mocks.pages.shift() ?? [], error: null }
    }),
  }
}

vi.mock('../../auth', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => queryBuilder()),
    })),
  },
}))

vi.mock('../../athlete/membershipCache', () => ({
  getMembershipAthleteIds: vi.fn(async () => ['ath-alive', 'ath-deleting']),
}))

vi.mock('../../athlete/readScope', () => ({
  resolveReadScope: vi.fn(() => ({ mode: 'legacy' })),
}))

vi.mock('../athleteDeleteTombstones', () => ({
  getAthleteDeleteTombstoneSnapshot: vi.fn(() => {
    mocks.snapshotCalls += 1
    return {
      has: (_userId: string, athleteId: string) => mocks.tombstonedAthletes.has(athleteId),
      hasAthlete: (athleteId: string) => mocks.tombstonedAthletes.has(athleteId),
      hasAny: () => mocks.tombstonedAthletes.size > 0,
    }
  }),
}))

import { FETCH_PAGE_SIZE, fetchAll } from '../syncSupabase'

describe('fetchAll tombstone filtering and pagination', () => {
  beforeEach(() => {
    mocks.pages = []
    mocks.rangeCalls = []
    mocks.tombstonedAthletes.clear()
    mocks.snapshotCalls = 0
  })

  it('pagina por el tamaño remoto sin filtrar aunque la primera página quede casi vacía', async () => {
    mocks.tombstonedAthletes.add('ath-deleting')
    mocks.pages = [
      Array.from({ length: FETCH_PAGE_SIZE }, (_, index) => ({
        id: `page-1-${index}`,
        athlete_id: index === FETCH_PAGE_SIZE - 1 ? 'ath-alive' : 'ath-deleting',
      })),
      [{ id: 'page-2-alive', athlete_id: 'ath-alive' }],
    ]

    const rows = await fetchAll<Array<Record<string, unknown>>[number]>('sessions', 'user-1')

    expect(mocks.rangeCalls).toEqual([
      [0, FETCH_PAGE_SIZE - 1],
      [FETCH_PAGE_SIZE, (FETCH_PAGE_SIZE * 2) - 1],
    ])
    expect(rows.map((row) => row.id)).toEqual([
      `page-1-${FETCH_PAGE_SIZE - 1}`,
      'page-2-alive',
    ])
    expect(mocks.snapshotCalls).toBe(2)
  })
})
