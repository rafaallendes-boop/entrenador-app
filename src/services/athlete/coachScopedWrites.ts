import { db } from '../../db/db'
import { recalculateWeekSummaryCore } from '../../db/queries'
import type { Session, WeekSummary } from '../../types'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'
import {
  deleteSessionForTarget,
  pushSessionForTarget,
  pushWeekSummaryForAthlete,
  rememberSessionDeleteTombstone,
} from '../syncService'
import { runAthleteWrite } from '../sync/athleteWriteLease'
import {
  captureRemoteSessionTarget,
  type RemoteSessionTarget,
} from '../sync/remoteSessionTarget'
import { isScopedAthleteId } from './effectiveAthleteKey'
import { assertActiveRosterAthlete } from './coachScopedReads'
import {
  applyCoachSessionPatch,
  draftToNewSessionFields,
  type CoachSessionDraft,
  type CoachSessionPatch,
} from './coachSessionSerializer'
import { ensureWeekHydrated, isWeekHydrated } from './coachPlanningHydration'
import { resolveAthleteWeekScope, type AthleteWeekScope } from './athleteWeekScope'

const weekOf = (dateISO: string): string => toISO(getWeekStart(fromISO(dateISO)))
const nextUpdatedAt = (previous: number | undefined): number => (
  Math.max(Date.now(), (previous ?? 0) + 1)
)
const LEASE_VETO_MESSAGE = 'Este atleta está siendo eliminado.'
const RETRY_MESSAGE = 'La sesión cambió mientras la actualizábamos. Volvé a intentarlo.'

class HydrationScopeChangedError extends Error {}

async function revalidateActiveAthleteInTx(
  ownerAccountId: string,
  athleteId: string,
): Promise<void> {
  const row = await db.athletes.get(athleteId)
  if (!row || row.ownerAccountId !== ownerAccountId) {
    throw new Error('El atleta no pertenece a tu roster.')
  }
  if (row.status !== 'active') {
    throw new Error('Este atleta está archivado; restauralo para editar su semana.')
  }
}

async function loadOwnedSession(scope: AthleteWeekScope, sessionId: string): Promise<Session> {
  const row = await db.sessions.get(sessionId)
  const owned = row && (
    row.athleteId === scope.athleteId
    || (scope.includeLegacy && !isScopedAthleteId(row.athleteId))
  )
  if (!owned) throw new Error('La sesión no pertenece a este atleta.')
  return row
}

function pushChangedSummaries(summaries: WeekSummary[]): void {
  for (const summary of summaries) void pushWeekSummaryForAthlete(summary)
}

export async function createSessionForAthlete(
  ownerAccountId: string,
  athleteId: string,
  values: CoachSessionDraft,
): Promise<Session> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
  const now = Date.now()
  const session: Session = {
    ...draftToNewSessionFields(values),
    id: uuid(),
    athleteId,
    authoredByRole: scope.includeLegacy ? 'self' : 'coach',
    createdAt: now,
    updatedAt: now,
  }
  const week = weekOf(values.date)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensureWeekHydrated(ownerAccountId, scope, week)
    const state: { summaries: WeekSummary[] } = { summaries: [] }
    try {
      const wrote = await runAthleteWrite(athleteId, async () => {
        await db.transaction(
          'rw',
          db.sessions,
          db.dayLogs,
          db.weekSummaries,
          db.athletes,
          async () => {
            await revalidateActiveAthleteInTx(ownerAccountId, athleteId)
            if (!isWeekHydrated(ownerAccountId, athleteId, week)) {
              throw new HydrationScopeChangedError()
            }
            await db.sessions.add(session)
            const result = await recalculateWeekSummaryCore(scope, session.date)
            state.summaries = result.changed ? [result.summary] : []
          },
        )
      })
      if (!wrote) throw new Error(LEASE_VETO_MESSAGE)

      void pushSessionForTarget(
        session,
        captureRemoteSessionTarget(session, ownerAccountId, scope.athleteId),
      )
      pushChangedSummaries(state.summaries)
      return session
    } catch (error) {
      if (!(error instanceof HydrationScopeChangedError)) throw error
      if (attempt === 2) {
        throw new Error('La semana cambió mientras guardábamos. Actualizá e intentá de nuevo.')
      }
    }
  }
  throw new Error('La semana cambió mientras guardábamos. Actualizá e intentá de nuevo.')
}

export async function updateSessionForAthlete(
  ownerAccountId: string,
  athleteId: string,
  sessionId: string,
  patch: CoachSessionPatch,
): Promise<Session> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let existing = await loadOwnedSession(scope, sessionId)
    let originalWeek = weekOf(existing.date)
    await ensureWeekHydrated(ownerAccountId, scope, originalWeek)

    existing = await loadOwnedSession(scope, sessionId)
    const refreshedOriginalWeek = weekOf(existing.date)
    if (refreshedOriginalWeek !== originalWeek) {
      originalWeek = refreshedOriginalWeek
      await ensureWeekHydrated(ownerAccountId, scope, originalWeek)
      existing = await loadOwnedSession(scope, sessionId)
      if (weekOf(existing.date) !== originalWeek) continue
    }
    const targetWeek = weekOf(patch.date ?? existing.date)
    if (targetWeek !== originalWeek) {
      await ensureWeekHydrated(ownerAccountId, scope, targetWeek)
    }

    const state: {
      updated: Session | null
      target: RemoteSessionTarget | null
      summaries: WeekSummary[]
    } = { updated: null, target: null, summaries: [] }
    try {
      const wrote = await runAthleteWrite(athleteId, async () => {
        await db.transaction(
          'rw',
          db.sessions,
          db.dayLogs,
          db.weekSummaries,
          db.athletes,
          async () => {
            await revalidateActiveAthleteInTx(ownerAccountId, athleteId)
            const current = await loadOwnedSession(scope, sessionId)
            const currentOriginalWeek = weekOf(current.date)
            const currentTargetWeek = weekOf(patch.date ?? current.date)
            if (
              currentOriginalWeek !== originalWeek
              || currentTargetWeek !== targetWeek
              || !isWeekHydrated(ownerAccountId, athleteId, currentOriginalWeek)
              || !isWeekHydrated(ownerAccountId, athleteId, currentTargetWeek)
            ) {
              throw new HydrationScopeChangedError()
            }

            state.target = captureRemoteSessionTarget(current, ownerAccountId, scope.athleteId)
            const dateChanged = patch.date !== undefined && patch.date !== current.date
            const next = {
              ...applyCoachSessionPatch(current, patch),
              weekStartDate: dateChanged ? weekOf(patch.date!) : current.weekStartDate,
              updatedAt: nextUpdatedAt(current.updatedAt),
            }
            await db.sessions.put(next)
            state.updated = next

            const results = [await recalculateWeekSummaryCore(scope, current.date)]
            if (dateChanged && currentTargetWeek !== currentOriginalWeek) {
              results.push(await recalculateWeekSummaryCore(scope, patch.date!))
            }
            state.summaries = results
              .filter((result) => result.changed)
              .map((result) => result.summary)
          },
        )
      })
      if (!wrote) throw new Error(LEASE_VETO_MESSAGE)
      if (!state.updated || !state.target) throw new Error('No se pudo actualizar la sesión.')

      void pushSessionForTarget(state.updated, state.target)
      pushChangedSummaries(state.summaries)
      return state.updated
    } catch (error) {
      if (!(error instanceof HydrationScopeChangedError)) throw error
      if (attempt === 2) throw new Error(RETRY_MESSAGE)
    }
  }
  throw new Error(RETRY_MESSAGE)
}

export async function deleteSessionForAthlete(
  ownerAccountId: string,
  athleteId: string,
  sessionId: string,
): Promise<void> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let existing = await loadOwnedSession(scope, sessionId)
    let originalWeek = weekOf(existing.date)
    await ensureWeekHydrated(ownerAccountId, scope, originalWeek)
    existing = await loadOwnedSession(scope, sessionId)
    const refreshedWeek = weekOf(existing.date)
    if (refreshedWeek !== originalWeek) {
      originalWeek = refreshedWeek
      await ensureWeekHydrated(ownerAccountId, scope, originalWeek)
      existing = await loadOwnedSession(scope, sessionId)
      if (weekOf(existing.date) !== originalWeek) continue
    }

    const state: {
      target: RemoteSessionTarget | null
      summaries: WeekSummary[]
    } = { target: null, summaries: [] }
    try {
      const wrote = await runAthleteWrite(athleteId, async () => {
        await db.transaction(
          'rw',
          db.sessions,
          db.dayLogs,
          db.weekSummaries,
          db.athletes,
          async () => {
            await revalidateActiveAthleteInTx(ownerAccountId, athleteId)
            const current = await loadOwnedSession(scope, sessionId)
            const currentWeek = weekOf(current.date)
            if (
              currentWeek !== originalWeek
              || !isWeekHydrated(ownerAccountId, athleteId, currentWeek)
            ) {
              throw new HydrationScopeChangedError()
            }
            state.target = captureRemoteSessionTarget(current, ownerAccountId, scope.athleteId)
            await db.sessions.delete(sessionId)
            const result = await recalculateWeekSummaryCore(scope, current.date)
            state.summaries = result.changed ? [result.summary] : []
          },
        )
      })
      if (!wrote) throw new Error(LEASE_VETO_MESSAGE)
      if (!state.target) throw new Error('No se pudo eliminar la sesión.')

      rememberSessionDeleteTombstone(ownerAccountId, sessionId)
      void deleteSessionForTarget(sessionId, state.target)
      pushChangedSummaries(state.summaries)
      return
    } catch (error) {
      if (!(error instanceof HydrationScopeChangedError)) throw error
      if (attempt === 2) throw new Error(RETRY_MESSAGE)
    }
  }
  throw new Error(RETRY_MESSAGE)
}
