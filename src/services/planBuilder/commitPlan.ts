import { addDays } from 'date-fns'
import type { AthleteProfile, Session, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { db } from '../../db/db'
import { getWeekSummary, recalculateWeekSummary } from '../../db/queries'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import * as syncService from '../syncService'
import { useTrainingStore } from '../../store/useTrainingStore'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { applyCreateWeek } from '../planning/applyCreateWeek'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { validatePlan } from './validator'
import { getSameDayHardCrossSportIssues, reviewPlanQuality } from './qualityReview'
import type { RecalibrationTarget } from './planRecalibration'
import {
  getPlanLifecycleCutoff,
  selectActivePlansToSupersede,
  selectSupersededPlanSessionsForCleanup,
  stampLifecyclePlanAthlete,
} from './planLifecycle'

export interface CommitPlanResult {
  errors: string[]
  warnings: string[]
  acceptedWeeks: number[]
  lifecycleRemovedSessionCount: number
}

export interface WeekCommitSnapshot {
  weekIndex: number
  weekStartDate: string
  sessions: Session[]
  summary: WeekSummary | null
}

interface PlanLifecycleCommit {
  supersededPlans: TrainingPlan[]
  removedSessions: Session[]
}

export function getWeekEndDate(weekStartDate: string): string {
  return toISO(addDays(fromISO(weekStartDate), 6))
}

function getSessionWeekStart(session: Session): string {
  return session.weekStartDate ?? toISO(getWeekStart(fromISO(session.date)))
}

async function activatePlanLifecycle(
  nextPlan: TrainingPlan,
  nextWeeks: TrainingPlanWeek[],
): Promise<PlanLifecycleCommit> {
  const futureCutoff = getPlanLifecycleCutoff(nextPlan)

  return db.transaction(
    'rw',
    db.trainingPlans,
    db.trainingPlanWeeks,
    db.sessions,
    async () => {
      const previousActivePlans = selectActivePlansToSupersede(
        await db.trainingPlans.toArray(),
        nextPlan,
      )
      const supersededPlans = previousActivePlans.map((candidate) => ({
        ...stampLifecyclePlanAthlete(candidate, nextPlan),
        status: 'superseded' as const,
        updatedAt: Math.max(nextPlan.updatedAt, candidate.updatedAt + 1),
      }))
      const supersededPlanIds = new Set(supersededPlans.map((candidate) => candidate.id))
      const removedSessions = supersededPlanIds.size === 0
        ? []
        : selectSupersededPlanSessionsForCleanup(
            await db.sessions.where('date').aboveOrEqual(futureCutoff).toArray(),
            supersededPlanIds,
            futureCutoff,
          )

      await db.trainingPlans.bulkPut([...supersededPlans, nextPlan])
      await db.trainingPlanWeeks.bulkPut(nextWeeks)
      if (removedSessions.length > 0) {
        await db.sessions.bulkDelete(removedSessions.map((session) => session.id))
      }

      return { supersededPlans, removedSessions }
    },
  )
}

async function syncPlanLifecycle(
  nextPlan: TrainingPlan,
  nextWeeks: TrainingPlanWeek[],
  lifecycle: PlanLifecycleCommit,
): Promise<syncService.SyncPushOutcome> {
  // The new parent is the durable publication barrier: online it lands first;
  // offline its queue op lands first. Children and convergent cleanup can then
  // run independently without one rejected mutation suppressing the rest.
  // Do not supersede the remote parent if publishing/queueing its replacement
  // fails: that would briefly (or permanently) leave the athlete with no
  // active remote plan. `upsertRow` resolves after the write is durable or its
  // offline operation is queued.
  const parentOutcome = await syncService.pushTrainingPlan(nextPlan)
  if (parentOutcome === 'failed' || parentOutcome === 'no_remote') {
    return parentOutcome
  }
  await Promise.allSettled([
    syncService.pushTrainingPlanWeeks(
      nextPlan,
      nextWeeks.filter((week) => week.status === 'accepted'),
    ),
    ...lifecycle.supersededPlans.map((previousPlan) => (
      syncService.pushTrainingPlan(previousPlan)
    )),
    ...lifecycle.removedSessions.map((session) => (
      syncService.deleteSession(session.id)
    )),
  ])
  return parentOutcome
}

async function refreshRemovedSessionWeeks(
  sessions: Session[],
): Promise<void> {
  if (sessions.length === 0) return
  const affectedWeekStarts = [...new Set(sessions.map(getSessionWeekStart))]
  await Promise.all(affectedWeekStarts.map((weekStart) => recalculateWeekSummary(weekStart)))
  const currentStore = useTrainingStore.getState()
  if (currentStore.loadedWeekStart && affectedWeekStarts.includes(currentStore.loadedWeekStart)) {
    await currentStore.loadWeek(currentStore.loadedWeekStart)
  }
  await useTrainingStore.getState().loadAllSummaries()
}

export async function captureWeekCommitSnapshot(week: TrainingPlanWeek): Promise<WeekCommitSnapshot> {
  const sessions = filterRowsToActiveScope(
    await db.sessions
      .where('date')
      .between(week.weekStartDate, getWeekEndDate(week.weekStartDate), true, true)
      .toArray(),
  )
  const summary = await getWeekSummary(week.weekStartDate)

  return {
    weekIndex: week.weekIndex,
    weekStartDate: week.weekStartDate,
    sessions: sessions.map((session) => ({ ...session })),
    summary: summary ? { ...summary } : null,
  }
}

export async function restoreWeekCommitSnapshots(snapshots: WeekCommitSnapshot[]): Promise<void> {
  const trainingStore = useTrainingStore.getState()
  const affectedWeekStarts = new Set<string>()

  for (const snapshot of [...snapshots].reverse()) {
    const currentSessions = filterRowsToActiveScope(
      await db.sessions
        .where('date')
        .between(snapshot.weekStartDate, getWeekEndDate(snapshot.weekStartDate), true, true)
        .toArray(),
    )
    const snapshotSessionIds = new Set(snapshot.sessions.map((session) => session.id))

    for (const session of currentSessions) {
      if (snapshotSessionIds.has(session.id)) continue
      await db.sessions.delete(session.id)
      void syncService.deleteSession(session.id)
    }

    for (const session of snapshot.sessions) {
      await db.sessions.put(session)
      void syncService.pushSession(session)
    }

    const currentSummary = await getWeekSummary(snapshot.weekStartDate)
    if (snapshot.summary) {
      await db.weekSummaries.put(snapshot.summary)
      void syncService.pushWeekSummary(snapshot.summary)
    } else if (currentSummary) {
      await db.weekSummaries.delete(currentSummary.id)
    }

    affectedWeekStarts.add(snapshot.weekStartDate)
  }

  if (trainingStore.loadedWeekStart && affectedWeekStarts.has(trainingStore.loadedWeekStart)) {
    await trainingStore.loadWeek(trainingStore.loadedWeekStart)
  }
  await trainingStore.loadAllSummaries()
}

function describeWeekReadiness(week: TrainingPlanWeek): string | null {
  if (week.status !== 'draft') {
    return `Semana ${week.weekIndex + 1} no está lista para aceptar (estado ${week.status}).`
  }
  if (week.sessions.length === 0) {
    return `Semana ${week.weekIndex + 1} no tiene sesiones generadas.`
  }
  return null
}

/**
 * Commits a draft TrainingPlan by expanding each generated week into real sessions.
 * This path is plan-builder specific and no longer depends on the coach proposal lifecycle.
 */
export async function commitPlan(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
): Promise<CommitPlanResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const acceptedWeeks: number[] = []
  let lifecycleRemovedSessionCount = 0
  const trainingStore = useTrainingStore.getState()
  const athleteProfile = useCoachMemoryStore.getState().athleteProfile
  const orderedWeeks = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
  const readinessErrors = orderedWeeks
    .map(describeWeekReadiness)
    .filter((issue): issue is string => issue != null)

  if (readinessErrors.length > 0) {
    return { errors: readinessErrors, warnings, acceptedWeeks, lifecycleRemovedSessionCount }
  }

  const validationIssues = validatePlan({ plan, weeks: orderedWeeks })
  const validationErrors = validationIssues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
  warnings.push(...validationIssues.filter((issue) => issue.severity !== 'error').map((issue) => issue.message))

  if (validationErrors.length > 0) {
    return { errors: validationErrors, warnings, acceptedWeeks, lifecycleRemovedSessionCount }
  }

  const qualityContext = { profile: athleteProfile ?? undefined }
  const preCommitQualityReview = reviewPlanQuality(plan, orderedWeeks, qualityContext)
  if (preCommitQualityReview.grade === 'poor' || preCommitQualityReview.criticalIssueCount > 0) {
    const headlineIssues = preCommitQualityReview.issues
      .slice(0, 4)
      .map((issue) => issue.message)
    return {
      errors: [
        `El plan necesita revisión del coach antes de aceptarse (puntaje ${preCommitQualityReview.score}/100).`,
        ...headlineIssues,
      ],
      warnings,
      acceptedWeeks,
      lifecycleRemovedSessionCount,
    }
  }
  if (preCommitQualityReview.grade === 'needs_review') {
    warnings.push(`El plan queda con revisión recomendada del coach (puntaje ${preCommitQualityReview.score}/100).`)
  }

  const appliedSnapshots: WeekCommitSnapshot[] = []

  for (const week of orderedWeeks) {
    const snapshot = await captureWeekCommitSnapshot(week)
    try {
      appliedSnapshots.push(snapshot)
      const result = await applyCreateWeek({
        sessions: week.sessions,
        weekObjectives: week.weekObjectives.map((objective) => objective.goal),
        athleteProfile,
        store: trainingStore,
        replacementRange: {
          startDate: week.weekStartDate,
          endDate: getWeekEndDate(week.weekStartDate),
        },
        planProvenance: {
          planId: plan.id,
          planWeekId: week.id,
        },
        preserveManualSessions: true,
      })
      warnings.push(...result.warnings)
      acceptedWeeks.push(week.weekIndex)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`Semana ${week.weekIndex + 1}: ${msg}`)
    }

    if (errors.length > 0) break
  }

  if (errors.length > 0) {
    if (appliedSnapshots.length > 0) {
      await restoreWeekCommitSnapshots(appliedSnapshots)
      warnings.push(`Se revirtieron ${appliedSnapshots.length} semanas afectadas antes o durante el fallo.`)
      acceptedWeeks.length = 0
    }
  }

  if (errors.length === 0) {
    const nowTs = Date.now()
    const nextWeeks = orderedWeeks.map((w) => ({
      ...w,
      status: acceptedWeeks.includes(w.weekIndex) ? 'accepted' as const : w.status,
      updatedAt: nowTs,
    }))
    const qualityReview = reviewPlanQuality(plan, nextWeeks, qualityContext)
    const nextPlan: TrainingPlan = {
      ...plan,
      status: 'active',
      acceptedAt: nowTs,
      updatedAt: nowTs,
      generationSummary: plan.generationSummary
        ? {
          ...plan.generationSummary,
          acceptedAt: plan.generationSummary.acceptedAt ?? nowTs,
          qualityReview,
        }
        : {
          startedAt: plan.createdAt,
          strategy: 'single',
          completedWeeks: nextWeeks.length,
          failedWeeks: [],
          totalAttempts: nextWeeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
          acceptedAt: nowTs,
          qualityReview,
        },
    }
    let lifecycle: PlanLifecycleCommit
    try {
      lifecycle = await activatePlanLifecycle(nextPlan, nextWeeks)
    } catch (error) {
      if (appliedSnapshots.length > 0) {
        await restoreWeekCommitSnapshots(appliedSnapshots)
        warnings.push(`Se revirtieron ${appliedSnapshots.length} semanas afectadas porque no se pudo activar el plan.`)
        acceptedWeeks.length = 0
      }
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`No se pudo activar el plan: ${msg}`)
      return { errors, warnings, acceptedWeeks, lifecycleRemovedSessionCount }
    }
    lifecycleRemovedSessionCount = lifecycle.removedSessions.length
    if (lifecycle.removedSessions.length > 0) {
      warnings.push(`Se retiraron ${lifecycle.removedSessions.length} sesiones futuras planificadas de ciclos reemplazados.`)
      await refreshRemovedSessionWeeks(lifecycle.removedSessions).catch(() => undefined)
    }
    const syncOutcome = await syncPlanLifecycle(nextPlan, nextWeeks, lifecycle)
    if (syncOutcome === 'failed') {
      warnings.push('El plan quedó activo en este dispositivo, pero no se pudo publicar. No se modificó el ciclo remoto anterior.')
    }
  }

  return { errors, warnings, acceptedWeeks, lifecycleRemovedSessionCount }
}

export interface ReconcileRecalibratedWeeksResult {
  warnings: string[]
  /** Semanas del target que no se tocaron porque no estaban listas (ver `describeRecalibrationReadiness`). */
  skippedWeekIndexes: number[]
}

/**
 * Mismo chequeo que `describeWeekReadiness` de `commitPlan` (arriba), pero
 * con mensaje propio de este contexto: no es "no está lista para aceptar",
 * es "no se recalibró". Reproducido en vez de reutilizado a propósito, para
 * no filtrar copy de aceptación de plan en un flujo que no acepta nada.
 *
 * Sin este guard, `reconcileRecalibratedWeeks` dependía en silencio de que
 * `applyCreateWeek` hiciera early-return al recibir `sessions: []` — un
 * detalle de implementación de otro módulo, no un contrato declarado acá.
 */
function describeRecalibrationReadiness(week: TrainingPlanWeek): string | null {
  if (week.status !== 'draft') {
    return `Semana ${week.weekIndex + 1} no se recalibró: la generación terminó en estado "${week.status}", no listo.`
  }
  if (week.sessions.length === 0) {
    return `Semana ${week.weekIndex + 1} no se recalibró: no generó sesiones.`
  }
  return null
}

/**
 * Materializa en el calendario real las semanas futuras que acaban de
 * recalibrarse (ver `selectRecalibrationTargets` en `planRecalibration.ts`).
 *
 * Regenerar `TrainingPlanWeek` no cambia por sí solo el calendario del
 * atleta: las filas `Session` sólo se escriben vía `applyCreateWeek`, el
 * mismo camino que usa `commitPlan` arriba al aceptar un plan por primera
 * vez. Esta función reutiliza exactamente ese camino —mismos helpers de
 * snapshot/rollback, mismo `applyCreateWeek`— con dos diferencias
 * deliberadas frente a `commitPlan`:
 *
 * 1. Sólo toca las semanas de `target.weekIndexes`, que
 *    `selectRecalibrationTargets` garantiza estrictamente futuras — la
 *    semana en curso nunca entra al rango de reemplazo.
 * 2. Siempre pasa `preserveManualSessions: true`: el atleta pudo agregar
 *    sesiones propias a una semana futura y una recalibración por datos
 *    nuevos no pidió borrarlas.
 *
 * `applyCreateWeek` ya garantiza que sólo borra sesiones
 * `status === 'planned'` (`replacePlannedSessionsForCreateWeek`), así que
 * una sesión `completed`/`adjusted` nunca se toca aunque su fecha caiga
 * dentro del `replacementRange`.
 *
 * Si `applyCreateWeek` falla a mitad de camino, se revierten TODAS las
 * semanas ya aplicadas en esta corrida (incluida la que falló, cuyo
 * snapshot es un no-op porque nada llegó a mutarse) — mismo patrón que el
 * rollback multi-semana de `commitPlan`.
 */
export async function reconcileRecalibratedWeeks(input: {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  target: RecalibrationTarget
  profile: AthleteProfile | null
}): Promise<ReconcileRecalibratedWeeksResult> {
  const { plan, weeks, target, profile } = input
  const warnings: string[] = []
  if (plan.status !== 'active') return { warnings: [], skippedWeekIndexes: target.weekIndexes }
  const currentWeekStart = toISO(getWeekStart(fromISO(target.asOfDate)))
  const targetSet = new Set(target.weekIndexes)
  const recalibratedWeeks = weeks
    .filter((week) => targetSet.has(week.weekIndex))
    .sort((a, b) => a.weekIndex - b.weekIndex)

  const trainingStore = useTrainingStore.getState()
  const appliedSnapshots: WeekCommitSnapshot[] = []
  const skippedWeekIndexes: number[] = []

  for (const week of recalibratedWeeks) {
    const readinessIssue = week.weekStartDate <= currentWeekStart
      ? `Semana ${week.weekIndex + 1} no se recalibró: ya no es una semana futura.`
      : describeRecalibrationReadiness(week)
    if (readinessIssue) {
      skippedWeekIndexes.push(week.weekIndex)
      warnings.push(readinessIssue)
      continue
    }
    const safetyIssues = [
      ...week.validationIssues.filter((issue) => issue.severity === 'error'),
      ...getSameDayHardCrossSportIssues(week),
    ]
    if (week.sessions.some((session) => session.date < week.weekStartDate || session.date > getWeekEndDate(week.weekStartDate))) {
      skippedWeekIndexes.push(week.weekIndex)
      warnings.push(`Semana ${week.weekIndex + 1} no se recalibró: hay sesiones fuera del rango de reemplazo.`)
      continue
    }
    if (safetyIssues.length > 0) {
      skippedWeekIndexes.push(week.weekIndex)
      warnings.push(`Semana ${week.weekIndex + 1} no se recalibró: ${safetyIssues.map((issue) => issue.message).join(' ')}`)
      continue
    }
    try {
      const snapshot = await captureWeekCommitSnapshot(week)
      appliedSnapshots.push(snapshot)
      const result = await applyCreateWeek({
        sessions: week.sessions,
        weekObjectives: week.weekObjectives.map((objective) => objective.goal),
        athleteProfile: profile,
        store: trainingStore,
        replacementRange: {
          startDate: week.weekStartDate,
          endDate: getWeekEndDate(week.weekStartDate),
        },
        planProvenance: {
          planId: plan.id,
          planWeekId: week.id,
        },
        preserveManualSessions: true,
      })
      warnings.push(...result.warnings)
    } catch (error) {
      await restoreWeekCommitSnapshots(appliedSnapshots)
      throw error
    }
  }

  return { warnings, skippedWeekIndexes }
}
