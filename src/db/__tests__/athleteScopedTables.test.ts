import { describe, expect, it } from 'vitest'
import { getAllAthleteScopedTables, getLegacyAthleteScopeBackfillTables } from '../athleteScopedTables'

describe('athlete-scoped Dexie manifest', () => {
  it('incluye todos los stores sujetos a purge/import/reset exactamente una vez', () => {
    const names = getAllAthleteScopedTables().map((table) => table.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining([
      'sessions',
      'dayLogs',
      'readinessDaily',
      'whoopWorkouts',
      'weekSummaries',
      'trainingPlans',
      'trainingPlanWeeks',
      'planGenerationJobs',
      'athletes',
      'athleteMemberships',
      'chatMessages',
      'coachProposals',
      'athleteProfiles',
      'athleteCoachNotes',
    ]))
  })

  it('deriva desde el mismo módulo el subconjunto del backfill legacy', () => {
    expect(getLegacyAthleteScopeBackfillTables().map((table) => table.name)).toEqual([
      'sessions',
      'dayLogs',
      'weekSummaries',
      'chatMessages',
      'coachProposals',
      'athleteProfiles',
      'trainingPlans',
      'trainingPlanWeeks',
      'planGenerationJobs',
    ])
  })
})
