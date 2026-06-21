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
import { commitPlan } from '../services/planBuilder/commitPlan'
import { getPrimaryGoalEvent } from '../services/macroPlan'
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
import { PlanEnqueueRejectedError, triggerBackgroundGeneration } from '../services/planBuilder/triggerBackgroundGeneration'
import {
  assertPlanBuilderWeekRateLimit,
  releasePlanBuilderWeekReservations,
  reservePlanBuilderWeekUsage,
  syncPlanBuilderWeekUsageFromWeeks,
} from '../services/planBuilder/rateLimit'
import { pushTrainingPlan } from '../services/syncService'
import { supabase } from '../services/auth'
import { useAuthStore } from './useAuthStore'

const EMPTY_DRAFT_WEEKS_MESSAGE = 'El draft del Plan Builder no tiene semanas. Descártalo y vuelve a generar el shell desde el wizard.'

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

  createDraft: (input: { profile: AthleteProfile; wizardConfig: PlanWizardConfig }) => Promise<void>
  runGeneration: (profile: AthleteProfile, options?: { forceNew?: boolean }) => Promise<void>
  retryFullGeneration: (profile: AthleteProfile) => Promise<void>
  regenerateWeek: (weekIndex: number, profile: AthleteProfile, repairInstruction?: string) => Promise<void>
  regenerateWeeks: (weekIndexes: number[], profile: AthleteProfile, repairInstructions?: Record<number, string>) => Promise<void>
  retryFailedWeeks: (profile: AthleteProfile) => Promise<void>
  /** Reintenta solo las semanas sin sesiones listas (pending/error/colgadas), conservando las draft ya generadas. */
  retryIncompleteWeeks: (profile: AthleteProfile) => Promise<void>
  resumeGenerationJobs: (profile: AthleteProfile) => Promise<void>
  cancelGeneration: () => Promise<void>
  acceptPlan: () => Promise<{ errors: string[]; warnings: string[] }>
  discard: () => Promise<void>
  loadDraft: (planId: string) => Promise<void>
}

type PlanBuilderSet = (
  partial: Partial<PlanBuilderState> | ((state: PlanBuilderState) => Partial<PlanBuilderState>),
) => void

let generationPollingController: AbortController | null = null

async function persistPlanState(plan: TrainingPlan, weeks: TrainingPlanWeek[]) {
  await db.trainingPlans.put(plan)
  await db.trainingPlanWeeks.bulkPut(weeks)
}

function buildGenerationFailureMessage(failedWeekIndexes: number[]): string | null {
  if (failedWeekIndexes.length === 0) return null
  if (failedWeekIndexes.length === 1) {
    return `No se pudo generar la semana ${failedWeekIndexes[0] + 1}. Regénérala para continuar.`
  }
  return `No se pudieron generar ${failedWeekIndexes.length} semanas. Regénéralas para continuar.`
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
    ? 'La generación quedó sin señales de progreso. Puedes reintentar las semanas pendientes.'
    : snapshot.plan.generationState === 'partial' || snapshot.plan.generationState === 'failed'
      ? buildGenerationFailureMessage(failedWeekIndexes)
      : snapshot.plan.generationState === 'cancelled'
        ? 'Generación detenida. Puedes reintentar cuando quieras.'
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
  })
}

function startGenerationPolling(
  planId: string,
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
) {
  generationPollingController?.abort()
  const controller = new AbortController()
  generationPollingController = controller
  void pollPlanGeneration({
    planId,
    signal: controller.signal,
    onSnapshot: (snapshot) => {
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
  }).catch((error) => {
    if (controller.signal.aborted) return
    const msg = error instanceof Error ? error.message : String(error)
    set({ status: 'error', lastError: msg })
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
): Promise<boolean> {
  const remoteSnapshot = await fetchPlanGenerationSnapshot(planId).catch(() => null)
  if (remoteSnapshot) {
    applyGenerationSnapshot(remoteSnapshot, set)
    if (!remoteSnapshot.isTerminal && !remoteSnapshot.isStalled) {
      startGenerationPolling(remoteSnapshot.plan.id, set, get)
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
  startGenerationPolling(planId, set, get)
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

async function guardRemotePlanBuilderRateLimit(
  weekIndexes: readonly number[],
  set: PlanBuilderSet,
): Promise<boolean> {
  try {
    await assertPlanBuilderWeekRateLimit(weekIndexes)
    return true
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
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

function buildRunnerCallbacks(
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
) {
  return {
    onJobUpdate: (job: PlanGenerationJob) => {
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
    },
    onPlanUpdate: (plan: TrainingPlan, weeks: TrainingPlanWeek[]) => {
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
    },
    onWeekUpdate: (next: TrainingPlanWeek) => {
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
    },
    onError: (message: string) => {
      const state = get()
      set({ status: state.plan ? toBuilderStatus(state.plan.generationState) : 'error', lastError: message })
    },
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

  createDraft: async ({ profile, wizardConfig }) => {
    set({ status: 'shelling', lastError: null, issues: [] })
    try {
      const previousPlan = get().plan
      const goalEvent = getPrimaryGoalEvent(profile)
      if (!goalEvent) throw new Error('Falta un evento principal en el perfil para construir el plan.')
      const { plan, weeks } = buildPlanShell({
        athleteId: profile.id,
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
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  runGeneration: async (profile, options) => {
    const { plan, weeks } = get()
    if (!plan) return
    if (plan.generationState === 'generating' || get().status === 'generating') {
      startGenerationPolling(plan.id, set, get)
      return
    }
    if (canUseRemoteGeneration()) {
      const remoteSnapshot = await fetchPlanGenerationSnapshot(plan.id).catch(() => null)
      if (remoteSnapshot && options?.forceNew) {
        // Incluso forzando una generación nueva, nunca pisar un worker remoto vivo:
        // reiniciarlo borraría su jobId y el dedupe del backend dejaría de verlo,
        // habilitando dos workers en paralelo (doble costo).
        if (isActivePlanGeneration(remoteSnapshot.plan, Date.now())) {
          applyGenerationSnapshot(remoteSnapshot, set)
          startGenerationPolling(remoteSnapshot.plan.id, set, get)
          return
        }
      } else if (
        remoteSnapshot &&
        shouldResumeRemoteGenerationSnapshot(remoteSnapshot)
      ) {
        applyGenerationSnapshot(remoteSnapshot, set)
        if (!remoteSnapshot.isTerminal && !remoteSnapshot.isStalled) {
          startGenerationPolling(remoteSnapshot.plan.id, set, get)
        }
        return
      }
    }
    const resetWeeks = resetWeeksForFullGeneration(weeks)
    const targetWeekIndexes = resetWeeks.map((week) => week.weekIndex)
    const useRemoteGeneration = canUseRemoteGeneration()
    if (useRemoteGeneration) {
      const canStart = await guardRemotePlanBuilderRateLimit(targetWeekIndexes, set)
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
      if (!useRemoteGeneration) {
        const job = await createPlanGenerationJob({ plan: nextPlan, weeks: resetWeeks, strategy: 'single' })
        set({ generationJob: job })
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks: buildRunnerCallbacks(set, get),
        }).catch((error) => {
          const msg = error instanceof Error ? error.message : String(error)
          set({ status: 'error', lastError: msg })
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
      startGenerationPolling(nextPlan.id, set, get)
    } catch (error) {
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
        })
        return
      }
      if (canUseRemoteGeneration() && remotePlanPublished) {
        console.warn('[plan-builder] remote generation confirmation lost; keeping plan in background mode', error)
        const resumed = await resumeUncertainRemoteGeneration(nextPlan.id, set, get)
        if (resumed) return
      }
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
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
    const { plan, weeks } = get()
    if (!plan) return
    const targetSet = new Set(weekIndexes)
    if (targetSet.size === 0) return
    const targets = weeks.filter((w) => targetSet.has(w.weekIndex))
    if (targets.length === 0) return
    const targetWeekIndexes = targets.map((week) => week.weekIndex)
    const useRemoteGeneration = canUseRemoteGeneration()
    if (useRemoteGeneration) {
      const canStart = await guardRemotePlanBuilderRateLimit(targetWeekIndexes, set)
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
        set({
          generationJob: job,
          completedWeeks: countReadyWeeks(nextWeeks),
          failedWeekIndexes: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
        })
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks: buildRunnerCallbacks(set, get),
        }).catch((error) => {
          const msg = error instanceof Error ? error.message : String(error)
          set({ status: 'error', lastError: msg })
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
      set({
        generationJob: null,
        completedWeeks: countReadyWeeks(nextWeeks),
        failedWeekIndexes: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
      })
      startGenerationPolling(generatingPlan.id, set, get)
    } catch (error) {
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
        })
        return
      }
      if (canUseRemoteGeneration() && remotePlanPublished) {
        console.warn('[plan-builder] remote regeneration confirmation lost; keeping plan in background mode', error)
        const resumed = await resumeUncertainRemoteGeneration(generatingPlan.id, set, get)
        if (resumed) return
      }
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  retryFailedWeeks: async (profile) => {
    const { plan, weeks, failedWeekIndexes } = get()
    if (!plan || failedWeekIndexes.length === 0) return
    const useRemoteGeneration = canUseRemoteGeneration()
    if (useRemoteGeneration) {
      const canStart = await guardRemotePlanBuilderRateLimit(failedWeekIndexes, set)
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
        void runPlanGenerationJob({
          jobId: job.id,
          profile,
          callbacks: buildRunnerCallbacks(set, get),
        }).catch((error) => {
          const msg = error instanceof Error ? error.message : String(error)
          set({ status: 'error', lastError: msg })
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
      startGenerationPolling(generatingPlan.id, set, get)
    } catch (error) {
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
        })
        return
      }
      if (canUseRemoteGeneration() && remotePlanPublished) {
        console.warn('[plan-builder] remote retry confirmation lost; keeping plan in background mode', error)
        const resumed = await resumeUncertainRemoteGeneration(generatingPlan.id, set, get)
        if (resumed) return
      }
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
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
    try {
      const jobs = await getRunnablePlanGenerationJobs(profile.id)
      if (jobs.length === 0) return
      for (const job of jobs) {
        const plan = await db.trainingPlans.get(job.planId)
        if (!plan || plan.status !== 'draft') continue
        const weeks = sortWeeks(await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray())
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
          callbacks: buildRunnerCallbacks(set, get),
        }).catch((error) => {
          const msg = error instanceof Error ? error.message : String(error)
          set({ status: 'error', lastError: msg })
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  cancelGeneration: async () => {
    const { plan } = get()
    if (!plan || plan.generationState !== 'generating') return

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
      set({
        plan: nextPlan,
        status: 'cancelled',
        lastError: 'Generación detenida. Las semanas ya generadas se conservan.',
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ lastError: msg })
    }
  },

  acceptPlan: async () => {
    const { plan, weeks } = get()
    if (!plan) return { errors: ['No hay plan activo'], warnings: [] }
    if (plan.generationState !== 'complete') {
      const message = 'El plan todavia no esta completamente generado. Completa la generacion antes de aceptarlo.'
      set({ status: toBuilderStatus(plan.generationState), lastError: message })
      return { errors: [message], warnings: [] }
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
    if (result.errors.length === 0) {
      const fresh = await db.trainingPlans.get(plan.id)
      const freshWeeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
      set({ plan: fresh ?? plan, weeks: freshWeeks.sort((a, b) => a.weekIndex - b.weekIndex), generationJob: null, status: 'done' })
    } else {
      set({ status: toBuilderStatus(plan.generationState), lastError: result.errors.join(' · ') })
    }
    return { errors: result.errors, warnings: result.warnings }
  },

  discard: async () => {
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
    })
  },

  loadDraft: async (planId) => {
    let plan = await db.trainingPlans.get(planId)

    if (supabase && (!plan || plan.generationState === 'shell' || plan.generationState === 'generating')) {
      const remoteSnapshot = await fetchPlanGenerationSnapshot(planId).catch(() => null)
      if (remoteSnapshot) {
        applyGenerationSnapshot(remoteSnapshot, set)
        if (remoteSnapshot.plan.generationState === 'generating') {
          startGenerationPolling(remoteSnapshot.plan.id, set, get)
        }
        return
      }
      plan = await db.trainingPlans.get(planId)
    }

    if (!plan) {
      set({ status: 'error', lastError: 'Plan no encontrado' })
      return
    }
    const weeks = await db.trainingPlanWeeks.where('planId').equals(planId).toArray()
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
      })
      return
    }
    const normalizedPlan = normalizePlanGenerationState(plan, weeks)
    if (normalizedPlan.generationState !== plan.generationState) {
      await db.trainingPlans.put(normalizedPlan)
    }
    const generationJob = await getLatestPlanGenerationJob(planId)
    const jobIsActive = generationJob?.status === 'queued' || generationJob?.status === 'running'
    const issues = validatePlan({ plan: normalizedPlan, weeks })
    const failedWeekIndexes = weeks.filter((week) => week.status === 'error').map((week) => week.weekIndex)
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
      lastError: jobIsActive ? null : buildGenerationFailureMessage(failedWeekIndexes),
    })
    if (normalizedPlan.generationState === 'generating') {
      startGenerationPolling(normalizedPlan.id, set, get)
    }
  },
}))
