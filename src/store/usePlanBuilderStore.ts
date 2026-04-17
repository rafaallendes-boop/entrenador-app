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

export type PlanBuilderStatus = 'idle' | 'shelling' | 'generating' | 'ready' | 'committing' | 'done' | 'error'

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
  regenerateWeek: (weekIndex: number, profile: AthleteProfile) => Promise<void>
  acceptPlan: () => Promise<{ errors: string[]; warnings: string[] }>
  discard: () => Promise<void>
  loadDraft: (planId: string) => Promise<void>
}

async function persistPlanState(plan: TrainingPlan, weeks: TrainingPlanWeek[]) {
  await db.trainingPlans.put(plan)
  await db.trainingPlanWeeks.bulkPut(weeks)
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
        status: 'ready',
        currentWeekIndex: null,
        completedWeeks: 0,
        failedWeekIndexes: [],
        streamingTextByWeekIndex: {},
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
    const strategy = plan.totalWeeks >= 8 ? 'pairs' : 'single'
    const nextPlan: TrainingPlan = {
      ...plan,
      updatedAt: startedAt,
      generationSummary: {
        startedAt,
        strategy,
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
      },
    }
    set({
      plan: nextPlan,
      status: 'generating',
      lastError: null,
      issues: [],
      completedWeeks: 0,
      failedWeekIndexes: [],
      streamingTextByWeekIndex: {},
    })
    try {
      await generatePlanWeeks({
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
      const nextWeeks = get().weeks
      const completedAt = Date.now()
      const finalPlan: TrainingPlan = {
        ...nextPlan,
        updatedAt: completedAt,
        generationSummary: {
          startedAt,
          completedAt,
          totalDurationMs: completedAt - startedAt,
          strategy,
          completedWeeks: nextWeeks.filter((week) => week.status === 'draft').length,
          failedWeeks: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
          totalAttempts: nextWeeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
          acceptedAt: nextPlan.generationSummary?.acceptedAt,
          discardedAt: nextPlan.generationSummary?.discardedAt,
        },
      }
      await persistPlanState(finalPlan, nextWeeks)
      const issues = validatePlan({ plan, weeks: nextWeeks })
      set({
        plan: finalPlan,
        issues,
        status: 'ready',
        currentWeekIndex: null,
        completedWeeks: finalPlan.generationSummary?.completedWeeks ?? 0,
        failedWeekIndexes: finalPlan.generationSummary?.failedWeeks ?? [],
      })
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
    set({
      status: 'generating',
      lastError: null,
      currentWeekIndex: weekIndex,
      streamingTextByWeekIndex: {
        ...get().streamingTextByWeekIndex,
        [weekIndex]: '',
      },
    })
    try {
      const previousWeek = weeks.find((w) => w.weekIndex === weekIndex - 1 && w.status === 'draft')
      const fresh: TrainingPlanWeek = { ...target, status: 'pending', sessions: [], validationIssues: [] }
      await generatePlanWeeks({
        plan,
        weeks: [fresh],
        profile,
        wizardConfig: plan.wizardConfig,
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
      const nextWeeks = get().weeks
      const updatedAt = Date.now()
      const nextPlan: TrainingPlan = {
        ...plan,
        updatedAt,
        generationSummary: {
          startedAt: plan.generationSummary?.startedAt ?? updatedAt,
          completedAt: updatedAt,
          totalDurationMs: plan.generationSummary?.startedAt ? updatedAt - plan.generationSummary.startedAt : undefined,
          strategy: plan.generationSummary?.strategy ?? 'single',
          completedWeeks: nextWeeks.filter((week) => week.status === 'draft').length,
          failedWeeks: nextWeeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
          totalAttempts: nextWeeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
          acceptedAt: plan.generationSummary?.acceptedAt,
          discardedAt: plan.generationSummary?.discardedAt,
        },
      }
      await persistPlanState(nextPlan, nextWeeks)
      const issues = validatePlan({ plan, weeks: nextWeeks })
      set({
        plan: nextPlan,
        issues,
        status: 'ready',
        currentWeekIndex: null,
        completedWeeks: nextPlan.generationSummary?.completedWeeks ?? 0,
        failedWeekIndexes: nextPlan.generationSummary?.failedWeeks ?? [],
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  acceptPlan: async () => {
    const { plan, weeks } = get()
    if (!plan) return { errors: ['No hay plan activo'], warnings: [] }
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
      set({ status: 'ready', lastError: result.errors.join(' · ') })
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
    const issues = validatePlan({ plan, weeks })
    set({
      plan,
      weeks,
      issues,
      status: 'ready',
      currentWeekIndex: null,
      completedWeeks: weeks.filter((week) => week.status === 'draft' || week.status === 'accepted').length,
      failedWeekIndexes: weeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
      streamingTextByWeekIndex: {},
      lastError: null,
    })
  },
}))
