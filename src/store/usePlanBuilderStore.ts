import { create } from 'zustand'
import type { AthleteProfile, PlanWizardConfig } from '../types'
import type {
  PlanValidationIssue,
  TrainingPlan,
  TrainingPlanWeek,
} from '../types/planBuilder'
import { db } from '../db/db'
import { buildPlanShell } from '../services/planBuilder/buildPlanShell'
import { generatePlanWeeks } from '../services/planBuilder/generatePlan'
import { validatePlan } from '../services/planBuilder/validator'
import { commitPlan } from '../services/planBuilder/commitPlan'
import { getPrimaryGoalEvent } from '../services/macroPlan'
import {
  derivePlanGenerationState,
  resolveConfiguredGenerationStrategy,
} from '../services/planBuilder/generationState'

export type PlanBuilderStatus =
  | 'idle'
  | 'shelling'
  | 'shell_ready'
  | 'generating'
  | 'partial'
  | 'failed'
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
  lastError: string | null

  createDraft: (input: { profile: AthleteProfile; wizardConfig: PlanWizardConfig }) => Promise<void>
  runGeneration: (profile: AthleteProfile) => Promise<void>
  retryFullGeneration: (profile: AthleteProfile) => Promise<void>
  regenerateWeek: (weekIndex: number, profile: AthleteProfile) => Promise<void>
  acceptPlan: () => Promise<{ errors: string[]; warnings: string[] }>
  discard: () => Promise<void>
  loadDraft: (planId: string) => Promise<void>
}

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

function isReadyWeek(week: TrainingPlanWeek): boolean {
  return week.status === 'draft' && week.sessions.length > 0
}

function countReadyWeeks(weeks: TrainingPlanWeek[]): number {
  return weeks.filter(isReadyWeek).length
}

function toBuilderStatus(generationState: TrainingPlan['generationState']): PlanBuilderStatus {
  switch (generationState) {
    case 'shell': return 'shell_ready'
    case 'generating': return 'generating'
    case 'partial': return 'partial'
    case 'failed': return 'failed'
    case 'complete': return 'ready'
  }
}

function normalizePlanGenerationState(plan: TrainingPlan, weeks: TrainingPlanWeek[]): TrainingPlan {
  return {
    ...plan,
    generationState: plan.status === 'active' || plan.status === 'archived'
      ? 'complete'
      : derivePlanGenerationState(weeks),
  }
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

export const usePlanBuilderStore = create<PlanBuilderState>((set, get) => ({
  plan: null,
  weeks: [],
  issues: [],
  status: 'idle',
  currentWeekIndex: null,
  completedWeeks: 0,
  failedWeekIndexes: [],
  streamingTextByWeekIndex: {},
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
        lastError: null,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  runGeneration: async (profile) => {
    const { plan, weeks } = get()
    if (!plan) return
    const startedAt = Date.now()
    const strategy = resolveConfiguredGenerationStrategy(plan.totalWeeks)
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
      },
    }
    try {
      await db.trainingPlans.put(nextPlan)
      set({
        plan: nextPlan,
        status: 'generating',
        lastError: null,
        issues: [],
        completedWeeks: 0,
        failedWeekIndexes: [],
        streamingTextByWeekIndex: {},
      })
      const generatedWeeks = await generatePlanWeeks({
        plan: nextPlan,
        weeks,
        profile,
        wizardConfig: nextPlan.wizardConfig,
        strategy,
        onWeekUpdate: (next) => {
          set((state) => ({
            weeks: state.weeks.map((w) => (w.weekIndex === next.weekIndex ? next : w)),
            currentWeekIndex: next.status === 'generating'
              ? next.weekIndex
              : state.currentWeekIndex === next.weekIndex
                ? null
                : state.currentWeekIndex,
            completedWeeks: next.status === 'draft'
              ? Math.max(
                state.completedWeeks,
                state.weeks.filter((w) => w.weekIndex !== next.weekIndex && w.status === 'draft').length + 1,
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
        onChunk: (weekIndex, chunk) => {
          set((state) => ({
            currentWeekIndex: weekIndex,
            streamingTextByWeekIndex: {
              ...state.streamingTextByWeekIndex,
              [weekIndex]: (state.streamingTextByWeekIndex[weekIndex] ?? '') + chunk,
            },
          }))
        },
      })
      const generatedByIndex = new Map(generatedWeeks.map((week) => [week.weekIndex, week]))
      const nextWeeks = get().weeks.map((week) => generatedByIndex.get(week.weekIndex) ?? week)
      const completedAt = Date.now()
      const generationState = derivePlanGenerationState(nextWeeks)
      const finalPlan: TrainingPlan = {
        ...nextPlan,
        generationState,
        updatedAt: completedAt,
        generationSummary: {
          startedAt,
          completedAt,
          totalDurationMs: completedAt - startedAt,
          strategy,
          completedWeeks: countReadyWeeks(nextWeeks),
          failedWeeks: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
          totalAttempts: nextWeeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
          acceptedAt: nextPlan.generationSummary?.acceptedAt,
          discardedAt: nextPlan.generationSummary?.discardedAt,
        },
      }
      await persistPlanState(finalPlan, nextWeeks)
      const issues = validatePlan({ plan: finalPlan, weeks: nextWeeks })
      const failedWeekIndexes = finalPlan.generationSummary?.failedWeeks ?? []
      set({
        plan: finalPlan,
        weeks: nextWeeks,
        issues,
        status: toBuilderStatus(generationState),
        currentWeekIndex: null,
        completedWeeks: finalPlan.generationSummary?.completedWeeks ?? 0,
        failedWeekIndexes,
        lastError: buildGenerationFailureMessage(failedWeekIndexes),
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  retryFullGeneration: async (profile) => {
    const { plan, weeks } = get()
    if (!plan) return
    const updatedAt = Date.now()
    const resetWeeks = resetWeeksForFullGeneration(weeks)
    const resetPlan: TrainingPlan = {
      ...plan,
      generationState: 'shell',
      updatedAt,
      generationSummary: {
        startedAt: updatedAt,
        strategy: resolveConfiguredGenerationStrategy(plan.totalWeeks),
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
        acceptedAt: plan.generationSummary?.acceptedAt,
        discardedAt: plan.generationSummary?.discardedAt,
      },
    }
    try {
      await persistPlanState(resetPlan, resetWeeks)
      set({
        plan: resetPlan,
        weeks: resetWeeks,
        issues: [],
        status: 'shell_ready',
        currentWeekIndex: null,
        completedWeeks: 0,
        failedWeekIndexes: [],
        streamingTextByWeekIndex: {},
        lastError: null,
      })
      await get().runGeneration(profile)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  regenerateWeek: async (weekIndex, profile) => {
    const { plan, weeks } = get()
    if (!plan) return
    const target = weeks.find((w) => w.weekIndex === weekIndex)
    if (!target) return
    const generatingPlan: TrainingPlan = {
      ...plan,
      generationState: 'generating',
      updatedAt: Date.now(),
    }
    set({
      plan: generatingPlan,
      status: 'generating',
      lastError: null,
      currentWeekIndex: weekIndex,
      streamingTextByWeekIndex: {
        ...get().streamingTextByWeekIndex,
        [weekIndex]: '',
      },
    })
    try {
      await db.trainingPlans.put(generatingPlan)
      const previousWeek = weeks.find((w) => w.weekIndex === weekIndex - 1 && isReadyWeek(w))
      const fresh: TrainingPlanWeek = { ...target, status: 'pending', sessions: [], validationIssues: [], generationMeta: { attempts: 0 } }
      const generatedWeeks = await generatePlanWeeks({
        plan: generatingPlan,
        weeks: [fresh],
        profile,
        wizardConfig: generatingPlan.wizardConfig,
        seedPreviousWeek: previousWeek,
        onWeekUpdate: (next) => {
          set((state) => ({
            weeks: state.weeks.map((w) => (w.weekIndex === next.weekIndex ? next : w)),
            failedWeekIndexes: next.status === 'error'
              ? Array.from(new Set([...state.failedWeekIndexes, next.weekIndex])).sort((a, b) => a - b)
              : state.failedWeekIndexes.filter((index) => index !== next.weekIndex),
            streamingTextByWeekIndex: next.status === 'generating'
              ? { ...state.streamingTextByWeekIndex, [next.weekIndex]: state.streamingTextByWeekIndex[next.weekIndex] ?? '' }
              : { ...state.streamingTextByWeekIndex, [next.weekIndex]: '' },
          }))
        },
        onChunk: (activeWeekIndex, chunk) => {
          set((state) => ({
            currentWeekIndex: activeWeekIndex,
            streamingTextByWeekIndex: {
              ...state.streamingTextByWeekIndex,
              [activeWeekIndex]: (state.streamingTextByWeekIndex[activeWeekIndex] ?? '') + chunk,
            },
          }))
        },
        strategy: 'single',
      })
      const generated = generatedWeeks[0]
      const nextWeeks = get().weeks.map((week) => (generated && week.weekIndex === generated.weekIndex ? generated : week))
      const updatedAt = Date.now()
      const generationState = derivePlanGenerationState(nextWeeks)
      const nextPlan: TrainingPlan = {
        ...generatingPlan,
        generationState,
        updatedAt,
        generationSummary: {
          startedAt: generatingPlan.generationSummary?.startedAt ?? updatedAt,
          completedAt: updatedAt,
          totalDurationMs: generatingPlan.generationSummary?.startedAt ? updatedAt - generatingPlan.generationSummary.startedAt : undefined,
          strategy: generatingPlan.generationSummary?.strategy ?? 'single',
          completedWeeks: countReadyWeeks(nextWeeks),
          failedWeeks: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
          totalAttempts: nextWeeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
          acceptedAt: generatingPlan.generationSummary?.acceptedAt,
          discardedAt: generatingPlan.generationSummary?.discardedAt,
        },
      }
      await persistPlanState(nextPlan, nextWeeks)
      const issues = validatePlan({ plan: nextPlan, weeks: nextWeeks })
      const failedWeekIndexes = nextPlan.generationSummary?.failedWeeks ?? []
      set({
        plan: nextPlan,
        weeks: nextWeeks,
        issues,
        status: toBuilderStatus(generationState),
        currentWeekIndex: null,
        completedWeeks: nextPlan.generationSummary?.completedWeeks ?? 0,
        failedWeekIndexes,
        lastError: buildGenerationFailureMessage(failedWeekIndexes),
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
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
      set({ plan: fresh ?? plan, weeks: freshWeeks.sort((a, b) => a.weekIndex - b.weekIndex), status: 'done' })
    } else {
      set({ status: toBuilderStatus(plan.generationState), lastError: result.errors.join(' · ') })
    }
    return { errors: result.errors, warnings: result.warnings }
  },

  discard: async () => {
    const { plan } = get()
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
      lastError: null,
    })
  },

  loadDraft: async (planId) => {
    const plan = await db.trainingPlans.get(planId)
    if (!plan) {
      set({ status: 'error', lastError: 'Plan no encontrado' })
      return
    }
    const weeks = await db.trainingPlanWeeks.where('planId').equals(planId).toArray()
    weeks.sort((a, b) => a.weekIndex - b.weekIndex)
    const normalizedPlan = normalizePlanGenerationState(plan, weeks)
    if (normalizedPlan.generationState !== plan.generationState) {
      await db.trainingPlans.put(normalizedPlan)
    }
    const issues = validatePlan({ plan: normalizedPlan, weeks })
    const failedWeekIndexes = weeks.filter((week) => week.status === 'error').map((week) => week.weekIndex)
    set({
      plan: normalizedPlan,
      weeks,
      issues,
      status: toBuilderStatus(normalizedPlan.generationState),
      currentWeekIndex: null,
      completedWeeks: countReadyWeeks(weeks),
      failedWeekIndexes,
      streamingTextByWeekIndex: {},
      lastError: buildGenerationFailureMessage(failedWeekIndexes),
    })
  },
}))
