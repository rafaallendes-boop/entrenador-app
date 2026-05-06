import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

interface GeneratePlanWeeksMockInput {
  weeks: TrainingPlanWeek[]
  onWeekUpdate?: (week: TrainingPlanWeek) => void
}

const mocks = vi.hoisted(() => {
  const plans = new Map<string, TrainingPlan>()
  const weeks = new Map<string, TrainingPlanWeek>()

  return {
    plans,
    weeks,
    generatePlanWeeks: vi.fn(),
    commitPlan: vi.fn(),
    db: {
      trainingPlans: {
        put: vi.fn(async (plan: TrainingPlan) => {
          plans.set(plan.id, plan)
        }),
        get: vi.fn(async (id: string) => plans.get(id)),
        delete: vi.fn(async (id: string) => {
          plans.delete(id)
        }),
      },
      trainingPlanWeeks: {
        bulkPut: vi.fn(async (nextWeeks: TrainingPlanWeek[]) => {
          for (const week of nextWeeks) weeks.set(week.id, week)
        }),
        where: vi.fn(() => ({
          equals: vi.fn((planId: string) => ({
            delete: vi.fn(async () => {
              for (const [id, week] of weeks.entries()) {
                if (week.planId === planId) weeks.delete(id)
              }
            }),
            toArray: vi.fn(async () => Array.from(weeks.values()).filter((week) => week.planId === planId)),
          })),
        })),
      },
    },
  }
})

vi.mock('../../db/db', () => ({ db: mocks.db }))
vi.mock('../../services/planBuilder/generatePlan', () => ({ generatePlanWeeks: mocks.generatePlanWeeks }))
vi.mock('../../services/planBuilder/commitPlan', () => ({ commitPlan: mocks.commitPlan }))

import { usePlanBuilderStore } from '../usePlanBuilderStore'

function makeProfile(eventDate = eventNWeeksFromNow(3)): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: Date.now(),
    name: 'Test',
    sportContext: {
      enabledSports: ['squash', 'running', 'strength'],
      primarySport: 'squash',
    },
    goalEvents: [{
      id: 'evt-1',
      title: 'Regional',
      date: eventDate,
      sport: 'squash',
      priority: 'primary',
    }],
  }
}

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'evt-1',
    trainingDays: ['monday', 'tuesday'],
    sessionsPerWeek: 2,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function eventNWeeksFromNow(weeks: number): string {
  const d = new Date()
  d.setDate(d.getDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

function addDaysIso(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function makeSessions(week: TrainingPlanWeek): TrainingPlanWeek['sessions'] {
  return [
    {
      date: week.weekStartDate,
      timeBlock: 'AM',
      sessionType: 'squash',
      title: `Squash ${week.weekIndex + 1}A`,
      durationMin: 60,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'technical',
        drills: [{ name: 'Drive', durationMin: 12 }],
      },
    },
    {
      date: addDaysIso(week.weekStartDate, 1),
      timeBlock: 'PM',
      sessionType: 'squash',
      title: `Squash ${week.weekIndex + 1}B`,
      durationMin: 45,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'technical',
        drills: [{ name: 'Boast', durationMin: 10 }],
      },
    },
  ]
}

function generatedWeek(week: TrainingPlanWeek): TrainingPlanWeek {
  return {
    ...week,
    status: 'draft',
    sessions: makeSessions(week),
    generationMeta: { ...week.generationMeta, attempts: 1, strategy: 'single' },
  }
}

function failedWeek(week: TrainingPlanWeek): TrainingPlanWeek {
  return {
    ...week,
    status: 'error',
    sessions: [],
    generationMeta: { ...week.generationMeta, attempts: 3, strategy: 'single', lastError: 'fallo test' },
  }
}

async function createShell() {
  const profile = makeProfile()
  await usePlanBuilderStore.getState().createDraft({ profile, wizardConfig: makeWizardConfig() })
  return profile
}

function resetStore() {
  usePlanBuilderStore.setState({
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
}

describe('usePlanBuilderStore', () => {
  beforeEach(() => {
    mocks.plans.clear()
    mocks.weeks.clear()
    mocks.generatePlanWeeks.mockReset()
    mocks.commitPlan.mockReset()
    mocks.commitPlan.mockResolvedValue({ errors: [], warnings: [] })
    resetStore()
  })

  it('createDraft leaves a shell ready to generate, not a review-ready plan', async () => {
    await createShell()

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('shell')
    expect(state.status).toBe('shell_ready')
  })

  it('loadDraft rejects a draft plan that has no weeks', async () => {
    await createShell()
    const planId = usePlanBuilderStore.getState().plan?.id
    expect(planId).toBeTruthy()
    mocks.weeks.clear()
    resetStore()

    await usePlanBuilderStore.getState().loadDraft(planId!)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.weeks).toEqual([])
    expect(state.lastError).toContain('no tiene semanas')
  })

  it('runGeneration complete leaves complete/ready', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map(generatedWeek)
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('complete')
    expect(state.status).toBe('ready')
    expect(state.completedWeeks).toBe(state.weeks.length)
  })

  it('runGeneration partial leaves partial/partial', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map((week, index) => (index === 0 ? generatedWeek(week) : failedWeek(week)))
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('partial')
    expect(state.status).toBe('partial')
    expect(state.failedWeekIndexes.length).toBeGreaterThan(0)
  })

  it('runGeneration with no valid weeks leaves failed/failed', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map(failedWeek)
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('failed')
    expect(state.status).toBe('failed')
  })

  it('runGeneration technical exceptions leave store in error', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockRejectedValue(new Error('provider down'))

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.lastError).toBe('provider down')
  })

  it('acceptPlan rejects when generationState is not complete', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map((week, index) => (index === 0 ? generatedWeek(week) : failedWeek(week)))
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })
    await usePlanBuilderStore.getState().runGeneration(profile)

    const result = await usePlanBuilderStore.getState().acceptPlan()

    expect(result.errors).toHaveLength(1)
    expect(mocks.commitPlan).not.toHaveBeenCalled()
  })

  it('regenerateWeek can promote partial to complete', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementationOnce(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map((week, index) => (index === weeks.length - 1 ? failedWeek(week) : generatedWeek(week)))
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })
    await usePlanBuilderStore.getState().runGeneration(profile)

    mocks.generatePlanWeeks.mockImplementationOnce(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map(generatedWeek)
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })
    const failedIndex = usePlanBuilderStore.getState().failedWeekIndexes[0]
    await usePlanBuilderStore.getState().regenerateWeek(failedIndex, profile)

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('complete')
    expect(state.status).toBe('ready')
  })
})
