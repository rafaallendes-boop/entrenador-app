import { db } from './db'

/**
 * Manifiesto único de stores Dexie cuyo ciclo de vida pertenece a un atleta.
 * Las agrupaciones también alimentan mantenimiento/import y evitan que una
 * tabla nueva quede fuera de un purge o replace.
 */
export function getAthleteScopedTableGroups() {
  return {
    trainingData: [
      db.sessions,
      db.dayLogs,
      db.readinessDaily,
      db.whoopWorkouts,
      db.weekSummaries,
      db.trainingPlans,
      db.trainingPlanWeeks,
      db.planGenerationJobs,
      db.athletes,
      db.athleteMemberships,
    ],
    chatHistory: [db.chatMessages],
    coachProposals: [db.coachProposals],
    coachMemory: [db.athleteProfiles, db.athleteCoachNotes],
  }
}

export function getAllAthleteScopedTables() {
  const groups = getAthleteScopedTableGroups()
  return [
    ...groups.trainingData,
    ...groups.chatHistory,
    ...groups.coachProposals,
    ...groups.coachMemory,
  ]
}

/**
 * Stores whose lifecycle belongs to the signed-in account rather than to one
 * athlete. They must not participate in an athlete purge.
 */
export function getAccountScopedTables() {
  return [db.sessionTemplates]
}

/** Complete manifest used by account switches, full resets and replace imports. */
export function getAllLocalTables() {
  return [
    ...getAllAthleteScopedTables(),
    ...getAccountScopedTables(),
  ]
}

/** Stores históricos que participan en el backfill de athleteId. */
export function getLegacyAthleteScopeBackfillTables() {
  return [
    db.sessions,
    db.dayLogs,
    db.weekSummaries,
    db.chatMessages,
    db.coachProposals,
    db.athleteProfiles,
    db.trainingPlans,
    db.trainingPlanWeeks,
    db.planGenerationJobs,
  ]
}

/** Debe ejecutarse dentro de una transacción sobre getAllAthleteScopedTables. */
export async function purgeAthleteScopedRows(athleteId: string): Promise<void> {
  await db.sessions.where('athleteId').equals(athleteId).delete()
  await db.dayLogs.where('athleteId').equals(athleteId).delete()
  await db.weekSummaries.where('athleteId').equals(athleteId).delete()
  await db.chatMessages.where('athleteId').equals(athleteId).delete()
  await db.coachProposals.where('athleteId').equals(athleteId).delete()
  await db.athleteProfiles.where('athleteId').equals(athleteId).delete()
  await db.trainingPlans.where('athleteId').equals(athleteId).delete()
  await db.trainingPlanWeeks.where('athleteId').equals(athleteId).delete()
  await db.planGenerationJobs.where('athleteId').equals(athleteId).delete()
  await db.readinessDaily.where('athleteId').equals(athleteId).delete()
  await db.whoopWorkouts.where('athleteId').equals(athleteId).delete()
  await db.athleteMemberships.where('athleteId').equals(athleteId).delete()
  await db.athleteCoachNotes.delete(athleteId)
  await db.athletes.delete(athleteId)
}
