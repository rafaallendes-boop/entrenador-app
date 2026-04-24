import { describe, expect, it } from 'vitest'

import type { AthleteProfile } from '../../types'
import {
  athleteProfileRowsEqual,
  athleteProfileToRow,
  classifyAthleteProfileSyncError,
  coalesceAthleteProfileRows,
  compactQueue,
  getOfflineOpEntityId,
  mergeAthleteProfileRows,
  pickCanonicalAthleteProfileRow,
  rowToAthleteProfile,
  scoreEntityData,
  shouldReplaceQueuedOp,
  toAthleteProfileSyncRow,
  type OfflineOp,
} from '../syncUtils'

describe('syncUtils', () => {
  it('classifies schema mismatch errors with a clear message', () => {
    const error = new Error("Could not find the 'data' column of 'athlete_profiles' in the schema cache")
    const result = classifyAthleteProfileSyncError(error)
    expect(result).toContain('Schema mismatch')
  })

  it('classifies RLS and duplicate profile errors distinctly', () => {
    expect(classifyAthleteProfileSyncError(new Error('new row violates row-level security policy'))).toContain('RLS/permission error')
    expect(classifyAthleteProfileSyncError(new Error('duplicate key value violates unique constraint'))).toContain('Duplicate/conflict')
  })

  it('round-trips athlete profile rows while keeping local id canonical', () => {
    const profile: AthleteProfile = {
      id: 'default',
      updatedAt: 123,
      coachMemory: 'Prefiere competencia',
      name: 'Rafa',
      primarySport: 'squash',
    }

    const row = athleteProfileToRow(profile, 'user-1')
    expect(row).toMatchObject({
      id: 'default',
      user_id: 'user-1',
      coach_memory: 'Prefiere competencia',
      updated_at: 123,
    })

    const restored = rowToAthleteProfile(row)
    expect(restored.id).toBe('default')
    expect(restored.name).toBe('Rafa')
    expect(restored.primarySport).toBe('squash')
  })

  it('normalizes remote athlete profile rows and picks the most canonical winner', () => {
    const rows = [
      toAthleteProfileSyncRow({
        id: 'legacy-1',
        user_id: 'user-1',
        coach_memory: 'older',
        updated_at: 100,
        data: { name: 'Rafa' },
      }),
      toAthleteProfileSyncRow({
        id: 'default',
        user_id: 'user-1',
        coach_memory: 'newer',
        updated_at: 100,
        data: { name: 'Rafa', primarySport: 'squash', secondarySports: ['strength'] },
      }),
    ]

    expect(pickCanonicalAthleteProfileRow(rows).id).toBe('default')
  })

  it('coalesces a newer sparse profile with richer existing sport data', () => {
    const rows = [
      toAthleteProfileSyncRow({
        id: 'default',
        user_id: 'user-1',
        coach_memory: null,
        updated_at: 100,
        data: {
          name: 'Rafa',
          primarySport: 'squash',
          sportContext: {
            enabledSports: ['squash', 'strength'],
            primarySport: 'squash',
            secondarySports: ['strength'],
          },
        },
      }),
      toAthleteProfileSyncRow({
        id: 'default',
        user_id: 'user-1',
        coach_memory: 'Prefiere cargas progresivas',
        updated_at: 200,
        data: {
          onboardingDeferredAt: 200,
        },
      }),
    ]

    const merged = coalesceAthleteProfileRows(rows)
    expect(merged.updated_at).toBe(200)
    expect(merged.coach_memory).toBe('Prefiere cargas progresivas')
    expect(merged.data?.name).toBe('Rafa')
    expect((merged.data?.sportContext as { enabledSports?: string[] })?.enabledSports).toEqual(['squash', 'strength'])
    expect(merged.data?.onboardingDeferredAt).toBe(200)
  })

  it('preserves explicit updates when merging athlete profile rows', () => {
    const base = toAthleteProfileSyncRow({
      id: 'default',
      user_id: 'user-1',
      coach_memory: 'Vieja',
      updated_at: 100,
      data: {
        name: 'Rafa',
        sportContext: {
          enabledSports: ['squash'],
          primarySport: 'squash',
        },
      },
    })
    const incoming = toAthleteProfileSyncRow({
      id: 'default',
      user_id: 'user-1',
      coach_memory: null,
      updated_at: 200,
      data: {
        name: undefined,
        sportContext: {
          enabledSports: ['running'],
          primarySport: 'running',
        },
      },
    })

    const merged = mergeAthleteProfileRows(base, incoming)
    expect(merged.coach_memory).toBe('Vieja')
    expect(merged.updated_at).toBe(200)
    expect(merged.data?.name).toBeUndefined()
    expect((merged.data?.sportContext as { primarySport?: string })?.primarySport).toBe('running')
    expect(athleteProfileRowsEqual(merged, incoming)).toBe(false)
  })

  it('keeps tombstones for explicitly cleared athlete profile fields', () => {
    const profile: AthleteProfile = {
      id: 'default',
      updatedAt: 300,
      coachMemory: undefined,
      name: undefined,
      mainGoal: undefined,
    }

    const row = athleteProfileToRow(profile, 'user-1')
    expect(row.coach_memory).toBeNull()
    expect(row.data).toMatchObject({
      __clearCoachMemory: true,
      __deletedFields: expect.arrayContaining(['name', 'mainGoal']),
    })
  })

  it('does not resurrect a deleted field from a richer stale row', () => {
    const rows = [
      toAthleteProfileSyncRow({
        id: 'default',
        user_id: 'user-1',
        coach_memory: 'Prefiere estructura',
        updated_at: 100,
        data: { name: 'Rafa', mainGoal: 'Competir mejor' },
      }),
      toAthleteProfileSyncRow({
        id: 'default',
        user_id: 'user-1',
        coach_memory: null,
        updated_at: 200,
        data: {
          __clearCoachMemory: true,
          __deletedFields: ['name'],
        },
      }),
    ]

    const merged = coalesceAthleteProfileRows(rows)
    expect(merged.coach_memory).toBeNull()
    expect(merged.data?.name).toBeUndefined()
    expect(merged.data?.mainGoal).toBe('Competir mejor')
    expect(merged.data?.__deletedFields).toEqual(['name'])
    expect(merged.data?.__clearCoachMemory).toBe(true)
  })

  it('scores richer entity data higher than sparse data', () => {
    const sparse = scoreEntityData({ name: 'Rafa' })
    const rich = scoreEntityData({ name: 'Rafa', primarySport: 'squash', goalEvents: [{ title: 'Nacional' }] })
    expect(rich).toBeGreaterThan(sparse)
  })

  it('compacts queued ops by entity and lets deletes supersede upserts', () => {
    const existing: OfflineOp = {
      userId: 'user-1',
      table: 'athlete_profiles',
      action: 'upsert',
      payload: { id: 'default', updated_at: 1 },
      enqueuedAt: 1,
    }
    const newerUpsert: OfflineOp = {
      ...existing,
      payload: { id: 'default', updated_at: 2 },
      enqueuedAt: 2,
    }
    const deleteOp: OfflineOp = {
      ...existing,
      action: 'delete',
      payload: { id: 'default' },
      enqueuedAt: 3,
    }

    expect(getOfflineOpEntityId(existing)).toBe('default')
    expect(shouldReplaceQueuedOp(existing, newerUpsert)).toBe(true)
    expect(shouldReplaceQueuedOp(existing, deleteOp)).toBe(true)
    expect(compactQueue([existing, newerUpsert], deleteOp)).toEqual([deleteOp])
  })

  it('delete → upsert → delete sequence: second delete supersedes the upsert', () => {
    const base: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'upsert',
      payload: { id: 'session-1' },
      enqueuedAt: 1,
    }
    const upsert: OfflineOp = { ...base, action: 'upsert', enqueuedAt: 2 }
    const firstDelete: OfflineOp = { ...base, action: 'delete', enqueuedAt: 3 }
    const secondUpsert: OfflineOp = { ...base, action: 'upsert', enqueuedAt: 4 }
    const secondDelete: OfflineOp = { ...base, action: 'delete', enqueuedAt: 5 }

    // After delete → upsert, queue has the re-created upsert
    const afterReCreate = compactQueue(compactQueue([upsert, firstDelete], secondUpsert), secondDelete)
    // Final state must be a single delete, not a ghost upsert
    expect(afterReCreate).toHaveLength(1)
    expect(afterReCreate[0].action).toBe('delete')
  })

  it('does not compact ops for different users', () => {
    const user1Op: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'upsert',
      payload: { id: 'session-1' },
      enqueuedAt: 1,
    }
    const user2Delete: OfflineOp = {
      ...user1Op,
      userId: 'user-2',
      action: 'delete',
      enqueuedAt: 2,
    }
    // user-2 delete should NOT remove user-1 upsert
    const result = compactQueue([user1Op], user2Delete)
    expect(result).toHaveLength(2)
    expect(result.some(op => op.userId === 'user-1' && op.action === 'upsert')).toBe(true)
  })

  it('does not compact ops for different tables', () => {
    const sessionsOp: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'upsert',
      payload: { id: 'item-1' },
      enqueuedAt: 1,
    }
    const profileDelete: OfflineOp = {
      ...sessionsOp,
      table: 'athlete_profiles',
      action: 'delete',
      enqueuedAt: 2,
    }
    const result = compactQueue([sessionsOp], profileDelete)
    expect(result).toHaveLength(2)
  })

  it('does not compact ops for different entity ids', () => {
    const opA: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'upsert',
      payload: { id: 'session-A' },
      enqueuedAt: 1,
    }
    const deleteB: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'delete',
      payload: { id: 'session-B' },
      enqueuedAt: 2,
    }
    const result = compactQueue([opA], deleteB)
    expect(result).toHaveLength(2)
  })

  it('preserves the highest retry count when compacting an entity op', () => {
    const existing: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'upsert',
      payload: { id: 'session-A' },
      enqueuedAt: 1,
      retryCount: 3,
    }
    const incoming: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'upsert',
      payload: { id: 'session-A' },
      enqueuedAt: 2,
    }

    const result = compactQueue([existing], incoming)
    expect(result).toHaveLength(1)
    expect(result[0].retryCount).toBe(3)
  })

  it('picks the profile row with the highest score when repairing duplicates (same updated_at)', () => {
    // When updated_at is equal, data richness + id=default are the tiebreakers
    const sparseRow = toAthleteProfileSyncRow({
      id: 'legacy-1',
      user_id: 'user-1',
      updated_at: 100,
      data: { name: 'Rafa' },
    })
    const richRow = toAthleteProfileSyncRow({
      id: 'default',
      user_id: 'user-1',
      updated_at: 100,
      data: { name: 'Rafa', primarySport: 'squash', secondarySports: ['running', 'strength'], mainGoal: 'Masters' },
    })
    expect(pickCanonicalAthleteProfileRow([sparseRow, richRow]).id).toBe('default')
  })

  it('picks the most recently updated row when updated_at differs', () => {
    const olderRow = toAthleteProfileSyncRow({
      id: 'legacy-1',
      user_id: 'user-1',
      updated_at: 100,
      data: { name: 'Rafa', primarySport: 'squash', mainGoal: 'Masters' },
    })
    const newerRow = toAthleteProfileSyncRow({
      id: 'legacy-2',
      user_id: 'user-1',
      updated_at: 200,
      data: { name: 'Rafa' }, // sparser but newer
    })
    expect(pickCanonicalAthleteProfileRow([olderRow, newerRow]).id).toBe('legacy-2')
  })

  it('getOfflineOpEntityId returns null for ops without an id', () => {
    const op: OfflineOp = {
      userId: 'user-1',
      table: 'sessions',
      action: 'upsert',
      payload: {},
      enqueuedAt: 1,
    }
    expect(getOfflineOpEntityId(op)).toBeNull()
  })
})
