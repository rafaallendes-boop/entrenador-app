import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { PlanGenerationJob, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { PlanBuilderDailyQuotaError } from '../../services/planBuilder/dailyQuotaError'
import { PlanEnqueueRejectedError } from '../../services/planBuilder/triggerBackgroundGeneration'
import type { EntitlementRequiredDetail } from '../../services/entitlements/entitlementError'

interface GeneratePlanWeeksMockInput {
  weeks: TrainingPlanWeek[]
  onWeekUpdate?: (week: TrainingPlanWeek) => void
}

const mocks = vi.hoisted(() => {
  const plans = new Map<string, TrainingPlan>()
  const weeks = new Map<string, TrainingPlanWeek>()
  const jobs = new Map<string, PlanGenerationJob>()

  return {
    plans,
    weeks,
    jobs,
    supabase: null as unknown,
    authUser: null as { id: string } | null,
    generatePlanWeeks: vi.fn(),
    fetchPlanGenerationSnapshot: vi.fn(),
    pollPlanGeneration: vi.fn(),
    triggerBackgroundGeneration: vi.fn(),
    pushTrainingPlan: vi.fn(),
    commitPlan: vi.fn(),
    assertPlanBuilderWeekRateLimit: vi.fn(),
    reservePlanBuilderWeekUsage: vi.fn(),
    releasePlanBuilderWeekReservations: vi.fn(),
    syncPlanBuilderWeekUsageFromWeeks: vi.fn(),
    db: {
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args.at(-1) as () => Promise<unknown>
        return callback()
      }),
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
        put: vi.fn(async (week: TrainingPlanWeek) => {
          weeks.set(week.id, week)
        }),
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
      planGenerationJobs: {
        put: vi.fn(async (job: PlanGenerationJob) => {
          jobs.set(job.id, job)
        }),
        get: vi.fn(async (id: string) => jobs.get(id)),
        where: vi.fn((field: string) => ({
          equals: vi.fn((value: string) => ({
            toArray: vi.fn(async () => Array.from(jobs.values()).filter((job) => {
              if (field === 'planId') return job.planId === value
              if (field === 'athleteId') return job.athleteId === value
              if (field === 'status') return job.status === value
              return false
            })),
            delete: vi.fn(async () => {
              for (const [id, job] of jobs.entries()) {
                if (field === 'planId' && job.planId === value) jobs.delete(id)
              }
            }),
          })),
        })),
      },
    },
  }
})

vi.mock('../../db/db', () => ({ db: mocks.db }))
vi.mock('../../services/auth', () => ({
  get supabase() {
    return mocks.supabase
  },
}))
vi.mock('../useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({ user: mocks.authUser }),
  },
}))
vi.mock('../../services/planBuilder/generatePlan', () => ({ generatePlanWeeks: mocks.generatePlanWeeks }))
vi.mock('../../services/planBuilder/commitPlan', () => ({ commitPlan: mocks.commitPlan }))
vi.mock('../../services/planBuilder/pollPlanGeneration', async (importActual) => {
  const actual = await importActual<typeof import('../../services/planBuilder/pollPlanGeneration')>()
  return {
    ...actual,
    fetchPlanGenerationSnapshot: mocks.fetchPlanGenerationSnapshot,
    pollPlanGeneration: mocks.pollPlanGeneration,
  }
})
vi.mock('../../services/planBuilder/triggerBackgroundGeneration', async (importActual) => {
  const actual = await importActual<typeof import('../../services/planBuilder/triggerBackgroundGeneration')>()
  return {
    ...actual,
    triggerBackgroundGeneration: mocks.triggerBackgroundGeneration,
  }
})
vi.mock('../../services/planBuilder/rateLimit', () => ({
  assertPlanBuilderWeekRateLimit: mocks.assertPlanBuilderWeekRateLimit,
  reservePlanBuilderWeekUsage: mocks.reservePlanBuilderWeekUsage,
  releasePlanBuilderWeekReservations: mocks.releasePlanBuilderWeekReservations,
  syncPlanBuilderWeekUsageFromWeeks: mocks.syncPlanBuilderWeekUsageFromWeeks,
}))
vi.mock('../../services/syncService', () => ({
  pushTrainingPlan: mocks.pushTrainingPlan,
}))

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
    generationJob: null,
    lastError: null,
    entitlementOffer: null,
  })
}

async function waitForStore(predicate: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for store update')
}

describe('usePlanBuilderStore', () => {
  beforeEach(() => {
    mocks.plans.clear()
    mocks.weeks.clear()
    mocks.jobs.clear()
    mocks.generatePlanWeeks.mockReset()
    mocks.fetchPlanGenerationSnapshot.mockReset()
    mocks.fetchPlanGenerationSnapshot.mockResolvedValue(null)
    mocks.pollPlanGeneration.mockReset()
    mocks.pollPlanGeneration.mockResolvedValue(null)
    mocks.triggerBackgroundGeneration.mockReset()
    mocks.triggerBackgroundGeneration.mockResolvedValue({ jobId: 'new-job' })
    mocks.pushTrainingPlan.mockReset()
    mocks.pushTrainingPlan.mockResolvedValue(undefined)
    mocks.commitPlan.mockReset()
    mocks.commitPlan.mockResolvedValue({ errors: [], warnings: [] })
    mocks.assertPlanBuilderWeekRateLimit.mockReset()
    mocks.assertPlanBuilderWeekRateLimit.mockResolvedValue(undefined)
    mocks.reservePlanBuilderWeekUsage.mockReset()
    mocks.reservePlanBuilderWeekUsage.mockResolvedValue([])
    mocks.releasePlanBuilderWeekReservations.mockReset()
    mocks.releasePlanBuilderWeekReservations.mockResolvedValue(0)
    mocks.syncPlanBuilderWeekUsageFromWeeks.mockReset()
    mocks.syncPlanBuilderWeekUsageFromWeeks.mockResolvedValue(undefined)
    mocks.supabase = null
    mocks.authUser = null
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
    expect(state.lastError).toContain('No encontramos semanas')
  })

  it('loadDraft keeps a generating draft without synced weeks in generating state', async () => {
    await createShell()
    const plan = usePlanBuilderStore.getState().plan!
    const generatingPlan: TrainingPlan = {
      ...plan,
      generationState: 'generating',
      generationSummary: {
        startedAt: Date.now(),
        jobId: 'job-1',
        strategy: 'single',
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
        heartbeatAt: Date.now(),
      },
    }
    await mocks.db.trainingPlans.put(generatingPlan)
    mocks.weeks.clear()
    resetStore()

    await usePlanBuilderStore.getState().loadDraft(plan.id)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('generating')
    expect(state.weeks).toEqual([])
    expect(state.lastError).toBeNull()
  })

  it('runGeneration complete leaves complete/ready', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map(generatedWeek)
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })

    await usePlanBuilderStore.getState().runGeneration(profile)
    await waitForStore(() => usePlanBuilderStore.getState().plan?.generationState === 'complete')

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('complete')
    expect(state.status).toBe('ready')
    expect(state.completedWeeks).toBe(state.weeks.length)
  })

  it('runGeneration partial leaves partial/partial', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map((week) => (week.weekIndex === 0 ? generatedWeek(week) : failedWeek(week)))
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })

    await usePlanBuilderStore.getState().runGeneration(profile)
    await waitForStore(() => usePlanBuilderStore.getState().plan?.generationState === 'partial')

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
    await waitForStore(() => usePlanBuilderStore.getState().plan?.generationState === 'failed')

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('failed')
    expect(state.status).toBe('failed')
  })

  it('runGeneration technical exceptions leave store in error', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockRejectedValue(new Error('provider down'))

    await usePlanBuilderStore.getState().runGeneration(profile)
    await waitForStore(() => usePlanBuilderStore.getState().plan?.generationState === 'failed')

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('failed')
    expect(state.lastError).toContain('semana')
  })

  it('does not trigger a second remote generation when Supabase already has an active plan', async () => {
    const profile = await createShell()
    const stateBefore = usePlanBuilderStore.getState()
    const plan = stateBefore.plan!
    const weeks = stateBefore.weeks
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.fetchPlanGenerationSnapshot.mockResolvedValue({
      plan: {
        ...plan,
        generationState: 'generating',
        generationSummary: {
          startedAt: Date.now(),
          jobId: 'existing-job',
          strategy: 'single',
          completedWeeks: 0,
          failedWeeks: [],
          totalAttempts: 0,
          heartbeatAt: Date.now(),
        },
      },
      weeks,
      isTerminal: false,
      isStalled: false,
    })

    await usePlanBuilderStore.getState().runGeneration(profile)

    expect(mocks.fetchPlanGenerationSnapshot).toHaveBeenCalledWith(plan.id)
    expect(mocks.triggerBackgroundGeneration).not.toHaveBeenCalled()
    expect(usePlanBuilderStore.getState().plan?.generationSummary?.jobId).toBe('existing-job')
    expect(usePlanBuilderStore.getState().status).toBe('generating')
  })

  it('ignores an orphan remote generating marker without job id or week progress', async () => {
    const profile = await createShell()
    const stateBefore = usePlanBuilderStore.getState()
    const plan = stateBefore.plan!
    const weeks = stateBefore.weeks
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.fetchPlanGenerationSnapshot.mockResolvedValue({
      plan: {
        ...plan,
        generationState: 'generating',
        generationSummary: {
          startedAt: Date.now(),
          strategy: 'single',
          completedWeeks: 0,
          failedWeeks: [],
          totalAttempts: 0,
          heartbeatAt: Date.now(),
        },
      },
      weeks: [],
      isTerminal: false,
      isStalled: false,
    })

    await usePlanBuilderStore.getState().runGeneration(profile)

    expect(mocks.fetchPlanGenerationSnapshot).toHaveBeenCalledWith(plan.id)
    expect(mocks.pushTrainingPlan).toHaveBeenCalled()
    expect(mocks.triggerBackgroundGeneration).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        id: plan.id,
        generationState: 'generating',
      }),
      weeks: expect.arrayContaining(weeks.map((week) => expect.objectContaining({ id: week.id }))),
    }))
  })

  it('checks and reserves async Plan Builder rate-limit usage before remote enqueue', async () => {
    const profile = await createShell()
    const stateBefore = usePlanBuilderStore.getState()
    const plan = stateBefore.plan!
    const weekIndexes = stateBefore.weeks.map((week) => week.weekIndex)
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }

    await usePlanBuilderStore.getState().runGeneration(profile)

    expect(mocks.assertPlanBuilderWeekRateLimit).toHaveBeenCalledWith(weekIndexes)
    expect(mocks.reservePlanBuilderWeekUsage).toHaveBeenCalledWith({
      planId: plan.id,
      weekIndexes,
    })
    expect(mocks.triggerBackgroundGeneration).toHaveBeenCalled()
  })

  it('does not publish or enqueue a remote generation when Plan Builder weekly quota is exhausted', async () => {
    const profile = await createShell()
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.assertPlanBuilderWeekRateLimit.mockRejectedValueOnce(
      new PlanBuilderDailyQuotaError({ requested: 2, remaining: 0, limit: 12 }),
    )

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.plan?.generationState).toBe('shell')
    expect(state.lastError).toContain('límite diario')
    expect(mocks.pushTrainingPlan).not.toHaveBeenCalled()
    expect(mocks.reservePlanBuilderWeekUsage).not.toHaveBeenCalled()
    expect(mocks.triggerBackgroundGeneration).not.toHaveBeenCalled()
  })

  it('keeps background generation alive when the client loses trigger confirmation after publishing the plan', async () => {
    const profile = await createShell()
    const plan = usePlanBuilderStore.getState().plan!
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(new Error('Failed to fetch'))

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(mocks.pushTrainingPlan).toHaveBeenCalled()
    expect(mocks.triggerBackgroundGeneration).toHaveBeenCalled()
    expect(mocks.pollPlanGeneration).toHaveBeenCalledWith(expect.objectContaining({
      planId: plan.id,
    }))
    expect(state.status).toBe('generating')
    expect(state.plan?.generationState).toBe('generating')
    expect(state.lastError).toBeNull()
  })

  it('surfaces a definitive enqueue rejection as an error instead of polling until stalled', async () => {
    const profile = await createShell()
    const plan = usePlanBuilderStore.getState().plan!
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError('Payload inválido para generar plan.', 400),
    )

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.plan?.generationState).toBe('failed')
    expect(state.lastError).toContain('Payload inválido')
    expect(mocks.pollPlanGeneration).not.toHaveBeenCalled()
    expect(mocks.plans.get(plan.id)?.generationState).toBe('failed')
    expect(mocks.pushTrainingPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      id: plan.id,
      generationState: 'failed',
    }))
    expect(mocks.releasePlanBuilderWeekReservations).toHaveBeenCalledWith({
      planId: plan.id,
      weekIndexes: expect.arrayContaining(usePlanBuilderStore.getState().weeks.map((week) => week.weekIndex)),
    })
    expect(state.entitlementOffer).toBeNull()
  })

  it('shows the daily quota copy on runGeneration rejection, never the entitlement offer', async () => {
    const profile = await createShell()
    const plan = usePlanBuilderStore.getState().plan!
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError(
        'Alcanzaste el cupo diario.',
        429,
        null,
        { errorCode: 'quota_exceeded', detail: { bucketId: 'plan_builder_week', limit: 12, remaining: 0 } },
      ),
    )

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.plan?.generationState).toBe('failed')
    expect(state.lastError).toContain('cupo diario')
    expect(state.entitlementOffer).toBeNull()
    expect(mocks.pollPlanGeneration).not.toHaveBeenCalled()
    expect(mocks.plans.get(plan.id)?.generationState).toBe('failed')
    expect(mocks.releasePlanBuilderWeekReservations).toHaveBeenCalledWith({
      planId: plan.id,
      weekIndexes: expect.arrayContaining(usePlanBuilderStore.getState().weeks.map((week) => week.weekIndex)),
    })
  })

  it('shows the spend cap copy on regenerateWeek rejection, never the entitlement offer', async () => {
    const profile = await createShell()
    const shell = usePlanBuilderStore.getState()
    const partialWeeks = shell.weeks.map((week, index) => (
      index === 0 ? failedWeek(week) : generatedWeek(week)
    ))
    const partialPlan: TrainingPlan = {
      ...shell.plan!,
      generationState: 'partial',
      generationSummary: {
        startedAt: 1,
        completedAt: 2,
        heartbeatAt: 2,
        strategy: 'single',
        completedWeeks: partialWeeks.length - 1,
        failedWeeks: [partialWeeks[0].weekIndex],
        totalAttempts: 1,
      },
    }
    await mocks.db.trainingPlans.put(partialPlan)
    await mocks.db.trainingPlanWeeks.bulkPut(partialWeeks)
    usePlanBuilderStore.setState({
      plan: partialPlan,
      weeks: partialWeeks,
      status: 'partial',
      completedWeeks: partialWeeks.length - 1,
      failedWeekIndexes: [partialWeeks[0].weekIndex],
      lastError: null,
    })
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError(
        'El servicio alcanzó su presupuesto diario.',
        429,
        null,
        { errorCode: 'spend_cap_exceeded', detail: { scope: 'global', capUsd: 5 } },
      ),
    )

    await usePlanBuilderStore.getState().regenerateWeek(partialWeeks[0].weekIndex, profile)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.plan?.generationState).toBe('failed')
    expect(state.lastError).toContain('presupuesto')
    expect(state.entitlementOffer).toBeNull()
  })

  it('shows the kill switch copy on retryFailedWeeks rejection, never the entitlement offer', async () => {
    const profile = await createShell()
    const shell = usePlanBuilderStore.getState()
    const failedWeeks = shell.weeks.map(failedWeek)
    const failedIndexes = failedWeeks.map((week) => week.weekIndex)
    const failedPlan: TrainingPlan = {
      ...shell.plan!,
      generationState: 'failed',
      generationSummary: {
        startedAt: 1,
        completedAt: 2,
        heartbeatAt: 2,
        strategy: 'single',
        completedWeeks: 0,
        failedWeeks: failedIndexes,
        totalAttempts: 1,
      },
    }
    await mocks.db.trainingPlans.put(failedPlan)
    await mocks.db.trainingPlanWeeks.bulkPut(failedWeeks)
    usePlanBuilderStore.setState({
      plan: failedPlan,
      weeks: failedWeeks,
      status: 'failed',
      completedWeeks: 0,
      failedWeekIndexes: failedIndexes,
      lastError: null,
    })
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError('IA pausada.', 503, null, { errorCode: 'kill_switch_active' }),
    )

    await usePlanBuilderStore.getState().retryFailedWeeks(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.plan?.generationState).toBe('failed')
    expect(state.lastError).toContain('pausada')
    expect(state.entitlementOffer).toBeNull()
  })

  it('turns an entitlement rejection into an ephemeral offer and restores the pre-attempt snapshot', async () => {
    const profile = await createShell()
    const originalPlan = usePlanBuilderStore.getState().plan!
    const originalWeeks = usePlanBuilderStore.getState().weeks
    const detail: EntitlementRequiredDetail = {
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    }
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError('Requiere advanced.', 403, detail),
    )

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.entitlementOffer).toEqual(detail)
    expect(state.lastError).toBeNull()
    expect(state.status).toBe('shell_ready')
    expect(state.plan).toEqual(originalPlan)
    expect(state.weeks).toEqual(originalWeeks)
    expect(mocks.pollPlanGeneration).not.toHaveBeenCalled()
    expect(mocks.releasePlanBuilderWeekReservations).toHaveBeenCalled()
    expect(mocks.pushTrainingPlan).toHaveBeenLastCalledWith(originalPlan)
    expect(mocks.plans.get(originalPlan.id)).toEqual(originalPlan)
  })

  it('clears an old entitlement offer when a later enqueue succeeds', async () => {
    const profile = await createShell()
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    usePlanBuilderStore.setState({
      entitlementOffer: {
        requestClass: 'plan_builder_week',
        requiredTier: 'advanced',
        currentTier: 'free',
      },
    })

    await usePlanBuilderStore.getState().runGeneration(profile)

    expect(usePlanBuilderStore.getState().entitlementOffer).toBeNull()
    expect(mocks.pollPlanGeneration).toHaveBeenCalled()
  })

  it('restores a partial plan when entitlement rejects a week regeneration', async () => {
    const profile = await createShell()
    const shell = usePlanBuilderStore.getState()
    const partialWeeks = shell.weeks.map((week, index) => (
      index === 0 ? failedWeek(week) : generatedWeek(week)
    ))
    const partialPlan: TrainingPlan = {
      ...shell.plan!,
      generationState: 'partial',
      generationSummary: {
        startedAt: 1,
        completedAt: 2,
        heartbeatAt: 2,
        strategy: 'single',
        completedWeeks: partialWeeks.length - 1,
        failedWeeks: [partialWeeks[0].weekIndex],
        totalAttempts: 1,
      },
    }
    await mocks.db.trainingPlans.put(partialPlan)
    await mocks.db.trainingPlanWeeks.bulkPut(partialWeeks)
    usePlanBuilderStore.setState({
      plan: partialPlan,
      weeks: partialWeeks,
      status: 'partial',
      completedWeeks: partialWeeks.length - 1,
      failedWeekIndexes: [partialWeeks[0].weekIndex],
      lastError: 'fallo previo',
    })
    const detail: EntitlementRequiredDetail = {
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    }
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError('Requiere advanced.', 403, detail),
    )

    await usePlanBuilderStore.getState().regenerateWeek(partialWeeks[0].weekIndex, profile)

    const state = usePlanBuilderStore.getState()
    expect(state.plan).toEqual(partialPlan)
    expect(state.weeks).toEqual(partialWeeks)
    expect(state.status).toBe('partial')
    expect(state.lastError).toBe('fallo previo')
    expect(state.entitlementOffer).toEqual(detail)
    expect(mocks.pushTrainingPlan).toHaveBeenLastCalledWith(partialPlan)
  })

  it('restores a failed plan when entitlement rejects retryFailedWeeks', async () => {
    const profile = await createShell()
    const shell = usePlanBuilderStore.getState()
    const failedWeeks = shell.weeks.map(failedWeek)
    const failedIndexes = failedWeeks.map((week) => week.weekIndex)
    const failedPlan: TrainingPlan = {
      ...shell.plan!,
      generationState: 'failed',
      generationSummary: {
        startedAt: 1,
        completedAt: 2,
        heartbeatAt: 2,
        strategy: 'single',
        completedWeeks: 0,
        failedWeeks: failedIndexes,
        totalAttempts: 1,
      },
    }
    await mocks.db.trainingPlans.put(failedPlan)
    await mocks.db.trainingPlanWeeks.bulkPut(failedWeeks)
    usePlanBuilderStore.setState({
      plan: failedPlan,
      weeks: failedWeeks,
      status: 'failed',
      completedWeeks: 0,
      failedWeekIndexes: failedIndexes,
      lastError: 'fallo previo',
    })
    const detail: EntitlementRequiredDetail = {
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    }
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError('Requiere advanced.', 403, detail),
    )

    await usePlanBuilderStore.getState().retryFailedWeeks(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.plan).toEqual(failedPlan)
    expect(state.weeks).toEqual(failedWeeks)
    expect(state.status).toBe('failed')
    expect(state.lastError).toBe('fallo previo')
    expect(state.entitlementOffer).toEqual(detail)
    expect(mocks.pushTrainingPlan).toHaveBeenLastCalledWith(failedPlan)
  })

  it('clears an old entitlement offer when creating or loading another draft', async () => {
    const offer: EntitlementRequiredDetail = {
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    }
    usePlanBuilderStore.setState({ entitlementOffer: offer })

    await createShell()

    const planId = usePlanBuilderStore.getState().plan!.id
    expect(usePlanBuilderStore.getState().entitlementOffer).toBeNull()

    usePlanBuilderStore.setState({ entitlementOffer: offer })
    await usePlanBuilderStore.getState().loadDraft(planId)

    expect(usePlanBuilderStore.getState().entitlementOffer).toBeNull()
  })

  it('marks generation as failed when the remote draft cannot be published before enqueue', async () => {
    const profile = await createShell()
    const plan = usePlanBuilderStore.getState().plan!
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    mocks.pushTrainingPlan.mockRejectedValueOnce(new Error('sync offline'))

    await usePlanBuilderStore.getState().runGeneration(profile)

    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('error')
    expect(state.plan?.generationState).toBe('failed')
    expect(state.lastError).toContain('sync offline')
    expect(mocks.triggerBackgroundGeneration).not.toHaveBeenCalled()
    expect(mocks.pollPlanGeneration).not.toHaveBeenCalled()
    expect(mocks.plans.get(plan.id)?.generationState).toBe('failed')
  })

  it('acceptPlan rejects when generationState is not complete', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map((week) => (week.weekIndex === 0 ? generatedWeek(week) : failedWeek(week)))
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })
    await usePlanBuilderStore.getState().runGeneration(profile)
    await waitForStore(() => usePlanBuilderStore.getState().plan?.generationState === 'partial')

    const result = await usePlanBuilderStore.getState().acceptPlan()

    expect(result.errors).toHaveLength(1)
    expect(mocks.commitPlan).not.toHaveBeenCalled()
  })

  it('regenerateWeek can promote partial to complete', async () => {
    const profile = await createShell()
    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map((week) => (week.weekIndex === 2 ? failedWeek(week) : generatedWeek(week)))
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })
    await usePlanBuilderStore.getState().runGeneration(profile)
    await waitForStore(() => usePlanBuilderStore.getState().plan?.generationState === 'partial')

    mocks.generatePlanWeeks.mockImplementation(async ({ weeks, onWeekUpdate }: GeneratePlanWeeksMockInput) => {
      const result = weeks.map(generatedWeek)
      result.forEach((week) => onWeekUpdate?.(week))
      return result
    })
    const failedIndex = usePlanBuilderStore.getState().failedWeekIndexes[0]
    await usePlanBuilderStore.getState().regenerateWeek(failedIndex, profile)
    await waitForStore(() => usePlanBuilderStore.getState().plan?.generationState === 'complete')

    const state = usePlanBuilderStore.getState()
    expect(state.plan?.generationState).toBe('complete')
    expect(state.status).toBe('ready')
  })
})
