import { addDays } from 'date-fns'
import { db } from '../../db/db'
import { getWeekSummary, recalculateWeekSummary, upsertWeekSummary } from '../../db/queries'
import { filterCoachSessionsToAllowedSports } from '../planningConstraints'
import { ensureSessionProtocols } from '../trainingProtocols'
import { enhanceStrengthSessionExercises } from '../training/strengthSessionStructure'
import * as syncService from '../syncService'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'
import type { AthleteProfile, CoachAction, Session, WeekSummary } from '../../types'

type CreateWeekSessionInput = NonNullable<CoachAction['sessions']>

interface CreateWeekStoreAdapter {
  addSession: (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Session>
  loadWeek: (weekStart: string) => Promise<void>
}

export interface ApplyCreateWeekResult {
  warnings: string[]
  createdSessionIds: string[]
  restoredSessions: Session[]
  restoredWeekSummaries: WeekSummary[]
  deletedWeekSummaryIds: string[]
}

export async function applyCreateWeek({
  sessions,
  weekObjectives,
  athleteProfile,
  store,
  replacementCutoffAt,
}: {
  sessions: CreateWeekSessionInput
  weekObjectives?: string[]
  athleteProfile: AthleteProfile | null
  store: CreateWeekStoreAdapter
  replacementCutoffAt?: number
}): Promise<ApplyCreateWeekResult> {
  const warnings: string[] = []
  const createdSessionIds: string[] = []
  const restoredSessions: Session[] = []
  const restoredWeekSummaries: WeekSummary[] = []
  const deletedWeekSummaryIds: string[] = []

  const allowedSessions = filterCoachSessionsToAllowedSports(sessions, athleteProfile)
  if (allowedSessions.length !== sessions.length) {
    warnings.push('Se filtraron sesiones de deportes no permitidos antes de guardar la semana.')
  }
  if (allowedSessions.length === 0) {
    warnings.push('No se guardo ninguna sesion porque todas pertenecian a deportes no permitidos para esta planificacion.')
    return { warnings, createdSessionIds, restoredSessions, restoredWeekSummaries, deletedWeekSummaryIds }
  }

  const replacement = await replacePlannedSessionsForCreateWeek(allowedSessions, replacementCutoffAt)
  restoredSessions.push(...replacement.replacedSessions)
  warnings.push(...replacement.warnings)

  const collisions = await findCreateWeekCollisions(allowedSessions)
  if (collisions.length > 0) {
    warnings.push(`Se mantuvieron sesiones ya realizadas o ajustadas en: ${collisions.map((item) => `${item.date} ${item.timeBlock}`).join(', ')}`)
  }
  const collisionSet = new Set(collisions.map((collision) => `${collision.date}|${collision.timeBlock}`))

  for (const session of allowedSessions) {
    if (collisionSet.has(`${session.date}|${session.timeBlock}`)) continue

    const created = await store.addSession(ensureSessionProtocols({
      date: session.date,
      timeBlock: session.timeBlock,
      source: 'coach',
      type: session.sessionType,
      subtype: session.subtype,
      title: session.title,
      durationMin: session.durationMin,
      rpe: session.rpe,
      objective: session.objective,
      status: 'planned',
      exercises: (
        session.sessionType === 'strength'
          ? enhanceStrengthSessionExercises(session.exercises, {
              durationMin: session.durationMin,
              strengthProfile: athleteProfile?.strengthProfile,
            })
          : session.exercises
      )?.map((exercise) => ({ ...exercise, id: uuid(), completed: false })),
      runningDetails: session.runningType
        ? {
            runningType: session.runningType,
            targetPaceMin: session.targetPaceMin,
            targetPaceMax: session.targetPaceMax,
            targetHrMin: session.targetHrMin,
            targetHrMax: session.targetHrMax,
            intervalStructure: session.intervalStructure,
          }
        : undefined,
      cyclingDetails: session.sessionType === 'cycling' ? session.cyclingDetails : undefined,
      mobilityDetails: session.sessionType === 'mobility' ? session.mobilityDetails : undefined,
      squashDetails: session.squashDetails,
      warmup: session.warmup,
      cooldown: session.cooldown,
      metadata: session.metadata,
    }))
    createdSessionIds.push(created.id)
  }

  const affectedWeekStarts = [...new Set(allowedSessions.map((session) => toISO(getWeekStart(fromISO(session.date)))))]
  for (const weekStart of affectedWeekStarts) {
    await recalculateWeekSummary(weekStart)
  }

  if (weekObjectives && weekObjectives.length > 0) {
    const weekStart = toISO(getWeekStart(fromISO(allowedSessions[0].date)))
    const previousSummary = await getWeekSummary(weekStart)
    if (previousSummary) {
      restoredWeekSummaries.push({ ...previousSummary })
    } else {
      const created = await upsertWeekSummary(weekStart, { objectives: weekObjectives })
      deletedWeekSummaryIds.push(created.id)
      await store.loadWeek(weekStart)
      return { warnings, createdSessionIds, restoredSessions, restoredWeekSummaries, deletedWeekSummaryIds }
    }
    await upsertWeekSummary(weekStart, { objectives: weekObjectives })
    await store.loadWeek(weekStart)
  }

  return { warnings, createdSessionIds, restoredSessions, restoredWeekSummaries, deletedWeekSummaryIds }
}

async function findCreateWeekCollisions(
  sessions: CreateWeekSessionInput,
): Promise<Array<{ date: string; timeBlock: string }>> {
  const targetDates = [...new Set(sessions.map((session) => session.date))]
  const existingSessions = await db.sessions.where('date').anyOf(targetDates).toArray()

  return sessions
    .filter((session) =>
      existingSessions.some((existing) => (
        existing.date === session.date
        && existing.timeBlock === session.timeBlock
        && existing.status !== 'planned'
      )),
    )
    .map((session) => ({ date: session.date, timeBlock: session.timeBlock }))
}

async function replacePlannedSessionsForCreateWeek(
  sessions: CreateWeekSessionInput,
  replacementCutoffAt?: number,
): Promise<{ replacedSessions: Session[]; warnings: string[] }> {
  const warnings: string[] = []
  const weekStarts = [...new Set(sessions.map((session) => toISO(getWeekStart(fromISO(session.date)))))]
  const replacementDates = new Set(sessions.map((session) => session.date))
  const replacedSessions: Session[] = []

  for (const weekStart of weekStarts) {
    const weekEnd = toISO(addDays(fromISO(weekStart), 6))
    await syncService.pullSessionsForDateRange(weekStart, weekEnd)
    const existingWeekSessions = await db.sessions.where('date').between(weekStart, weekEnd, true, true).toArray()
    const plannedSessions = existingWeekSessions.filter(
      (session) => session.status === 'planned' && replacementDates.has(session.date),
    )
    const preservedSessions = existingWeekSessions.filter((session) => session.status !== 'planned')

    if (plannedSessions.length > 0) {
      const concurrentSession = replacementCutoffAt != null
        ? plannedSessions.find((session) => session.updatedAt > replacementCutoffAt)
        : undefined
      if (concurrentSession) {
        throw new Error(`La semana tiene cambios sincronizados mas recientes en ${concurrentSession.date}. Actualiza el plan antes de aceptar esta propuesta.`)
      }

      replacedSessions.push(...plannedSessions.map((session) => ({ ...session })))
      await db.sessions.bulkDelete(plannedSessions.map((session) => session.id))
      plannedSessions.forEach((session) => {
        void syncService.deleteSession(session.id)
      })
      warnings.push(`Se reemplazo la planificacion previa de ${weekStart} (${plannedSessions.length} sesiones planificadas).`)
    }

    const preservedOnReplacementDates = preservedSessions.filter((session) => replacementDates.has(session.date))
    if (preservedOnReplacementDates.length > 0) {
      warnings.push(`Se conservaron ${preservedOnReplacementDates.length} sesiones con historial en la misma semana para no borrar adherencia ya registrada.`)
    }
  }

  return { replacedSessions, warnings }
}
