import {
  pullWeekDayLogsForAthlete,
  pullWeekSessionsForAthlete,
  pullWeekSummaryRowForAthlete,
} from '../syncService'
import { hasAthleteDeleteTombstoneForAthlete } from '../sync/athleteDeleteTombstones'
import type { AthleteWeekScope } from './athleteWeekScope'
import { assertActiveRosterAthlete, weekEndISO } from './coachScopedReads'
import {
  beginHydration,
  completeHydration,
  failHydration,
  finishHydration,
  getHydrationInFlight,
  hasHydrationMark,
  setHydrationInFlight,
} from './coachPlanningHydrationRegistry'

export {
  clearCoachPlanningHydrationRegistry,
  isWeekHydrated,
} from './coachPlanningHydrationRegistry'

export async function ensureWeekHydrated(
  ownerAccountId: string,
  scope: AthleteWeekScope,
  weekStartDate: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const athleteId = scope.athleteId
  if (hasAthleteDeleteTombstoneForAthlete(athleteId)) {
    throw new Error('Este atleta está siendo eliminado.')
  }
  if (!options.force && hasHydrationMark(ownerAccountId, athleteId, weekStartDate)) return
  const current = getHydrationInFlight(ownerAccountId, athleteId, weekStartDate)
  if (!options.force && current) return current

  const ticket = beginHydration(ownerAccountId, athleteId, weekStartDate)
  const pullOptions = { includeLegacy: scope.includeLegacy }
  const weekEndDate = weekEndISO(weekStartDate)
  const operation = (async () => {
    try {
      // Debe ser el primer await del IIFE: la promesa se registra como in-flight
      // antes de que otra llamada pueda iniciar una segunda hidratación.
      await assertActiveRosterAthlete(ownerAccountId, athleteId)
      const outcomes = [
        await pullWeekSessionsForAthlete(
          ownerAccountId,
          athleteId,
          weekStartDate,
          weekEndDate,
          pullOptions,
        ),
        await pullWeekDayLogsForAthlete(
          ownerAccountId,
          athleteId,
          weekStartDate,
          weekEndDate,
          pullOptions,
        ),
        await pullWeekSummaryRowForAthlete(
          ownerAccountId,
          athleteId,
          weekStartDate,
          pullOptions,
        ),
      ]
      if (outcomes.some((outcome) => outcome !== 'completed')) {
        throw new Error('No se pudo hidratar la semana completa. Actualizá e intentá de nuevo.')
      }
    } catch (error) {
      failHydration(ticket)
      throw error
    }
    completeHydration(ticket)
  })()

  setHydrationInFlight(ticket, operation)
  try {
    await operation
  } finally {
    finishHydration(ticket, operation)
  }
}
