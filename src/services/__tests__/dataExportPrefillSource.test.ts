import { describe, expect, it } from 'vitest'

import { parseAppDataExport } from '../dataExport'

function backupWithDayLog(dayLog: Record<string, unknown>) {
  return {
    app: 'Entrenador',
    version: 3,
    exportedAt: '2026-07-08T12:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [],
      dayLogs: [dayLog],
      weekSummaries: [],
      trainingPlans: [],
      trainingPlanWeeks: [],
      chatMessages: [],
      coachProposals: [],
      athleteProfiles: [],
    },
  }
}

describe('dataExport prefillSource', () => {
  it('preserves prefillSource.rpeActual (Esfuerzo) through import', () => {
    const parsed = parseAppDataExport(backupWithDayLog({
      id: 'day-1',
      date: '2026-07-08',
      rpeActual: 7,
      prefillSource: { rpeActual: 'whoop', energyLevel: 'whoop' },
      updatedAt: 1,
    }))

    expect(parsed.tables.dayLogs[0].prefillSource).toEqual({ rpeActual: 'whoop', energyLevel: 'whoop' })
  })
})
