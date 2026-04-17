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
      set({ plan, weeks, status: 'ready', currentWeekIndex: null })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  runGeneration: async (profile) => {
    const { plan, weeks } = get()
    if (!plan) return
    set({ status: 'generating', lastError: null, issues: [] })
    try {
      const updated: TrainingPlanWeek[] = []
      await generatePlanWeeks({
        plan,
        weeks,
        profile,
        wizardConfig: plan.wizardConfig,
        onWeekUpdate: (next) => {
          updated.push(next)
          set((state) => ({
            weeks: state.weeks.map((w) => (w.weekIndex === next.weekIndex ? next : w)),
            currentWeekIndex: next.status === 'generating' ? next.weekIndex : state.currentWeekIndex,
          }))
        },
      })
      const nextWeeks = get().weeks
      await db.trainingPlanWeeks.bulkPut(nextWeeks)
      const issues = validatePlan({ plan, weeks: nextWeeks })
      set({ issues, status: 'ready', currentWeekIndex: null })
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
    set({ status: 'generating', lastError: null, currentWeekIndex: weekIndex })
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
          }))
        },
      })
      const nextWeeks = get().weeks
      await db.trainingPlanWeeks.bulkPut(nextWeeks)
      const issues = validatePlan({ plan, weeks: nextWeeks })
      set({ issues, status: 'ready', currentWeekIndex: null })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ status: 'error', lastError: msg })
    }
  },

  acceptPlan: async () => {
    const { plan, weeks } = get()
    if (!plan) return { errors: ['No hay plan activo'], warnings: [] }
    set({ status: 'committing', lastError: null })
    const result = await commitPlan(plan, weeks)
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
      await db.trainingPlanWeeks.where('planId').equals(plan.id).delete()
      await db.trainingPlans.delete(plan.id)
    }
    set({ plan: null, weeks: [], issues: [], status: 'idle', currentWeekIndex: null, lastError: null })
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
    set({ plan, weeks, issues, status: 'ready', currentWeekIndex: null, lastError: null })
  },
}))
