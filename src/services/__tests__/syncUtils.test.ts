import { describe, expect, it } from 'vitest'

import type { AthleteProfile } from '../../types'
import {
  athleteProfileToRow,
  classifyAthleteProfileSyncError,
  compactQueue,
  getOfflineOpEntityId,
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
    expect(classifyAthleteProfileSyncError(error)).toContain('Schema remoto de athlete_profiles incompatible')
  })

  it('classifies RLS and duplicate profile errors distinctly', () => {
    expect(classifyAthleteProfileSyncError(new Error('new row violates row-level security policy'))).toContain('RLS/permisos')
    expect(classifyAthleteProfileSyncError(new Error('duplicate key value violates unique constraint'))).toContain('duplicado')
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
})
