import { describe, expect, it } from 'vitest'

import type { DayLog, WeekSummary } from '../../types'
import {
  compareDayLogsForRepair,
  compareWeekSummariesForRepair,
  groupRowsBy,
  isInfrastructureError,
  resolveDayLogConflict,
  resolveSyncFailureStatus,
  resolveWeekSummaryConflict,
} from '../syncService.helpers'

function makeDayLog(partial: Partial<DayLog> = {}): DayLog {
  return {
    id: partial.id ?? 'day-1',
    date: partial.date ?? '2026-04-08',
    energyLevel: partial.energyLevel ?? 6,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

function makeWeekSummary(partial: Partial<WeekSummary> & { updatedAt?: number } = {}): WeekSummary {
  return {
    id: partial.id ?? 'week-1',
    weekStartDate: partial.weekStartDate ?? '2026-04-06',
    totalSessions: partial.totalSessions ?? 4,
    totalMinutes: partial.totalMinutes ?? 240,
    plannedSessions: partial.plannedSessions ?? 4,
    completedSessions: partial.completedSessions ?? 3,
    plannedMinutes: partial.plannedMinutes ?? 240,
    completedMinutes: partial.completedMinutes ?? 180,
    adherencePct: partial.adherencePct ?? 75,
    squashSessions: partial.squashSessions ?? 0,
    runningSessions: partial.runningSessions ?? 2,
    strengthSessions: partial.strengthSessions ?? 1,
    ...(partial.updatedAt != null ? { updatedAt: partial.updatedAt } : {}),
    ...partial,
  }
}

describe('syncService.helpers', () => {
  it('classifies infrastructure errors as idle sync failures', () => {
    const error = { code: '42P01', message: 'relation does not exist' }

    expect(isInfrastructureError(error)).toBe(true)
    expect(resolveSyncFailureStatus(error, true)).toBe('idle')
  })

  it('classifies offline-like errors as offline when online state is false', () => {
    expect(resolveSyncFailureStatus(new Error('Failed to fetch'), false)).toBe('offline')
  })

  it('prefers the richer day log when timestamps tie', () => {
    const local = makeDayLog({ id: 'local', updatedAt: 10 })
    const remote = makeDayLog({ id: 'remote', updatedAt: 10, sleepQuality: 4, rpeActual: 6 })

    expect(resolveDayLogConflict(local, remote).winner.id).toBe('remote')
    expect(compareDayLogsForRepair(local, remote)).toBeGreaterThan(0)
  })

  it('prefers the newer week summary and groups duplicates by key', () => {
    const local = makeWeekSummary({ id: 'local', updatedAt: 10 })
    const remote = makeWeekSummary({ id: 'remote', updatedAt: 12 })
    const grouped = groupRowsBy([local, remote], (row) => row.weekStartDate)

    expect(resolveWeekSummaryConflict(local, remote, 12).winner.id).toBe('remote')
    expect(compareWeekSummariesForRepair(local, remote)).toBeGreaterThan(0)
    expect(grouped.get('2026-04-06')).toHaveLength(2)
  })
})
