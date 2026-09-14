import { describe, expect, it } from 'vitest'
import { parseAppDataExport } from '../dataExport'

function backup(strengthProfile: unknown) {
  return {
    app: 'RallyIQ', version: 3, exportedAt: '2026-09-13T12:00:00.000Z', exportedFromAppVersion: 'test',
    tables: {
      sessions: [], dayLogs: [], weekSummaries: [], trainingPlans: [], trainingPlanWeeks: [],
      chatMessages: [], coachProposals: [], athletes: [],
      athleteProfiles: [{ id: 'ath_1', athleteId: 'ath_1', updatedAt: 1, strengthProfile }],
    },
  }
}

describe('strengthProfile.experienceLevel en backup', () => {
  it('conserva un nivel declarado válido', () => {
    const parsed = parseAppDataExport(backup({ squat1RM: 120, experienceLevel: 'advanced' }))
    expect(parsed.tables.athleteProfiles[0].strengthProfile).toMatchObject({ squat1RM: 120, experienceLevel: 'advanced' })
  })

  it('rechaza un nivel desconocido en vez de adoptarlo', () => {
    expect(() => parseAppDataExport(backup({ experienceLevel: 'elite' }))).toThrow()
  })
})
