import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []

vi.mock('../../services/readiness/whoopApi', () => ({
  getWhoopStatus: vi.fn(async () => ({
    connected: true,
    lastSyncAt: null,
    lastSyncStatus: null,
    scopes: [],
  })),
  syncWhoopNow: vi.fn(async () => {
    calls.push('sync')
    return { ok: true }
  }),
}))
vi.mock('../../services/readiness/pullReadiness', () => ({
  pullReadiness: vi.fn(async () => { calls.push('pullReadiness') }),
}))
vi.mock('../../services/readiness/pullWorkouts', () => ({
  pullWorkouts: vi.fn(async () => { calls.push('pullWorkouts') }),
}))
vi.mock('../../services/readiness/autoCompleteFromWorkouts', () => ({
  autoCompleteFromWorkouts: vi.fn(async () => { calls.push('autoComplete') }),
}))

import { pullWorkouts } from '../../services/readiness/pullWorkouts'
import { syncWhoopAndRefreshLocalData } from '../useWhoopSync'

describe('useWhoopSync', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('pulls workouts and auto-completes after a successful manual sync', async () => {
    await syncWhoopAndRefreshLocalData()
    expect(calls).toEqual(['sync', 'pullReadiness', 'pullWorkouts', 'autoComplete'])
  })

  it('does not run the matcher when the workout pull fails', async () => {
    vi.mocked(pullWorkouts).mockRejectedValueOnce(new Error('network down'))
    await syncWhoopAndRefreshLocalData()
    expect(calls).toEqual(['sync', 'pullReadiness'])
  })
})
