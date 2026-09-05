import { create } from 'zustand'
import type { AthleteProfile, PlanWizardConfig } from '../types'
import type {
  PlanGenerationJob,
  PlanValidationIssue,
  TrainingPlan,
  TrainingPlanWeek,
} from '../types/planBuilder'
import { db } from '../db/db'
import { buildPlanShell } from '../services/planBuilder/buildPlanShell'
import { validatePlan } from '../services/planBuilder/validator'
import { commitPlan, reconcileRecalibratedWeeks, type CommitPlanResult } from '../services/planBuilder/commitPlan'
import { getPrimaryGoalEvent } from '../services/macroPlan'
import { selectRecalibrationTargets, type RecalibrationTarget } from '../services/planBuilder/planRecalibration'
import {
  derivePlanGenerationState,
  resolveConfiguredGenerationStrategy,
} from '../services/planBuilder/generationState'
import {
  createPlanGenerationJob,
  getLatestPlanGenerationJob,
  getRunnablePlanGenerationJobs,
  runPlanGenerationJob,
} from '../services/planBuilder/generationJobRunner'
import { buildPlanBuilderRecentContext } from '../services/planBuilder/recentContext'
import { buildRetriggerPlan, isActivePlanGeneration } from '../services/planBuilder/activeGeneration'
import { countReadyWeeks, isReadyWeek, sortWeeks } from '../services/planBuilder/weekUtils'
import {
  fetchPlanGenerationSnapshot,
  pollPlanGeneration,
  type PlanGenerationSnapshot,
} from '../services/planBuilder/pollPlanGeneration'
import {
  PlanEnqueueRejectedError,
  triggerBackgroundGeneration,
  type PlanEnqueueUsageRejectionCode,
} from '../services/planBuilder/triggerBackgroundGeneration'
import {
  assertPlanBuilderWeekRateLimit,
  releasePlanBuilderWeekReservations,
  reservePlanBuilderWeekUsage,
  syncPlanBuilderWeekUsageFromWeeks,
} from '../services/planBuilder/rateLimit'
import { pushTrainingPlan } from '../services/syncService'
import { supabase } from '../services/auth'
import { useAuthStore } from './useAuthStore'
import { useCoachMemoryStore } from './useCoachMemoryStore'
import { ATHLETE_PROFILE_LOCAL_ID, getActiveAthleteId, getSwitchEpoch } from '../services/athlete/activeAthlete'
import type { EntitlementRequiredDetail } from '../services/entitlements/entitlementError'
import { todayISO } from '../utils/date'

const EMPTY_DRAFT_WEEKS_MESSAGE = 'No encontramos semanas para este plan. Descártalo y vuelve a prepararlo desde el inicio.'

// Copy específico para rechazos de cuota/costo/kill switch (servidor).
// Deliberadamente NO abre UpsellCard: no es una oferta de plan, es un límite
// operativo temporal — ver PlanEnqueueRejectedError.usageRejection.
const USAGE_REJECTION_COPY: Record<PlanEnqueueUsageRejectionCode, string> = {
  quota_exceeded: 'Alcanzaste el cupo diario de Plan Builder. Vuelve a intentarlo mañana.',
  spend_cap_exceeded: 'El servicio alcanzó su presupuesto diario. Vuelve a intentarlo mañana.',
  kill_switch_active: 'La IA está temporalmente pausada. Volvé a intentarlo más tarde.',
}

export type PlanBuilderStatus =
  | 'idle'
  | 'shelling'
  | 'shell_ready'
  | 'generating'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'ready'
  | 'committing'
  | 'done'
  | 'error'

interface PlanBuilderState {
  plan: TrainingPlan | null
  weeks: TrainingPlanWeek[]
  issues: PlanValidationIssue[]
  status: PlanBuilderStatus
  currentWeekIndex: number | null
  completedWeeks: number
  failedWeekIndexes: number[]
  streamingTextByWeekIndex: Record<number, string>
  generationJob: PlanGenerationJob | null
  lastError: string | null
  /** Oferta de plan efímera; nunca se persiste en Dexie ni se sincroniza. */
  entitlementOffer: EntitlementRequiredDetail | null
  /**
   * Recuento visible de la última reconciliación de calendario disparada por
   * `recalibrateRemainingWeeks` (Step 3b): qué se reemplazó, qué se conservó
   * y qué semana quedó sin recalibrar y por qué. Efímero, igual que
   * `entitlementOffer` — no se persiste en Dexie ni se sincroniza. `null`
   * cuando no hay nada que mostrar.
   */
  recalibrationNotice: string[] | null

  createDraft: (input: { profile: AthleteProfile; wizardConfig: PlanWizardConfig }) => Promise<void>
  runGeneration: (profile: AthleteProfile, options?: { forceNew?: boolean }) => Promise<void>
  retryFullGeneration: (profile: AthleteProfile) => Promise<void>
  regenerateWeek: (weekIndex: number, profile: AthleteProfile, repairInstruction?: string) => Promise<void>
  regenerateWeeks: (weekIndexes: number[], profile: AthleteProfile, repairInstructions?: Record<number, string>) => Promise<void>
  /**
   * Regenera las semanas futuras de un plan `active` con datos reales de las
   * semanas ya vividas, y luego reconcilia el calendario materializado. Ver
   * `selectRecalibrationTargets` (elegibilidad) y `reconcileRecalibratedWeeks`
   * (Step 3b) para el detalle.
   */
  recalibrateRemainingWeeks: (profile: AthleteProfile) => Promise<void>
  retryFailedWeeks: (profile: AthleteProfile) => Promise<void>
  /** Reintenta solo las semanas sin sesiones listas (pending/error/colgadas), conservando las draft ya generadas. */
  retryIncompleteWeeks: (profile: AthleteProfile) => Promise<void>
  resumeGenerationJobs: (profile: AthleteProfile) => Promise<void>
  cancelGeneration: () => Promise<void>
  acceptPlan: () => Promise<CommitPlanResult>
  discard: () => Promise<void>
  loadDraft: (planId: string) => Promise<void>
  resetBuilderState: () => void
  resetForAthleteSwitch: () => void
}

type PlanBuilderSet = (
  partial: Partial<PlanBuilderState> | ((state: PlanBuilderState) => Partial<PlanBuilderState>),
) => void

type PlanBuilderAttemptSnapshot = Pick<
  PlanBuilderState,
  | 'plan'
  | 'weeks'
  | 'issues'
  | 'status'
  | 'currentWeekIndex'
  | 'completedWeeks'
  | 'failedWeekIndexes'
  | 'streamingTextByWeekIndex'
  | 'generationJob'
  | 'lastError'
>

let generationPollingController: AbortController | null = null

function isCurrentSwitchEpoch(epochAtStart: number): boolean {
  return getSwitchEpoch() === epochAtStart
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setErrorIfCurrentSwitchEpoch(
  set: PlanBuilderSet,
  epochAtStart: number,
  error: unknown,
) {
  if (!isCurrentSwitchEpoch(epochAtStart)) return
  set({ status: 'error', lastError: errorMessage(error) })
}

function captureAttemptSnapshot(state: PlanBuilderState): PlanBuilderAttemptSnapshot {
  return {
    plan: state.plan,
    weeks: state.weeks,
    issues: state.issues,
    status: state.status,
    currentWeekIndex: state.currentWeekIndex,
    completedWeeks: state.completedWeeks,
    failedWeekIndexes: state.failedWeekIndexes,
    streamingTextByWeekIndex: state.streamingTextByWeekIndex,
    generationJob: state.generationJob,
    lastError: state.lastError,
  }
}

async function persistPlanState(plan: TrainingPlan, weeks: TrainingPlanWeek[]) {
  await db.trainingPlans.put(plan)
  await db.trainingPlanWeeks.bulkPut(weeks)
}

function buildGenerationFailureMessage(failedWeekIndexes: number[]): string | null {
  if (failedWeekIndexes.length === 0) return null
  if (failedWeekIndexes.length === 1) {
    return `No se pudo preparar la semana ${failedWeekIndexes[0] + 1}. Ajústala para continuar.`
  }
  return `No se pudieron preparar ${failedWeekIndexes.length} semanas. Ajústalas para continuar.`
}

// El worker persiste una falla de infraestructura del propio gate (RPC
// caída, red, JSON ilegible — `UsageGateUnavailableError`) con `errorClass:
// 'server_error'` (asyncGenerationLoop.ts), igual que los 3 rechazos de
// política. No es un código de `PlanEnqueueUsageRejectionCode` porque el
// preflight de enqueue nunca la produce — solo puede ocurrir dentro del
// worker, donde el gate autoritativo corre de verdad.
const GATE_INFRA_FAILURE_MESSAGE = 'No pudimos verificar el uso de IA. Intenta de nuevo en unos minutos.'

/**
 * Hallazgo de revisión externa: cuando el preflight del enqueue acepta un
 * job con poco cupo restante y el gate autoritativo lo agota a mitad del
 * worker, `asyncGenerationLoop.ts` persiste correctamente `errorClass` con
 * el código de rechazo (`quota_exceeded`/`spend_cap_exceeded`/
 * `kill_switch_active`/`server_error`) en `generationMeta` de cada semana
 * afectada — pero `applyGenerationSnapshot` lo ignoraba por completo y
 * mostraba siempre el mensaje genérico por cantidad de
 * `buildGenerationFailureMessage`. El usuario no se enteraba de que debía
 * esperar y podía reintentar de inmediato, chocando con el mismo rechazo.
 * Reusa el mismo copy que ya existe para el rechazo en el enqueue
 * (`USAGE_REJECTION_COPY`) — es la misma causa, solo que detectada más
 * tarde.
 */
function resolveUsageGateFailureMessage(weeks: TrainingPlanWeek[]): string | null {
  const rejectedWeek = weeks.find((week) => {
    const errorClass = week.generationMeta.errorClass
    return week.status === 'error' && errorClass != null
      && (errorClass === 'server_error' || errorClass in USAGE_REJECTION_COPY)
  })
  if (!rejectedWeek) return null
  const errorClass = rejectedWeek.generationMeta.errorClass
  if (errorClass === 'server_error') return GATE_INFRA_FAILURE_MESSAGE
  return USAGE_REJECTION_COPY[errorClass as PlanEnqueueUsageRejectionCode]
}

function toBuilderStatus(generationState: TrainingPlan['generationState']): PlanBuilderStatus {
  switch (generationState) {
    case 'shell': return 'shell_ready'
    case 'generating': return 'generating'
    case 'partial': return 'partial'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'complete': return 'ready'
  }
}

function applyGenerationSnapshot(
  snapshot: PlanGenerationSnapshot,
  set: PlanBuilderSet,
) {
  const orderedWeeks = sortWeeks(snapshot.weeks)
  void syncPlanBuilderWeekUsageFromWeeks(snapshot.plan.id, orderedWeeks)
  const failedWeekIndexes = snapshot.plan.generationSummary?.failedWeeks ?? orderedWeeks
    .filter((week) => week.status === 'error')
    .map((week) => week.weekIndex)
  const currentWeekIndex = orderedWeeks.find((week) => week.status === 'generating')?.weekIndex ?? null
  const lastError = snapshot.isStalled
    ? 'La preparación quedó sin señales de progreso. Puedes reintentar las semanas pendientes.'
    : snapshot.plan.generationState === 'partial' || snapshot.plan.generationState === 'failed'
      ? resolveUsageGateFailureMessage(orderedWeeks) ?? buildGenerationFailureMessage(failedWeekIndexes)
      : snapshot.plan.generationState === 'cancelled'
        ? 'Preparación detenida. Puedes reintentar cuando quieras.'
        : null

  set({
    plan: snapshot.plan,
    weeks: orderedWeeks,
    issues: validatePlan({ plan: snapshot.plan, weeks: orderedWeeks }),
    status: snapshot.isStalled ? 'failed' : toBuilderStatus(snapshot.plan.generationState),
    currentWeekIndex,
    completedWeeks: snapshot.plan.generationSummary?.completedWeeks ?? countReadyWeeks(orderedWeeks),
    failedWeekIndexes,
    streamingTextByWeekIndex: currentWeekIndex == null ? {} : { [currentWeekIndex]: '' },
    generationJob: null,
    lastError,
    entitlementOffer: null,
  })
}

function startGenerationPolling(
  planId: string,
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
  epochAtStart = getSwitchEpoch(),
  /**
   * Se dispara una sola vez, cuando el polling termina en un snapshot
   * terminal no-stalled (`complete`/`partial`/`failed`/`cancelled`). Hoy sólo
   * lo usa `recalibrateRemainingWeeks` para reconciliar el calendario después
   * de que la generación de las semanas futuras realmente terminó — nunca
   * antes, porque reconciliar semanas todavía en `generating` escribiría
   * contenido a medias. Ningún otro caller lo pasa, así que su comportamiento
   * es idéntico al de antes de este parámetro.
   */
  onTerminal?: (snapshot: PlanGenerationSnapshot) => void | Promise<void>,
) {
  if (!isCurrentSwitchEpoch(epochAtStart)) return
  generationPollingController?.abort()
  const controller = new AbortController()
  generationPollingController = controller
  void pollPlanGeneration({
    planId,
    signal: controller.signal,
    onSnapshot: (snapshot) => {
      if (!isCurrentSwitchEpoch(epochAtStart)) return
      // Ignore stale 'shell' snapshots while local store already shows generation in progress.
      // This prevents the LaunchDeck from flashing back when pushTrainingPlan was queued
      // (offline / slow network) and Supabase still shows the pre-generation state.
      const current = get()
      if (
        snapshot.plan.generationState === 'shell' &&
        (current.status === 'generating' || current.plan?.generationState === 'generating') &&
        (snapshot.plan.updatedAt ?? 0) <= (current.plan?.updatedAt ?? 0)
      ) {
        return
      }
      applyGenerationSnapshot(snapshot, set)
    },
  }).then(async (latest) => {
    if (!latest || !latest.isTerminal || latest.isStalled) return
    if (controller.signal.aborted) return
    if (!isCurrentSwitchEpoch(epochAtStart)) return
    if (onTerminal) await onTerminal(latest)
    else await recoverPendingRecalibrationIfTerminal(set, get, epochAtStart, latest.plan, latest.weeks)
  }).catch((error) => {
    if (controller.signal.aborted) return
    setErrorIfCurrentSwitchEpoch(set, epochAtStart, error)
  }).finally(() => {
    if (generationPollingController === controller) {
      generationPollingController = null
    }
  })
}

function canUseRemoteGeneration(): boolean {
  return Boolean(supabase && useAuthStore.getState().user)
}

async function resumeUncertainRemoteGeneration(
  planId: string,
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
  epochAtStart = getSwitchEpoch(),
): Promise<boolean> {
  const remoteSnapshot = await fetchPlanGenerationSnapshot(planId).catch(() => null)
  if (!isCurrentSwitchEpoch(epochAtStart)) return false
  if (remoteSnapshot) {
    applyGenerationSnapshot(remoteSnapshot, set)
    await recoverPendingRecalibrationIfTerminal(set, get, epochAtStart, remoteSnapshot.plan, remoteSnapshot.weeks)
    if (!remoteSnapshot.isTerminal && !remoteSnapshot.isStalled) {
      startGenerationPolling(remoteSnapshot.plan.id, set, get, epochAtStart)
    }
    return true
  }

  const current = get()
  if (current.plan?.id !== planId || current.plan.generationState !== 'generating') {
    return false
  }

  set({
    status: 'generating',
    generationJob: null,
    lastError: null,
  })
  startGenerationPolling(planId, set, get, epochAtStart)
  return true
}

function normalizePlanGenerationState(plan: TrainingPlan, weeks: TrainingPlanWeek[]): TrainingPlan {
  if (plan.generationState === 'generating' || plan.generationState === 'cancelled') return plan
  return {
    ...plan,
    generationState: plan.status === 'active' || plan.status === 'archived'
      ? 'complete'
      : derivePlanGenerationState(weeks),
  }
}

function hasGenerationProgress(weeks: TrainingPlanWeek[]): boolean {
  return weeks.some((week) =>
    week.status !== 'pending' ||
    week.sessions.length > 0 ||
    (week.generationMeta.attempts ?? 0) > 0
  )
}

function shouldResumeRemoteGenerationSnapshot(snapshot: PlanGenerationSnapshot): boolean {
  if (snapshot.plan.generationState === 'generating') {
    return Boolean(snapshot.plan.generationSummary?.jobId) || hasGenerationProgress(snapshot.weeks)
  }
  if (snapshot.plan.generationState === 'shell') {
    return hasGenerationProgress(snapshot.weeks)
  }
  return true
}

function resetWeeksForFullGeneration(weeks: TrainingPlanWeek[]): TrainingPlanWeek[] {
  const nowTs = Date.now()
  return weeks.map((week) => ({
    ...week,
    status: 'pending',
    sessions: [],
    validationIssues: [],
    generationMeta: { attempts: 0 },
    updatedAt: nowTs,
  }))
}

async function markGenerationStartRejected(input: {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  message: string
  set: PlanBuilderSet
  publishRemote?: boolean
  failedWeekIndexes?: number[]
  epochAtStart?: number
}) {
  generationPollingController?.abort()
  generationPollingController = null

  const updatedAt = Date.now()
  const orderedWeeks = sortWeeks(input.weeks)
  const failedWeekIndexes = Array.from(new Set(input.failedWeekIndexes ?? [])).sort((a, b) => a - b)
  const completedWeeks = countReadyWeeks(orderedWeeks)
  const failedPlan: TrainingPlan = {
    ...input.plan,
    generationState: 'failed',
    updatedAt,
    generationSummary: {
      ...(input.plan.generationSummary ?? {
        startedAt: updatedAt,
        strategy: 'single' as const,
        completedWeeks,
        failedWeeks: failedWeekIndexes,
        totalAttempts: 0,
      }),
      completedAt: updatedAt,
      heartbeatAt: input.plan.generationSummary?.heartbeatAt ?? updatedAt,
      completedWeeks,
      failedWeeks: failedWeekIndexes,
    },
  }

  await persistPlanState(failedPlan, orderedWeeks).catch((error) => {
    console.warn('[plan-builder] failed to persist rejected generation state', error)
  })
  if (input.publishRemote) {
    await pushTrainingPlan(failedPlan).catch((error) => {
      console.warn('[plan-builder] failed to publish rejected generation state', error)
    })
  }
  if (input.epochAtStart != null && !isCurrentSwitchEpoch(input.epochAtStart)) return

  input.set({
    plan: failedPlan,
    weeks: orderedWeeks,
    issues: validatePlan({ plan: failedPlan, weeks: orderedWeeks }),
    generationJob: null,
    status: 'error',
    currentWeekIndex: null,
    completedWeeks,
    failedWeekIndexes,
    streamingTextByWeekIndex: {},
    lastError: input.message,
  })
}

async function restoreAfterEntitlementRejection(input: {
  snapshot: PlanBuilderAttemptSnapshot
  entitlement: EntitlementRequiredDetail
  set: PlanBuilderSet
  publishRemote: boolean
  accountUserIdAtStart: string | null
  epochAtStart: number
}) {
  generationPollingController?.abort()
  generationPollingController = null

  const { plan, weeks } = input.snapshot
  if (plan) {
    await persistPlanState(plan, weeks).catch((error) => {
      console.warn('[plan-builder] failed to restore state after entitlement rejection', error)
    })
    // Una respuesta tardía después de cambiar de cuenta no puede publicar con
    // el token de la cuenta nueva. Un cambio de atleta dentro de la misma
    // cuenta sí puede terminar el rollback explícito del plan anterior.
    const currentUserId = useAuthStore.getState().user?.id ?? null
    if (input.publishRemote
      && input.accountUserIdAtStart != null
      && currentUserId === input.accountUserIdAtStart) {
      await pushTrainingPlan(plan).catch((error) => {
        console.warn('[plan-builder] failed to publish restored entitlement state', error)
      })
    }
  }

  // El rollback termina el intento explícito del scope anterior, pero una
  // respuesta tardía nunca puede pisar la cuenta/atleta actualmente visible.
  if (!isCurrentSwitchEpoch(input.epochAtStart)) return
  input.set({
    ...input.snapshot,
    entitlementOffer: input.entitlement,
  })
}

async function guardRemotePlanBuilderRateLimit(
  weekIndexes: readonly number[],
  set: PlanBuilderSet,
  epochAtStart = getSwitchEpoch(),
): Promise<boolean> {
  try {
    await assertPlanBuilderWeekRateLimit(weekIndexes)
    return isCurrentSwitchEpoch(epochAtStart)
  } catch (error) {
    if (!isCurrentSwitchEpoch(epochAtStart)) return false
    const msg = errorMessage(error)
    set({
      status: 'error',
      lastError: msg,
      generationJob: null,
      currentWeekIndex: null,
      streamingTextByWeekIndex: {},
    })
    return false
  }
}

async function releaseReservedRemoteUsage(planId: string, weekIndexes: readonly number[]): Promise<void> {
  await releasePlanBuilderWeekReservations({ planId, weekIndexes }).catch((error) => {
    console.warn('[plan-builder] failed to release reserved rate-limit usage', error)
  })
}

/**
 * Quita `pendingRecalibration` de un plan en memoria, si lo tiene. Puro —
 * no toca Dexie.
 */
function withoutPendingRecalibration(plan: TrainingPlan): TrainingPlan {
  if (!plan.pendingRecalibration) return plan
  const cleared: TrainingPlan = { ...plan }
  delete cleared.pendingRecalibration
  return cleared
}

/** Lee el registro actual: polling y sync conservan el marcador hasta este punto. */
async function clearPendingRecalibration(planId: string): Promise<void> {
  const current = await db.trainingPlans.get(planId)
  if (!current?.pendingRecalibration) return
  await db.trainingPlans.put(withoutPendingRecalibration(current)).catch((error) => {
    console.warn('[plan-builder] failed to clear pendingRecalibration marker', error)
  })
}

/**
 * Step 3b de `recalibrateRemainingWeeks`: reconcilia el calendario real una
 * vez que la generación de las semanas futuras terminó (local o remota).
 *
 * Sólo reconcilia si al menos una semana quedó lista (`complete`/`partial`);
 * un plan `failed`/`cancelled` no tiene contenido nuevo que materializar —
 * en ese caso el marcador se deja puesto a propósito: no hay nada que
 * reconciliar todavía y una futura recalibración manual lo reemplazará. Un
 * fallo de `reconcileRecalibratedWeeks` en sí (p. ej. `applyCreateWeek`
 * lanzando por concurrencia) se reporta como error del intento y TAMPOCO
 * limpia el marcador — la generación ya escribió `TrainingPlanWeek`, pero el
 * calendario del atleta no cambió, así que conservarlo permite que una
 * recarga posterior lo vuelva a intentar.
 *
 * Al terminar con éxito, sube `warnings` (incluidas las semanas que
 * `reconcileRecalibratedWeeks` tuvo que saltarse por no estar listas) a
 * `recalibrationNotice`, el mismo canal de avisos que ya mira esta página —
 * sin eso el recuento de qué se reemplazó/conservó se perdía en
 * `console.info`.
 */
async function reconcileAfterRecalibration(
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
  epochAtStart: number,
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  target: RecalibrationTarget,
  profile: AthleteProfile | null,
): Promise<void> {
  if (plan.status !== 'active') return
  if (plan.generationState !== 'complete' && plan.generationState !== 'partial') return
  // Revalidación justo antes de escribir (Minor de revisión). Los dos
  // caminos remoto/local prechequean el epoch inmediatamente antes de llamar
  // a esta función, pero `recoverPendingRecalibrationIfTerminal` corre en
  // `loadDraft`, exactamente el momento donde es más probable que el atleta
  // activo cambie (hidratación, `switchActiveAthlete`, múltiples pestañas).
  // `reconcileRecalibratedWeeks` termina escribiendo sesiones vía
  // `applyCreateWeek` → `store.addSession`, que estampa el atleta ACTIVO en
  // el momento de la escritura (`withActiveAthleteStamp`) — el scope de
  // atleta es una regla dura del proyecto, así que esta función, que es
  // donde la escritura real se dispara, se revalida a sí misma en vez de
  // confiar en que todo caller lo haga siempre correctamente.
  if (!isCurrentSwitchEpoch(epochAtStart)) return
  try {
    const { warnings } = await reconcileRecalibratedWeeks({ plan, weeks, target: { ...target, asOfDate: todayISO() }, profile })
    await clearPendingRecalibration(plan.id)
    if (isCurrentSwitchEpoch(epochAtStart)) {
      const current = get()
      set({
        recalibrationNotice: warnings.length > 0 ? warnings : null,
        ...(current.plan?.id === plan.id ? { plan: withoutPendingRecalibration(current.plan) } : {}),
      })
    }
  } catch (error) {
    console.warn('[plan-builder] recalibration reconciliation failed; TrainingPlanWeek updated but the calendar was not', error)
    if (isCurrentSwitchEpoch(epochAtStart)) {
      setErrorIfCurrentSwitchEpoch(
        set,
        epochAtStart,
        new Error('Se preparó la nueva versión, pero no pudimos actualizar tu calendario. Vuelve a intentarlo.'),
      )
    }
  }
}

/**
 * Red de seguridad de Important 2: si la pestaña que disparó una
 * recalibración se cerró antes de que el polling terminara, el worker igual
 * escribió las `TrainingPlanWeek` nuevas pero nadie reconcilió el
 * calendario. Al volver a cargar el plan (`loadDraft`), si trae
 * `pendingRecalibration` y sus semanas objetivo ya están en un estado
 * terminal, reconcilia y limpia. Si siguen `pending`/`generating`/
 * `regenerating`, no hace nada — no es una cola ni un reintento, es sólo la
 * comprobación de "¿ya terminó, sin que nadie se enterara?".
 */
async function recoverPendingRecalibrationIfTerminal(
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
  epochAtStart: number,
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
): Promise<void> {
  const marker = plan.pendingRecalibration
  if (!marker) return
  const targetWeeks = marker.weekIndexes
    .map((weekIndex) => weeks.find((week) => week.weekIndex === weekIndex))
  const allTerminal = targetWeeks.every((week) => (
    week != null
    && week.status !== 'pending'
    && week.status !== 'generating'
    && week.status !== 'regenerating'
  ))
  if (!allTerminal) return
  const target: RecalibrationTarget = { weekIndexes: marker.weekIndexes, asOfDate: todayISO(), livedWeekCount: 0 }
  const profile = useCoachMemoryStore.getState().athleteProfile
  await reconcileAfterRecalibration(set, get, epochAtStart, plan, weeks, target, profile)
}

export function buildRunnerCallbacks(
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
  epochAtBuild = getSwitchEpoch(),
) {
  const planIdAtBuild = get().plan?.id ?? null
  const guarded = <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (getSwitchEpoch() !== epochAtBuild) return
      if (planIdAtBuild && get().plan?.id !== planIdAtBuild) return
      fn(...args)
    }

  return {
    onJobUpdate: guarded((job: PlanGenerationJob) => {
      set((state) => {
        const status = job.status === 'running' || job.status === 'queued'
          ? 'generating'
          : state.plan
            ? toBuilderStatus(state.plan.generationState)
            : state.status
        return {
          generationJob: job,
          status,
          currentWeekIndex: job.currentWeekIndex,
          completedWeeks: job.completedWeeks,
          failedWeekIndexes: job.failedWeekIndexes,
          lastError: job.status === 'failed' ? job.lastError ?? state.lastError : state.lastError,
        }
      })
    }),
    onPlanUpdate: guarded((plan: TrainingPlan, weeks: TrainingPlanWeek[]) => {
      const orderedWeeks = sortWeeks(weeks)
      const issues = validatePlan({ plan, weeks: orderedWeeks })
      const failedWeekIndexes = plan.generationSummary?.failedWeeks ?? orderedWeeks
        .filter((week) => week.status === 'error')
        .map((week) => week.weekIndex)
      set((state) => ({
        plan,
        weeks: orderedWeeks,
        issues,
        status: state.generationJob?.status === 'running' || plan.generationState === 'generating'
          ? 'generating'
          : toBuilderStatus(plan.generationState),
        completedWeeks: plan.generationSummary?.completedWeeks ?? countReadyWeeks(orderedWeeks),
        failedWeekIndexes,
        currentWeekIndex: state.generationJob?.currentWeekIndex ?? null,
        lastError: plan.generationState === 'partial' || plan.generationState === 'failed'
          ? buildGenerationFailureMessage(failedWeekIndexes)
          : null,
      }))
    }),
    onWeekUpdate: guarded((next: TrainingPlanWeek) => {
      set((state) => ({
        weeks: sortWeeks(state.weeks.map((week) => (week.weekIndex === next.weekIndex ? next : week))),
        currentWeekIndex: next.status === 'generating'
          ? next.weekIndex
          : state.currentWeekIndex === next.weekIndex
            ? null
            : state.currentWeekIndex,
        completedWeeks: next.status === 'draft'
          ? Math.max(
            state.completedWeeks,
            state.weeks.filter((week) => week.weekIndex !== next.weekIndex && week.status === 'draft').length + 1,
          )
          : state.completedWeeks,
        failedWeekIndexes: next.status === 'error'
          ? Array.from(new Set([...state.failedWeekIndexes, next.weekIndex])).sort((a, b) => a - b)
          : state.failedWeekIndexes.filter((index) => index !== next.weekIndex),
        streamingTextByWeekIndex: next.status === 'generating'
          ? { ...state.streamingTextByWeekIndex, [next.weekIndex]: state.streamingTextByWeekIndex[next.weekIndex] ?? '' }
          : { ...state.streamingTextByWeekIndex, [next.weekIndex]: '' },
      }))
    }),
    onError: guarded((message: string) => {
      const state = get()
      set({ status: state.plan ? toBuilderStatus(state.plan.generationState) : 'error', lastError: message })
    }),
  }
}

export const usePlanBuilderStore = create<PlanBuilderState>((set, get) => ({
  plan: null,
  weeks: [],
  issues: [],
  status: 'idle',
  currentWeekIndex: null,
  completedWeeks: 0,
  failedWeekIndexes: [],
  streamingTextByWeekIndex: {},
  generationJob: null,
  lastError: null,
  entitlementOffer: null,
  recalibrationNotice: null,

  resetBuilderState: () => {
    generationPollingController?.abort()
    generationPollingController = null
    set({
      plan: null,
      weeks: [],
      issues: [],
      status: 'idle',
      currentWeekIndex: null,
      completedWeeks: 0,
      failedWeekIndexes: [],
      streamingTextByWeekIndex: {},
      generationJob: null,
      lastError: null,
      entitlementOffer: null,
      recalibrationNotice: null,
    })
  },

  resetForAthleteSwitch: () => {
    get().resetBuilderState()
  },

  createDraft: async ({ profile, wizardConfig }) => {
    const switchEpochAtStart = getSwitchEpoch()
    set({ status: 'shelling', lastError: null, issues: [], entitlementOffer: null })
    try {
      const previousPlan = get().plan
      const goalEvent = getPrimaryGoalEvent(profile)
      if (!goalEvent) throw new Error('Falta un evento principal en el perfil para construir el plan.')
      const athleteId = getActiveAthleteId() ?? ATHLETE_PROFILE_LOCAL_ID
      const { plan, weeks } = buildPlanShell({
        athleteId,
        profile,
        wizardConfig,
        goalEvent,
      })
      if (weeks.length === 0) {
        throw new Error(EMPTY_DRAFT_WEEKS_MESSAGE)
      }
      if (previousPlan?.status === 'draft' && previousPlan.id !== plan.id) {
        await db.trainingPlanWeeks.where('planId').equals(previousPlan.id).delete()
        await db.trainingPlans.delete(previousPlan.id)
      }
      await persistPlanState(plan, weeks)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
      set({
        plan,
        weeks,
        status: 'shell_ready',
        currentWeekIndex: null,
        completedWeeks: 0,
        failedWeekIndexes: [],
        streamingTextByWeekIndex: {},
        generationJob: null,
        lastError: null,
        entitlementOffer: null,
      })
    } catch (error) {
      setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
    }
  },

  runGeneration: async (profile, options) => {
    const switchEpochAtStart = getSwitchEpoch()
    const accountUserIdAtStart = useAuthStore.getState().user?.id ?? null
    const stateBeforeAttempt = get()
    const { plan, weeks } = stateBeforeAttempt
    if (!plan) return
    const attemptSnapshot = captureAttemptSnapshot(stateBeforeAttempt)
    set({ entitlementOffer: null })
    if (plan.generationState === 'generating' || get().status === 'generating') {
      startGenerationPolling(plan.id, set, get, switchEpochAtStart)
      return
    }
    if (canUseRemoteGeneration()) {
      const remoteSnapshot = await fetchPlanGenerationSnapshot(plan.id).catch(() => null)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
      if (remoteSnapshot && options?.forceNew) {
        // Incluso forzando una generación nueva, nunca pisar un worker remoto vivo:
        // reiniciarlo borraría su jobId y el dedupe del backend dejaría de verlo,
        // habilitando dos workers en paralelo (doble costo).
        if (isActivePlanGeneration(remoteSnapshot.plan, Date.now())) {
          applyGenerationSnapshot(remoteSnapshot, set)
          startGenerationPolling(remoteSnapshot.plan.id, set, get, switchEpochAtStart)
          return
        }
      } else if (
        remoteSnapshot &&
        shouldResumeRemoteGenerationSnapshot(remoteSnapshot)
      ) {
        applyGenerationSnapshot(remoteSnapshot, set)
        if (!remoteSnapshot.isTerminal && !remoteSnapshot.isStalled) {
          startGenerationPolling(remoteSnapshot.plan.id, set, get, switchEpochAtStart)
        }
        return
      }
    }
    const resetWeeks = resetWeeksForFullGeneration(weeks)
    const targetWeekIndexes = resetWeeks.map((week) => week.weekIndex)
    const useRemoteGeneration = canUseRemoteGeneration()
    if (useRemoteGeneration) {
      const canStart = await guardRemotePlanBuilderRateLimit(targetWeekIndexes, set, switchEpochAtStart)
      if (!canStart) return
    }

    const startedAt = Date.now()
    const strategy = resolveConfiguredGenerationStrategy(plan.totalWeeks, 'single')
    const nextPlan: TrainingPlan = {
      ...plan,
      generationState: 'generating',
      updatedAt: startedAt,
      generationSummary: {
        startedAt,
        strategy,
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
        heartbeatAt: startedAt,
      },
    }
    let remotePlanPublished = false
    let reservedRemoteUsage = false
    try {
      await persistPlanState(nextPlan, resetWeeks)
      if (isCurrentSwitchEpoch(switchEpochAtStart)) {
        set({
          plan: nextPlan,
          weeks: resetWeeks,
          generationJob: null,
          status: 'generating',
          lastError: null,
          issues: [],
          completedWeeks: 0,
          failedWeekIndexes: [],
          streamingTextByWeekIndex: {},
        })
      }
      if (!useRemoteGeneration) {
        const job = await createPlanGenerationJob({ plan: nextPlan, weeks: resetWeeks, strategy: 'single' })
        if (isCurrentSwitchEpoch(switchEpochAtStart)) {
          set({ generationJob: job })
        }
        const callbacks = buildRunnerCallbacks(set, get, switchEpochAtStart)
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks,
        }).catch((error) => {
          setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
        })
        return
      }
      await pushTrainingPlan(nextPlan)
      remotePlanPublished = true
      await reservePlanBuilderWeekUsage({ planId: nextPlan.id, weekIndexes: targetWeekIndexes })
      reservedRemoteUsage = true
      const recentContext = await buildPlanBuilderRecentContext(nextPlan).catch(() => undefined)
      await triggerBackgroundGeneration({
        plan: nextPlan,
        weeks: resetWeeks,
        profile,
        wizardConfig: nextPlan.wizardConfig,
        recentContext,
      })
      startGenerationPolling(nextPlan.id, set, get, switchEpochAtStart)
    } catch (error) {
      if (error instanceof PlanEnqueueRejectedError && error.entitlement) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(nextPlan.id, targetWeekIndexes)
        }
        await restoreAfterEntitlementRejection({
          snapshot: attemptSnapshot,
          entitlement: error.entitlement,
          set,
          publishRemote: remotePlanPublished,
          accountUserIdAtStart,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // Cuota/costo/kill switch: rechazo definitivo pero no es una oferta de
      // plan, así que nunca toca entitlementOffer/UpsellCard.
      if (error instanceof PlanEnqueueRejectedError && error.usageRejection) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(nextPlan.id, targetWeekIndexes)
        }
        await markGenerationStartRejected({
          plan: nextPlan,
          weeks: resetWeeks,
          message: USAGE_REJECTION_COPY[error.usageRejection.errorCode],
          set,
          publishRemote: remotePlanPublished,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // A definitive start failure means the worker never started: surface it
      // instead of resuming into a poll that can only end in a stalled state.
      if (error instanceof PlanEnqueueRejectedError || !remotePlanPublished) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(nextPlan.id, targetWeekIndexes)
        }
        const msg = error instanceof Error ? error.message : String(error)
        await markGenerationStartRejected({
          plan: nextPlan,
          weeks: resetWeeks,
          message: msg,
          set,
          publishRemote: remotePlanPublished,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      if (canUseRemoteGeneration() && remotePlanPublished) {
        console.warn('[plan-builder] remote generation confirmation lost; keeping plan in background mode', error)
        const resumed = await resumeUncertainRemoteGeneration(nextPlan.id, set, get, switchEpochAtStart)
        if (resumed) return
      }
      setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
    }
  },

  retryFullGeneration: async (profile) => {
    const { plan } = get()
    if (!plan) return
    await get().runGeneration(profile, { forceNew: true })
  },

  regenerateWeek: async (weekIndex, profile, repairInstruction) => {
    await get().regenerateWeeks(
      [weekIndex],
      profile,
      repairInstruction ? { [weekIndex]: repairInstruction } : undefined,
    )
  },

  regenerateWeeks: async (weekIndexes, profile, repairInstructions) => {
    const switchEpochAtStart = getSwitchEpoch()
    const accountUserIdAtStart = useAuthStore.getState().user?.id ?? null
    const stateBeforeAttempt = get()
    const { plan, weeks } = stateBeforeAttempt
    if (!plan) return
    const targetSet = new Set(weekIndexes)
    if (targetSet.size === 0) return
    const targets = weeks.filter((w) => targetSet.has(w.weekIndex))
    if (targets.length === 0) return
    const attemptSnapshot = captureAttemptSnapshot(stateBeforeAttempt)
    set({ entitlementOffer: null })
    const targetWeekIndexes = targets.map((week) => week.weekIndex)
    const useRemoteGeneration = canUseRemoteGeneration()
    if (useRemoteGeneration) {
      const canStart = await guardRemotePlanBuilderRateLimit(targetWeekIndexes, set, switchEpochAtStart)
      if (!canStart) return
    }

    const updatedAt = Date.now()
    const nextWeeks = weeks.map((week) => (targetSet.has(week.weekIndex)
      ? {
        ...week,
        status: 'pending' as const,
        sessions: [],
        validationIssues: [],
        generationMeta: { attempts: 0 },
        regenerationMeta: {
          attempts: (week.regenerationMeta?.attempts ?? 0) + 1,
          lastRegeneratedAt: updatedAt,
          previousFallbackUsed: week.generationMeta.fallbackUsed,
        },
        updatedAt,
      }
      : week))
    const generatingPlan = buildRetriggerPlan(plan, nextWeeks, updatedAt)
    const firstWeekIndex = targets[0]?.weekIndex ?? null
    set({
      plan: generatingPlan,
      weeks: nextWeeks,
      status: 'generating',
      lastError: null,
      currentWeekIndex: firstWeekIndex,
      streamingTextByWeekIndex: {
        ...get().streamingTextByWeekIndex,
        ...Object.fromEntries(targets.map((week) => [week.weekIndex, ''])),
      },
    })
    let remotePlanPublished = false
    let reservedRemoteUsage = false
    try {
      await db.trainingPlans.put(generatingPlan)
      await db.trainingPlanWeeks.bulkPut(nextWeeks)
      if (!useRemoteGeneration) {
        const job = await createPlanGenerationJob({
          plan: generatingPlan,
          weeks: nextWeeks,
          targetWeekIndexes,
          strategy: 'single',
          repairInstructions,
        })
        if (isCurrentSwitchEpoch(switchEpochAtStart)) {
          set({
            generationJob: job,
            completedWeeks: countReadyWeeks(nextWeeks),
            failedWeekIndexes: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
          })
        }
        const callbacks = buildRunnerCallbacks(set, get, switchEpochAtStart)
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks,
        }).catch((error) => {
          setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
        })
        return
      }
      await pushTrainingPlan(generatingPlan)
      remotePlanPublished = true
      await reservePlanBuilderWeekUsage({ planId: generatingPlan.id, weekIndexes: targetWeekIndexes })
      reservedRemoteUsage = true
      const recentContext = await buildPlanBuilderRecentContext(generatingPlan).catch(() => undefined)
      await triggerBackgroundGeneration({
        plan: generatingPlan,
        weeks: nextWeeks,
        profile,
        wizardConfig: generatingPlan.wizardConfig,
        recentContext,
        targetWeekIndexes,
        repairInstructions,
      })
      if (isCurrentSwitchEpoch(switchEpochAtStart)) {
        set({
          generationJob: null,
          completedWeeks: countReadyWeeks(nextWeeks),
          failedWeekIndexes: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
        })
      }
      startGenerationPolling(generatingPlan.id, set, get, switchEpochAtStart)
    } catch (error) {
      if (error instanceof PlanEnqueueRejectedError && error.entitlement) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, targetWeekIndexes)
        }
        await restoreAfterEntitlementRejection({
          snapshot: attemptSnapshot,
          entitlement: error.entitlement,
          set,
          publishRemote: remotePlanPublished,
          accountUserIdAtStart,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // Cuota/costo/kill switch: rechazo definitivo pero no es una oferta de
      // plan, así que nunca toca entitlementOffer/UpsellCard.
      if (error instanceof PlanEnqueueRejectedError && error.usageRejection) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, targetWeekIndexes)
        }
        await markGenerationStartRejected({
          plan: generatingPlan,
          weeks: nextWeeks,
          message: USAGE_REJECTION_COPY[error.usageRejection.errorCode],
          set,
          publishRemote: remotePlanPublished,
          failedWeekIndexes: targetWeekIndexes,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // A definitive start failure means the worker never started: surface it
      // instead of resuming into a poll that can only end in a stalled state.
      if (error instanceof PlanEnqueueRejectedError || !remotePlanPublished) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, targetWeekIndexes)
        }
        const msg = error instanceof Error ? error.message : String(error)
        await markGenerationStartRejected({
          plan: generatingPlan,
          weeks: nextWeeks,
          message: msg,
          set,
          publishRemote: remotePlanPublished,
          failedWeekIndexes: targetWeekIndexes,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      if (canUseRemoteGeneration() && remotePlanPublished) {
        console.warn('[plan-builder] remote regeneration confirmation lost; keeping plan in background mode', error)
        const resumed = await resumeUncertainRemoteGeneration(generatingPlan.id, set, get, switchEpochAtStart)
        if (resumed) return
      }
      setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
    }
  },

  /**
   * Regenera las semanas futuras de un plan EN CURSO usando los datos reales
   * de las semanas ya vividas, y luego reconcilia el calendario materializado
   * (Step 3b: ver `reconcileRecalibratedWeeks` en `commitPlan.ts`).
   *
   * Es la única ruta del proyecto donde la generación ocurre después de que
   * el atleta vivió parte del plan; el resto genera todo en borrador, antes
   * de empezar. Por eso es la única acción que pasa `asOfDate` a
   * `buildPlanBuilderRecentContext` y la única que necesita reconciliar
   * sesiones ya materializadas al terminar.
   *
   * Deriva de `regenerateWeeks` de arriba y conserva sus mismos guards de
   * rate limit, reserva/liberación de cuota, `switchEpoch` y la rama local
   * contra remota. Si `regenerateWeeks` cambia, revisar ésta. No se extrajo
   * un helper común porque las dos únicas piezas verdaderamente compartidas
   * (el guard de rate limit y `releaseReservedRemoteUsage`) ya son funciones
   * de módulo reutilizadas tal cual; el resto del cuerpo diverge en los
   * targets, en `recentContext`, en no pasar `repairInstructions` y en la
   * reconciliación posterior, que `regenerateWeeks` no tiene.
   */
  recalibrateRemainingWeeks: async (profile) => {
    const switchEpochAtStart = getSwitchEpoch()
    const accountUserIdAtStart = useAuthStore.getState().user?.id ?? null
    const stateBeforeAttempt = get()
    const { plan, weeks } = stateBeforeAttempt
    if (!plan || stateBeforeAttempt.status === 'generating' || stateBeforeAttempt.status === 'committing') return

    // Diferencia 1: los targets vienen de la selección determinista, no de un
    // argumento del caller.
    const target = selectRecalibrationTargets({ plan, weeks, todayISO: todayISO() })
    if (!target) return
    const targetWeekIndexes = target.weekIndexes
    const targetSet = new Set(targetWeekIndexes)
    const targets = weeks.filter((w) => targetSet.has(w.weekIndex))
    if (targets.length === 0) return

    const attemptSnapshot = captureAttemptSnapshot(stateBeforeAttempt)
    set({ entitlementOffer: null, recalibrationNotice: null })
    const useRemoteGeneration = canUseRemoteGeneration()
    if (useRemoteGeneration) {
      const canStart = await guardRemotePlanBuilderRateLimit(targetWeekIndexes, set, switchEpochAtStart)
      if (!canStart) return
    }

    if (!isCurrentSwitchEpoch(switchEpochAtStart) || get().plan?.id !== plan.id || get().status === 'generating') return
    const updatedAt = Date.now()
    const nextWeeks = weeks.map((week) => (targetSet.has(week.weekIndex)
      ? {
        ...week,
        status: 'pending' as const,
        sessions: [],
        validationIssues: [],
        generationMeta: { attempts: 0 },
        regenerationMeta: {
          attempts: (week.regenerationMeta?.attempts ?? 0) + 1,
          lastRegeneratedAt: updatedAt,
          previousFallbackUsed: week.generationMeta.fallbackUsed,
        },
        updatedAt,
      }
      : week))
    // Important 2 (fix de revisión): marcador durable ANTES de disparar la
    // generación. Si esta pestaña se cierra antes de que el polling termine,
    // `recoverPendingRecalibrationIfTerminal` (en `loadDraft`) es la red de
    // seguridad que reconcilia el calendario en una carga posterior.
    const generatingPlan: TrainingPlan = {
      ...buildRetriggerPlan(plan, nextWeeks, updatedAt),
      pendingRecalibration: { weekIndexes: targetWeekIndexes, requestedAt: updatedAt },
    }
    const firstWeekIndex = targets[0]?.weekIndex ?? null
    set({
      plan: generatingPlan,
      weeks: nextWeeks,
      status: 'generating',
      lastError: null,
      currentWeekIndex: firstWeekIndex,
      streamingTextByWeekIndex: {
        ...get().streamingTextByWeekIndex,
        ...Object.fromEntries(targets.map((week) => [week.weekIndex, ''])),
      },
    })
    let remotePlanPublished = false
    let reservedRemoteUsage = false
    try {
      await db.trainingPlans.put(generatingPlan)
      await db.trainingPlanWeeks.bulkPut(nextWeeks)
      if (!useRemoteGeneration) {
        const job = await createPlanGenerationJob({
          plan: generatingPlan,
          weeks: nextWeeks,
          targetWeekIndexes,
          strategy: 'single',
        })
        if (isCurrentSwitchEpoch(switchEpochAtStart)) {
          set({
            generationJob: job,
            completedWeeks: countReadyWeeks(nextWeeks),
            failedWeekIndexes: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
          })
        }
        const callbacks = buildRunnerCallbacks(set, get, switchEpochAtStart)
        // A diferencia de `regenerateWeeks`, encadenamos la reconciliación al
        // fin de la corrida local en vez de sólo capturar el error: sin esto
        // el camino de dev sin Supabase nunca reconciliaría el calendario.
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks,
        }).then(async () => {
          if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
          const latestState = get()
          if (!latestState.plan || latestState.plan.id !== generatingPlan.id) return
          await reconcileAfterRecalibration(
            set,
            get,
            switchEpochAtStart,
            latestState.plan,
            latestState.weeks,
            target,
            profile,
          )
        }).catch((error) => {
          setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
        })
        return
      }
      await pushTrainingPlan(generatingPlan)
      remotePlanPublished = true
      await reservePlanBuilderWeekUsage({ planId: generatingPlan.id, weekIndexes: targetWeekIndexes })
      reservedRemoteUsage = true
      // Diferencia 2: contexto reciente anclado a hoy (`asOfDate`), no al
      // inicio del plan — así el lookback alcanza las semanas ya vividas.
      const recentContext = await buildPlanBuilderRecentContext(generatingPlan, undefined, {
        asOfDate: target.asOfDate,
      }).catch(() => undefined)
      // Diferencia 3: no se pasan `repairInstructions`; esto no es una
      // reparación de calidad, es una recalibración por datos nuevos.
      await triggerBackgroundGeneration({
        plan: generatingPlan,
        weeks: nextWeeks,
        profile,
        wizardConfig: generatingPlan.wizardConfig,
        recentContext,
        targetWeekIndexes,
      })
      if (isCurrentSwitchEpoch(switchEpochAtStart)) {
        set({
          generationJob: null,
          completedWeeks: countReadyWeeks(nextWeeks),
          failedWeekIndexes: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
        })
      }
      // Step 3b: reconciliar el calendario recién DESPUÉS de que el polling
      // termine en un snapshot terminal — nunca antes, para no escribir
      // contenido a medias de semanas todavía en `generating`.
      startGenerationPolling(generatingPlan.id, set, get, switchEpochAtStart, async (snapshot) => {
        await reconcileAfterRecalibration(set, get, switchEpochAtStart, snapshot.plan, snapshot.weeks, target, profile)
      })
    } catch (error) {
      if (error instanceof PlanEnqueueRejectedError && error.entitlement) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, targetWeekIndexes)
        }
        await restoreAfterEntitlementRejection({
          snapshot: attemptSnapshot,
          entitlement: error.entitlement,
          set,
          publishRemote: remotePlanPublished,
          accountUserIdAtStart,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // Cuota/costo/kill switch: rechazo definitivo pero no es una oferta de
      // plan, así que nunca toca entitlementOffer/UpsellCard.
      if (error instanceof PlanEnqueueRejectedError && error.usageRejection) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, targetWeekIndexes)
        }
        await markGenerationStartRejected({
          plan: generatingPlan,
          weeks: nextWeeks,
          message: USAGE_REJECTION_COPY[error.usageRejection.errorCode],
          set,
          publishRemote: remotePlanPublished,
          failedWeekIndexes: targetWeekIndexes,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // A definitive start failure means the worker never started: surface it
      // instead of resuming into a poll that can only end in a stalled state.
      if (error instanceof PlanEnqueueRejectedError || !remotePlanPublished) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, targetWeekIndexes)
        }
        const msg = error instanceof Error ? error.message : String(error)
        await markGenerationStartRejected({
          plan: generatingPlan,
          weeks: nextWeeks,
          message: msg,
          set,
          publishRemote: remotePlanPublished,
          failedWeekIndexes: targetWeekIndexes,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      if (canUseRemoteGeneration() && remotePlanPublished) {
        console.warn('[plan-builder] remote recalibration confirmation lost; keeping plan in background mode', error)
        const resumed = await resumeUncertainRemoteGeneration(generatingPlan.id, set, get, switchEpochAtStart)
        if (resumed) return
      }
      setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
    }
  },

  retryFailedWeeks: async (profile) => {
    const switchEpochAtStart = getSwitchEpoch()
    const accountUserIdAtStart = useAuthStore.getState().user?.id ?? null
    const stateBeforeAttempt = get()
    const { plan, weeks, failedWeekIndexes } = stateBeforeAttempt
    if (!plan || failedWeekIndexes.length === 0) return
    const attemptSnapshot = captureAttemptSnapshot(stateBeforeAttempt)
    set({ entitlementOffer: null })
    const useRemoteGeneration = canUseRemoteGeneration()
    if (useRemoteGeneration) {
      const canStart = await guardRemotePlanBuilderRateLimit(failedWeekIndexes, set, switchEpochAtStart)
      if (!canStart) return
    }

    const updatedAt = Date.now()
    const failedSet = new Set(failedWeekIndexes)
    const nextWeeks = weeks.map((week) => (failedSet.has(week.weekIndex)
      ? {
        ...week,
        status: 'pending' as const,
        sessions: [],
        validationIssues: [],
        generationMeta: { attempts: 0 },
        updatedAt,
      }
      : week))
    const generatingPlan = buildRetriggerPlan(plan, nextWeeks, updatedAt)
    let remotePlanPublished = false
    let reservedRemoteUsage = false
    try {
      await persistPlanState(generatingPlan, nextWeeks)
      if (!useRemoteGeneration) {
        const job = await createPlanGenerationJob({
          plan: generatingPlan,
          weeks: nextWeeks,
          targetWeekIndexes: failedWeekIndexes,
          strategy: 'single',
        })
        if (isCurrentSwitchEpoch(switchEpochAtStart)) {
          set({
            plan: generatingPlan,
            weeks: nextWeeks,
            generationJob: job,
            status: 'generating',
            currentWeekIndex: failedWeekIndexes[0] ?? null,
            completedWeeks: countReadyWeeks(nextWeeks),
            failedWeekIndexes: [],
            streamingTextByWeekIndex: {},
            lastError: null,
          })
        }
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks: buildRunnerCallbacks(set, get, switchEpochAtStart),
        }).catch((error) => {
          setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
        })
        return
      }
      await pushTrainingPlan(generatingPlan)
      remotePlanPublished = true
      await reservePlanBuilderWeekUsage({ planId: generatingPlan.id, weekIndexes: failedWeekIndexes })
      reservedRemoteUsage = true
      const recentContext = await buildPlanBuilderRecentContext(generatingPlan).catch(() => undefined)
      await triggerBackgroundGeneration({
        plan: generatingPlan,
        weeks: nextWeeks,
        profile,
        wizardConfig: generatingPlan.wizardConfig,
        recentContext,
        targetWeekIndexes: failedWeekIndexes,
      })
      if (isCurrentSwitchEpoch(switchEpochAtStart)) {
        set({
          plan: generatingPlan,
          weeks: nextWeeks,
          generationJob: null,
          status: 'generating',
          currentWeekIndex: failedWeekIndexes[0] ?? null,
          completedWeeks: countReadyWeeks(nextWeeks),
          failedWeekIndexes: [],
          streamingTextByWeekIndex: {},
          lastError: null,
        })
      }
      startGenerationPolling(generatingPlan.id, set, get, switchEpochAtStart)
    } catch (error) {
      if (error instanceof PlanEnqueueRejectedError && error.entitlement) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, failedWeekIndexes)
        }
        await restoreAfterEntitlementRejection({
          snapshot: attemptSnapshot,
          entitlement: error.entitlement,
          set,
          publishRemote: remotePlanPublished,
          accountUserIdAtStart,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // Cuota/costo/kill switch: rechazo definitivo pero no es una oferta de
      // plan, así que nunca toca entitlementOffer/UpsellCard.
      if (error instanceof PlanEnqueueRejectedError && error.usageRejection) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, failedWeekIndexes)
        }
        await markGenerationStartRejected({
          plan: generatingPlan,
          weeks: nextWeeks,
          message: USAGE_REJECTION_COPY[error.usageRejection.errorCode],
          set,
          publishRemote: remotePlanPublished,
          failedWeekIndexes,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      // A definitive start failure means the worker never started: surface it
      // instead of resuming into a poll that can only end in a stalled state.
      if (error instanceof PlanEnqueueRejectedError || !remotePlanPublished) {
        if (reservedRemoteUsage) {
          await releaseReservedRemoteUsage(generatingPlan.id, failedWeekIndexes)
        }
        const msg = error instanceof Error ? error.message : String(error)
        await markGenerationStartRejected({
          plan: generatingPlan,
          weeks: nextWeeks,
          message: msg,
          set,
          publishRemote: remotePlanPublished,
          failedWeekIndexes,
          epochAtStart: switchEpochAtStart,
        })
        return
      }
      if (canUseRemoteGeneration() && remotePlanPublished) {
        console.warn('[plan-builder] remote retry confirmation lost; keeping plan in background mode', error)
        const resumed = await resumeUncertainRemoteGeneration(generatingPlan.id, set, get, switchEpochAtStart)
        if (resumed) return
      }
      setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
    }
  },

  retryIncompleteWeeks: async (profile) => {
    const { plan, weeks } = get()
    if (!plan) return
    const incompleteIndexes = weeks
      .filter((week) => !isReadyWeek(week))
      .map((week) => week.weekIndex)
    if (incompleteIndexes.length === 0) return
    await get().regenerateWeeks(incompleteIndexes, profile)
  },

  resumeGenerationJobs: async (profile) => {
    const switchEpochAtStart = getSwitchEpoch()
    set({ entitlementOffer: null })
    try {
      const jobs = await getRunnablePlanGenerationJobs(profile.id)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
      if (jobs.length === 0) return
      for (const job of jobs) {
        const plan = await db.trainingPlans.get(job.planId)
        if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
        if (!plan || plan.status !== 'draft') continue
        const weeks = sortWeeks(await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray())
        if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
        set({
          plan,
          weeks,
          generationJob: job,
          status: 'generating',
          currentWeekIndex: job.currentWeekIndex,
          completedWeeks: job.completedWeeks,
          failedWeekIndexes: job.failedWeekIndexes,
          lastError: null,
        })
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks: buildRunnerCallbacks(set, get, switchEpochAtStart),
        }).catch((error) => {
          setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
        })
      }
    } catch (error) {
      setErrorIfCurrentSwitchEpoch(set, switchEpochAtStart, error)
    }
  },

  cancelGeneration: async () => {
    const switchEpochAtStart = getSwitchEpoch()
    const { plan } = get()
    if (!plan || plan.generationState !== 'generating') return
    set({ entitlementOffer: null })

    // Detener el poller inmediatamente — evita que onSnapshot sobreescriba tras el abort
    generationPollingController?.abort()
    generationPollingController = null

    const updatedAt = Date.now()
    const nextPlan: TrainingPlan = {
      ...plan,
      generationState: 'cancelled',
      updatedAt,
      generationSummary: {
        ...(plan.generationSummary ?? {
          startedAt: updatedAt,
          strategy: 'single' as const,
          completedWeeks: get().completedWeeks,
          failedWeeks: get().failedWeekIndexes,
          totalAttempts: 0,
        }),
        cancelRequested: true,
        heartbeatAt: plan.generationSummary?.heartbeatAt ?? updatedAt,
      },
    }
    try {
      await db.trainingPlans.put(nextPlan)
      await pushTrainingPlan(nextPlan)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
      set({
        plan: nextPlan,
        status: 'cancelled',
        lastError: 'Preparación detenida. Las semanas ya listas se conservan.',
      })
    } catch (error) {
      if (isCurrentSwitchEpoch(switchEpochAtStart)) {
        set({ lastError: errorMessage(error) })
      }
    }
  },

  acceptPlan: async () => {
    const switchEpochAtStart = getSwitchEpoch()
    const { plan, weeks } = get()
    if (!plan) return { errors: ['No hay plan activo'], warnings: [], acceptedWeeks: [], lifecycleRemovedSessionCount: 0 }
    set({ entitlementOffer: null })
    if (plan.generationState !== 'complete') {
      const message = 'El plan todavía no está completamente preparado. Completa la preparación antes de aceptarlo.'
      set({ status: toBuilderStatus(plan.generationState), lastError: message })
      return { errors: [message], warnings: [], acceptedWeeks: [], lifecycleRemovedSessionCount: 0 }
    }
    set({ status: 'committing', lastError: null })
    const acceptedPlan: TrainingPlan = {
      ...plan,
      generationSummary: plan.generationSummary
        ? {
          ...plan.generationSummary,
          acceptedAt: Date.now(),
        }
        : undefined,
    }
    const result = await commitPlan(acceptedPlan, weeks)
    if (!isCurrentSwitchEpoch(switchEpochAtStart)) return result
    if (result.errors.length === 0) {
      const fresh = await db.trainingPlans.get(plan.id)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return result
      const freshWeeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return result
      set({ plan: fresh ?? plan, weeks: freshWeeks.sort((a, b) => a.weekIndex - b.weekIndex), generationJob: null, status: 'done' })
    } else {
      set({ status: toBuilderStatus(plan.generationState), lastError: result.errors.join(' · ') })
    }
    return result
  },

  discard: async () => {
    const switchEpochAtStart = getSwitchEpoch()
    const { plan } = get()
    generationPollingController?.abort()
    generationPollingController = null
    if (plan) {
      console.info('[plan-builder] discard', {
        planId: plan.id,
        generationSummary: {
          ...plan.generationSummary,
          discardedAt: Date.now(),
        },
      })
      await db.trainingPlanWeeks.where('planId').equals(plan.id).delete()
      await db.trainingPlans.delete(plan.id)
      await db.planGenerationJobs.where('planId').equals(plan.id).delete()
    }
    if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
    set({
      plan: null,
      weeks: [],
      issues: [],
      status: 'idle',
      currentWeekIndex: null,
      completedWeeks: 0,
      failedWeekIndexes: [],
      streamingTextByWeekIndex: {},
      generationJob: null,
      lastError: null,
      entitlementOffer: null,
    })
  },

  loadDraft: async (planId) => {
    const switchEpochAtStart = getSwitchEpoch()
    set({ entitlementOffer: null })
    let plan = await db.trainingPlans.get(planId)
    if (!isCurrentSwitchEpoch(switchEpochAtStart)) return

    // Important 2 (fix de revisión): red de seguridad para una recalibración
    // cuya pestaña se cerró antes de que el polling terminara. Corre con la
    // PRIMERA lectura local, antes de que el refresh remoto de abajo pueda
    // reemplazar este `plan` en Dexie por una versión sin el marcador — el
    // campo es local-only (ver su JSDoc), así que este es el único punto
    // donde todavía es visible de forma confiable.
    if (plan?.pendingRecalibration) {
      const localWeeks = await db.trainingPlanWeeks.where('planId').equals(planId).toArray()
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
      await recoverPendingRecalibrationIfTerminal(set, get, switchEpochAtStart, plan, localWeeks)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
      // Releer: si acabamos de reconciliar y limpiar, que el resto de
      // `loadDraft` vea el plan ya sin el marcador.
      plan = await db.trainingPlans.get(planId)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
    }

    if (supabase && (!plan || plan.generationState === 'shell' || plan.generationState === 'generating')) {
      const remoteSnapshot = await fetchPlanGenerationSnapshot(planId).catch(() => null)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
      if (remoteSnapshot) {
        applyGenerationSnapshot(remoteSnapshot, set)
        await recoverPendingRecalibrationIfTerminal(set, get, switchEpochAtStart, remoteSnapshot.plan, remoteSnapshot.weeks)
        if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
        if (remoteSnapshot.plan.generationState === 'generating') {
          startGenerationPolling(remoteSnapshot.plan.id, set, get, switchEpochAtStart)
        }
        return
      }
      plan = await db.trainingPlans.get(planId)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
    }

    if (!plan) {
      set({ status: 'error', lastError: 'Plan no encontrado' })
      return
    }
    const weeks = await db.trainingPlanWeeks.where('planId').equals(planId).toArray()
    if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
    weeks.sort((a, b) => a.weekIndex - b.weekIndex)
    if (plan.status === 'draft' && plan.generationState === 'shell' && weeks.length === 0) {
      set({
        plan,
        weeks: [],
        issues: [],
        status: 'error',
        currentWeekIndex: null,
        completedWeeks: 0,
        failedWeekIndexes: [],
        streamingTextByWeekIndex: {},
        lastError: EMPTY_DRAFT_WEEKS_MESSAGE,
        entitlementOffer: null,
      })
      return
    }
    const normalizedPlan = normalizePlanGenerationState(plan, weeks)
    if (normalizedPlan.generationState !== plan.generationState) {
      await db.trainingPlans.put(normalizedPlan)
      if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
    }
    const generationJob = await getLatestPlanGenerationJob(planId)
    if (!isCurrentSwitchEpoch(switchEpochAtStart)) return
    const jobIsActive = generationJob?.status === 'queued' || generationJob?.status === 'running'
    const issues = validatePlan({ plan: normalizedPlan, weeks })
    const failedWeekIndexes = weeks.filter((week) => week.status === 'error').map((week) => week.weekIndex)
    // El error preservado sólo vale si pertenece al plan que se está cargando
    // —lo usa el aviso de reconciliación de una recalibración—. El store es un
    // singleton, así que sin esta condición abrir otro borrador sano hereda el
    // error del plan anterior.
    const carriedError = get().plan?.id === normalizedPlan.id ? get().lastError : null
    set({
      plan: normalizedPlan,
      weeks,
      issues,
      generationJob,
      status: jobIsActive ? 'generating' : toBuilderStatus(normalizedPlan.generationState),
      currentWeekIndex: jobIsActive ? generationJob.currentWeekIndex : null,
      completedWeeks: jobIsActive ? generationJob.completedWeeks : countReadyWeeks(weeks),
      failedWeekIndexes: jobIsActive ? generationJob.failedWeekIndexes : failedWeekIndexes,
      streamingTextByWeekIndex: {},
      lastError: jobIsActive ? null : carriedError ?? buildGenerationFailureMessage(failedWeekIndexes),
      entitlementOffer: null,
    })
    if (normalizedPlan.generationState === 'generating') {
      startGenerationPolling(normalizedPlan.id, set, get, switchEpochAtStart)
    }
  },
}))
