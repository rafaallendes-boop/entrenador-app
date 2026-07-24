import { describe, expect, it } from 'vitest'

import {
  buildRepairContextForTest,
  buildSkeletonSessionForTest,
} from '../../planBuilder/__tests__/helpers/repairTestFixtures'
import { repairGeneratedWeek } from '../../planBuilder/repairWeek'

describe('Week Creator repair stats legacy contract', () => {
  it('keeps the exact all-zero tuple used by the early return', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 1,
      targetLoadBySport: {},
    })
    const { meta } = repairGeneratedWeek([
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ], context)

    expect([
      meta.repairedSessionCount,
      meta.movedSessionCount,
      meta.addedFallbackCount,
      meta.droppedSessionCount,
      meta.filteredSportCount,
    ]).toEqual([0, 0, 0, 0, 0])
  })

  it('keeps the orphan fallback tuple exact while taxonomy stays additive', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 2,
      targetLoadBySport: {},
    })
    const { meta } = repairGeneratedWeek([
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ], context)

    expect([
      meta.repairedSessionCount,
      meta.movedSessionCount,
      meta.addedFallbackCount,
      meta.droppedSessionCount,
      meta.filteredSportCount,
    ]).toEqual([0, 0, 1, 0, 0])
    expect(meta.taxonomy.structuralActionCount).toBe(1)
  })
})
