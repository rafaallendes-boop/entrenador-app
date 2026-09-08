import { finalizeSessionDose } from '../training/sessionDoseFinalizer'
import { addDays } from 'date-fns'
import { db } from '../../db/db'
import { getWeekSummary, recalculateWeekSummary, upsertWeekSummary } from '../../db/queries'
import { filterCoachSessionsToAllowedSports } from '../planningConstraints'
import { ensureSessionProtocols } from '../trainingProtocols'
import { prepareStrengthSession } from '../training/strengthSafetyFinalizer'
import { mergeStrengthConstraints } from '../training/strengthSafetyConstraints'
import {
  buildStrengthSafetyContext,
  resolveProfileStrengthSafetyConstraints,
} from '../training/strengthSafetySurface'
import * as syncService from '../syncService'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'
import type { AthleteProfile, CoachAction, Session, WeekSummary } from '../../types'
import {
  formatCreateWeekCollisionWarning,
  formatCreateWeekPreservedCountWarning,
} from './createWeekCollisionCopy'
import { BLOCKED_STRENGTH_COPY } from '../training/strengthSafetyCopy'

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
  replacementRange,
  planProvenance,
  preserveManualSessions = false,
}: {
  sessions: CreateWeekSessionInput
  weekObjectives?: string[]
  athleteProfile: AthleteProfile | null
  store: CreateWeekStoreAdapter
  replacementCutoffAt?: number
  replacementRange?: { startDate: string; endDate: string }
  planProvenance?: { planId: string; planWeekId: string }
  preserveManualSessions?: boolean
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

  // Fase 1: verificar todas las sesiones sin efectos. El reemplazo destructivo
  // de la semana anterior sólo puede empezar después de este loop.
  const profileConstraints = resolveProfileStrengthSafetyConstraints(athleteProfile)
  const verifiedSessions: CreateWeekSessionInput = []
  let repairedForSafety = false
  for (const session of allowedSessions) {
    if (session.sessionType !== 'strength') {
      const dose = finalizeSessionDose(session, athleteProfile)
      if (!dose.ok) throw new Error(dose.message)
      verifiedSessions.push(dose.session)
      continue
    }
    const messageConstraints = session.metadata?.strengthSafetyFinalization?.userMessageConstraints ?? []
    const constraints = mergeStrengthConstraints(profileConstraints, messageConstraints)
    const result = prepareStrengthSession(session, {
      constraints,
      userMessageConstraints: messageConstraints,
      userMessage: '',
      selectionContext: buildStrengthSafetyContext(
        athleteProfile,
        session.durationMin,
        session.objective,
        constraints,
      ),
      structureOptions: {
        durationMin: session.durationMin,
        strengthProfile: athleteProfile?.strengthProfile,
      },
      supersetMode: 'off',
      sealLocation: 'metadata',
    })
    if (result.status === 'blocked') {
      throw new Error(BLOCKED_STRENGTH_COPY)
    }
    repairedForSafety ||= result.removed.length > 0 || result.replaced.length > 0
    verifiedSessions.push(result.session)
  }
  if (repairedForSafety) {
    warnings.push('Se excluyeron o reemplazaron ejercicios por tu restricción.')
  }

  const replacement = await replacePlannedSessionsForCreateWeek(
    verifiedSessions,
    replacementCutoffAt,
    replacementRange,
    preserveManualSessions,
  )
  restoredSessions.push(...replacement.replacedSessions)
  warnings.push(...replacement.warnings)

  const collisions = await findCreateWeekCollisions(verifiedSessions, preserveManualSessions)
  if (collisions.length > 0) {
    warnings.push(formatCreateWeekCollisionWarning(collisions, preserveManualSessions))
  }
  const collisionSet = new Set(collisions.map((collision) => `${collision.date}|${collision.timeBlock}`))

  for (const session of verifiedSessions) {
    if (collisionSet.has(`${session.date}|${session.timeBlock}`)) continue

    const created = await store.addSession(ensureSessionProtocols({
      date: session.date,
      timeBlock: session.timeBlock,
      source: 'coach',
      ...planProvenance,
      type: session.sessionType,
      subtype: session.subtype,
      title: session.title,
      durationMin: session.durationMin,
      rpe: session.rpe,
      objective: session.objective,
      status: 'planned',
      exercises: session.exercises?.map((exercise) => ({ ...exercise, id: uuid(), completed: false })),
      runningDetails: session.runningType
        ? {
            runningType: session.runningType,
            targetPaceMin: session.targetPaceMin,
            targetPaceMax: session.targetPaceMax,
            targetHrMin: session.targetHrMin,
            targetHrMax: session.targetHrMax,
            intervalStructure: session.intervalStructure,
              templateRef: session.runningTemplateRef, selectionReason: session.runningSelectionReason,
          }
        : undefined,
      cyclingDetails: session.sessionType === 'cycling' ? session.cyclingDetails : undefined,
      // `recovery` también puede llevar estructura de movilidad, igual que en
      // la ruta de `add_session`. Aceptar sólo `mobility` hacía que la misma
      // sesión mostrara contenido suelta y nada dentro de una semana.
      mobilityDetails: session.sessionType === 'mobility' || session.sessionType === 'recovery'
        ? session.mobilityDetails
        : undefined,
      squashDetails: session.squashDetails,
      warmup: session.warmup,
      cooldown: session.cooldown,
      metadata: session.metadata,
    }))
    createdSessionIds.push(created.id)
  }

  const affectedWeekStarts = [...new Set(verifiedSessions.map((session) => toISO(getWeekStart(fromISO(session.date)))))]
  for (const weekStart of affectedWeekStarts) {
    await recalculateWeekSummary(weekStart)
  }

  if (weekObjectives && weekObjectives.length > 0) {
    const weekStart = toISO(getWeekStart(fromISO(verifiedSessions[0].date)))
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
  preserveManualSessions: boolean,
): Promise<Array<{ date: string; timeBlock: string }>> {
  const targetDates = [...new Set(sessions.map((session) => session.date))]
  const existingSessions = filterRowsToActiveScope(
    await db.sessions.where('date').anyOf(targetDates).toArray(),
  )

  return sessions
    .filter((session) =>
      existingSessions.some((existing) => (
        existing.date === session.date
        && existing.timeBlock === session.timeBlock
        && (
          existing.status !== 'planned'
          || (preserveManualSessions && existing.source === 'manual')
        )
      )),
    )
    .map((session) => ({ date: session.date, timeBlock: session.timeBlock }))
}

async function replacePlannedSessionsForCreateWeek(
  sessions: CreateWeekSessionInput,
  replacementCutoffAt?: number,
  replacementRange?: { startDate: string; endDate: string },
  preserveManualSessions = false,
): Promise<{ replacedSessions: Session[]; warnings: string[] }> {
  const warnings: string[] = []
  const weekStarts = [...new Set(sessions.map((session) => toISO(getWeekStart(fromISO(session.date)))))]
  const replacementDates = new Set(sessions.map((session) => session.date))
  const replacedSessions: Session[] = []

  for (const weekStart of weekStarts) {
    const weekEnd = toISO(addDays(fromISO(weekStart), 6))
    await syncService.pullSessionsForDateRange(weekStart, weekEnd)
    const existingWeekSessions = filterRowsToActiveScope(
      await db.sessions.where('date').between(weekStart, weekEnd, true, true).toArray(),
    )
    const shouldReplaceSession = (session: Session): boolean => {
      if (replacementRange) {
        return session.date >= replacementRange.startDate && session.date <= replacementRange.endDate
      }
      return replacementDates.has(session.date)
    }
    const plannedSessions = existingWeekSessions.filter(
      (session) => (
        session.status === 'planned'
        && shouldReplaceSession(session)
        && (!preserveManualSessions || session.source !== 'manual')
      ),
    )
    const preservedSessions = existingWeekSessions.filter((session) => (
      session.status !== 'planned'
      || (preserveManualSessions && session.source === 'manual')
    ))

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

    const preservedOnReplacementDates = preservedSessions.filter(shouldReplaceSession)
    if (preservedOnReplacementDates.length > 0) {
      warnings.push(formatCreateWeekPreservedCountWarning(
        preservedOnReplacementDates.length,
        preserveManualSessions,
      ))
    }
  }

  return { replacedSessions, warnings }
}
