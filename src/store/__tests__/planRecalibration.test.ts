import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, Session, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { PlanEnqueueRejectedError } from '../../services/planBuilder/triggerBackgroundGeneration'

// ---------------------------------------------------------------------------
// Mocks. Combina el arnés de `usePlanBuilderStore.test.ts` (para
// `recalibrateRemainingWeeks`, que toca `db.trainingPlans`/`trainingPlanWeeks`
// y el gate remoto) con el de `commitPlan.test.ts` (para
// `reconcileRecalibratedWeeks`, que toca `db.sessions`/`weekSummaries` vía
// `applyCreateWeek` real). Un solo `vi.mock('../../db/db', ...)` por archivo,
// así que viven combinados en un único mock de `db`.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const plans = new Map<string, TrainingPlan>()
  const weeks = new Map<string, TrainingPlanWeek>()
  const sessions = new Map<string, Session>()
  const weekSummaries = new Map<string, WeekSummary>()
  const jobs = new Map<string, { id: string; planId: string; athleteId: string; createdAt: number }>()

  return {
    plans,
    weeks,
    sessions,
    weekSummaries,
    jobs,
    supabase: null as unknown,
    authUser: null as { id: string } | null,
    generatePlanWeeks: vi.fn(),
    fetchPlanGenerationSnapshot: vi.fn(),
    pollPlanGeneration: vi.fn(),
    triggerBackgroundGeneration: vi.fn(),
    buildPlanBuilderRecentContext: vi.fn(),
    pushTrainingPlan: vi.fn(),
    assertPlanBuilderWeekRateLimit: vi.fn(),
    reservePlanBuilderWeekUsage: vi.fn(),
    releasePlanBuilderWeekReservations: vi.fn(),
    syncPlanBuilderWeekUsageFromWeeks: vi.fn(),
    trainingStore: {
      loadedWeekStart: null as string | null,
      loadWeek: vi.fn(async () => {}),
      loadAllSummaries: vi.fn(async () => {}),
      addSession: vi.fn(async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
        const created: Session = {
          ...session,
          id: `session-${sessions.size + 1}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          weekStartDate: session.weekStartDate,
        }
        sessions.set(created.id, created)
        return created
      }),
    },
  }
})

vi.mock('../../db/db', () => ({
  db: {
    transaction: vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<unknown>
      return callback()
    }),
    trainingPlans: {
      put: vi.fn(async (plan: TrainingPlan) => {
        mocks.plans.set(plan.id, plan)
      }),
      bulkPut: vi.fn(async (nextPlans: TrainingPlan[]) => {
        for (const plan of nextPlans) mocks.plans.set(plan.id, plan)
      }),
      get: vi.fn(async (id: string) => mocks.plans.get(id)),
      delete: vi.fn(async (id: string) => {
        mocks.plans.delete(id)
      }),
      toArray: vi.fn(async () => Array.from(mocks.plans.values())),
    },
    trainingPlanWeeks: {
      put: vi.fn(async (week: TrainingPlanWeek) => {
        mocks.weeks.set(week.id, week)
      }),
      bulkPut: vi.fn(async (nextWeeks: TrainingPlanWeek[]) => {
        for (const week of nextWeeks) mocks.weeks.set(week.id, week)
      }),
      where: vi.fn(() => ({
        equals: vi.fn((planId: string) => ({
          delete: vi.fn(async () => {
            for (const [id, week] of mocks.weeks.entries()) {
              if (week.planId === planId) mocks.weeks.delete(id)
            }
          }),
          toArray: vi.fn(async () => Array.from(mocks.weeks.values()).filter((week) => week.planId === planId)),
        })),
      })),
    },
    sessions: {
      toArray: vi.fn(async () => Array.from(mocks.sessions.values())),
      where: vi.fn(() => ({
        aboveOrEqual: vi.fn((start: string) => ({
          toArray: vi.fn(async () =>
            Array.from(mocks.sessions.values()).filter((session) => session.date >= start),
          ),
        })),
        between: vi.fn((start: string, end: string) => ({
          toArray: vi.fn(async () =>
            Array.from(mocks.sessions.values()).filter((session) => session.date >= start && session.date <= end),
          ),
        })),
        anyOf: vi.fn((dates: string[]) => ({
          toArray: vi.fn(async () =>
            Array.from(mocks.sessions.values()).filter((session) => dates.includes(session.date)),
          ),
        })),
      })),
      put: vi.fn(async (session: Session) => {
        mocks.sessions.set(session.id, session)
      }),
      delete: vi.fn(async (id: string) => {
        mocks.sessions.delete(id)
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        ids.forEach((id) => mocks.sessions.delete(id))
      }),
    },
    weekSummaries: {
      get: vi.fn(async (weekStartDate: string) => mocks.weekSummaries.get(weekStartDate)),
      put: vi.fn(async (summary: WeekSummary) => {
        mocks.weekSummaries.set(summary.weekStartDate, summary)
      }),
      delete: vi.fn(async (id: string) => {
        for (const [weekStart, summary] of mocks.weekSummaries.entries()) {
          if (summary.id === id) mocks.weekSummaries.delete(weekStart)
        }
      }),
    },
    planGenerationJobs: {
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          toArray: vi.fn(async () => Array.from(mocks.jobs.values()).filter((job) => {
            if (field === 'planId') return job.planId === value
            if (field === 'athleteId') return job.athleteId === value
            return false
          })),
        })),
      })),
    },
  },
}))

vi.mock('../../db/queries', () => ({
  getWeekSummary: vi.fn(async (weekStartDate: string) => mocks.weekSummaries.get(weekStartDate)),
  recalculateWeekSummary: vi.fn(async () => {}),
  upsertWeekSummary: vi.fn(async (weekStartDate: string, patch: { objectives?: string[] }) => {
    const existing = mocks.weekSummaries.get(weekStartDate)
    const summary: WeekSummary = existing ?? {
      id: `summary-${weekStartDate}`,
      weekStartDate,
      totalSessions: 0,
      totalMinutes: 0,
      plannedSessions: 0,
      completedSessions: 0,
      plannedMinutes: 0,
      completedMinutes: 0,
      squashSessions: 0,
      runningSessions: 0,
      strengthSessions: 0,
      objectives: [],
    }
    const next = { ...summary, objectives: patch.objectives ?? summary.objectives }
    mocks.weekSummaries.set(weekStartDate, next)
    return next
  }),
}))

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
vi.mock('../../services/planBuilder/recentContext', () => ({
  buildPlanBuilderRecentContext: mocks.buildPlanBuilderRecentContext,
  trimRecentContextForPayload: (c: unknown) => c,
}))
vi.mock('../../services/planBuilder/triggerBackgroundGeneration', async (importActual) => {
  const actual = await importActual<typeof import('../../services/planBuilder/triggerBackgroundGeneration')>()
  return {
    ...actual,
    triggerBackgroundGeneration: mocks.triggerBackgroundGeneration,
  }
})
vi.mock('../../services/planBuilder/pollPlanGeneration', async (importActual) => {
  const actual = await importActual<typeof import('../../services/planBuilder/pollPlanGeneration')>()
  return {
    ...actual,
    fetchPlanGenerationSnapshot: mocks.fetchPlanGenerationSnapshot,
    pollPlanGeneration: mocks.pollPlanGeneration,
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
  pushSession: vi.fn(),
  deleteSession: vi.fn(),
  pushWeekSummary: vi.fn(),
  pullSessionsForDateRange: vi.fn(async () => {}),
}))
vi.mock('../useTrainingStore', () => ({
  useTrainingStore: {
    getState: () => mocks.trainingStore,
  },
}))
const coachMemoryGetState = vi.fn(() => ({ athleteProfile: null as AthleteProfile | null }))
vi.mock('../useCoachMemoryStore', () => ({
  useCoachMemoryStore: {
    getState: () => coachMemoryGetState(),
  },
}))

import { usePlanBuilderStore } from '../usePlanBuilderStore'
import { reconcileRecalibratedWeeks } from '../../services/planBuilder/commitPlan'
import { bumpSwitchEpoch } from '../../services/athlete/activeAthlete'
import * as syncService from '../../services/syncService'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: Date.now(),
    name: 'Test',
    sportContext: {
      enabledSports: ['squash', 'running', 'strength'],
      primarySport: 'squash',
    },
  }
}

function makePlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'active',
    generationState: 'complete',
    title: 'Plan regional',
    startDate: '2026-06-01',
    endDate: '2026-06-28',
    totalWeeks: 4,
    phases: [],
    wizardConfig: {
      goalEventId: 'event-1',
      trainingDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 3,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['running'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'fresh',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-07-01',
      currentPhase: 'build',
      weeksRemaining: 4,
      blockFocus: 'Build',
      headline: 'Build',
      timeline: [],
      sportDetails: [{
        sport: 'squash',
        role: 'primary',
        phaseFocus: 'Build',
        weeklyIntent: 'Sostener especificidad',
        volumeBias: 'build',
        intensityBias: 'hold',
        notes: 'Test',
      }],
      secondaryEvents: [],
      computedAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeWeek(args: {
  id: string
  weekIndex: number
  weekStartDate: string
  status?: TrainingPlanWeek['status']
  sessions?: TrainingPlanWeek['sessions']
  planId?: string
}): TrainingPlanWeek {
  return {
    id: args.id,
    planId: args.planId ?? 'plan-1',
    weekIndex: args.weekIndex,
    weekStartDate: args.weekStartDate,
    phase: 'build',
    status: args.status ?? 'draft',
    sessions: args.sessions ?? [],
    weekObjectives: [{ goal: `Objetivo ${args.weekIndex + 1}` }],
    targetLoadBySport: { squash: 70 },
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: 1,
    updatedAt: 1,
  }
}

/** Cuatro semanas: 0 y 1 lunes 2026-06-01/08 (vividas), 2 y 3 futuras. */
function makeFourWeeks(): TrainingPlanWeek[] {
  return [
    makeWeek({ id: 'week-0', weekIndex: 0, weekStartDate: '2026-06-01', status: 'accepted' }),
    makeWeek({ id: 'week-1', weekIndex: 1, weekStartDate: '2026-06-08', status: 'accepted' }),
    makeWeek({ id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15', status: 'accepted' }),
    makeWeek({ id: 'week-3', weekIndex: 3, weekStartDate: '2026-06-22', status: 'accepted' }),
  ]
}

function makeProposalSession(date: string, timeBlock: 'AM' | 'PM' = 'AM'): TrainingPlanWeek['sessions'] {
  return [{
    date,
    timeBlock,
    sessionType: 'squash',
    title: `Sesion ${date}`,
    durationMin: 60,
    squashDetails: {
      trainingFocus: 'technical',
      drills: [],
      sessionMode: 'drill_session',
    },
  }]
}

function makeStoredSession(id: string, date: string, title: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    date,
    weekStartDate: '2026-06-15',
    timeBlock: 'AM',
    type: 'squash',
    source: 'coach',
    status: 'planned',
    title,
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    squashDetails: {
      trainingFocus: 'technical',
      drills: [],
      sessionMode: 'drill_session',
    },
    ...patch,
  }
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
    recalibrationNotice: null,
  })
}

// ---------------------------------------------------------------------------
// recalibrateRemainingWeeks (store action)
// ---------------------------------------------------------------------------

describe('recalibrateRemainingWeeks', () => {
  beforeEach(() => {
    mocks.plans.clear()
    mocks.weeks.clear()
    mocks.sessions.clear()
    mocks.weekSummaries.clear()
    mocks.buildPlanBuilderRecentContext.mockReset().mockResolvedValue({ hasHistory: true, livedPlanWeeks: [] })
    mocks.triggerBackgroundGeneration.mockReset().mockResolvedValue({ jobId: 'new-job' })
    mocks.pollPlanGeneration.mockReset().mockResolvedValue(null)
    mocks.fetchPlanGenerationSnapshot.mockReset().mockResolvedValue(null)
    mocks.pushTrainingPlan.mockReset().mockResolvedValue('pushed')
    mocks.assertPlanBuilderWeekRateLimit.mockReset().mockResolvedValue(undefined)
    mocks.reservePlanBuilderWeekUsage.mockReset().mockResolvedValue([])
    mocks.releasePlanBuilderWeekReservations.mockReset().mockResolvedValue(0)
    mocks.syncPlanBuilderWeekUsageFromWeeks.mockReset().mockResolvedValue(undefined)
    mocks.supabase = { auth: {} }
    mocks.authUser = { id: 'user-1' }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function seedActivePlan(weeks: TrainingPlanWeek[], planOverrides: Partial<TrainingPlan> = {}) {
    const plan = makePlan({ totalWeeks: weeks.length, ...planOverrides })
    mocks.plans.set(plan.id, plan)
    for (const week of weeks) mocks.weeks.set(week.id, week)
    usePlanBuilderStore.setState({
      plan,
      weeks,
      status: 'ready',
      completedWeeks: weeks.length,
      failedWeekIndexes: [],
      lastError: null,
    })
    return plan
  }

  it('pide el contexto reciente con asOfDate = hoy', async () => {
    const profile = makeProfile()
    seedActivePlan(makeFourWeeks())

    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)

    expect(mocks.buildPlanBuilderRecentContext).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      undefined,
      expect.objectContaining({ asOfDate: expect.any(String) }),
    )
  })

  it('reconcilia aunque se pierda la confirmación del enqueue remoto', async () => {
    seedActivePlan(makeFourWeeks())
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(new Error('connection lost'))
    mocks.fetchPlanGenerationSnapshot.mockImplementationOnce(async () => ({
      plan: { ...mocks.plans.get('plan-1')!, generationState: 'complete' },
      weeks: [makeWeek({ id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15',
        sessions: makeProposalSession('2026-06-16') }),
        makeWeek({ id: 'week-3', weekIndex: 3, weekStartDate: '2026-06-22', status: 'error' })],
      isTerminal: true, isStalled: false,
    }))

    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(makeProfile())

    expect(mocks.plans.get('plan-1')?.pendingRecalibration).toBeUndefined()
    expect(Array.from(mocks.sessions.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-06-16', planWeekId: 'week-2' }),
    ]))
    expect(mocks.releasePlanBuilderWeekReservations).not.toHaveBeenCalled()
  })

  it('sólo regenera las semanas futuras', async () => {
    const profile = makeProfile()
    seedActivePlan(makeFourWeeks())

    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)

    expect(mocks.triggerBackgroundGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ targetWeekIndexes: [2, 3] }),
    )
  })

  it('no hace nada si no hay semanas futuras', async () => {
    const profile = makeProfile()
    // Última semana del plan ya pasó (hoy es 2026-06-10; la semana 1 termina 2026-06-14).
    seedActivePlan([
      makeWeek({ id: 'week-0', weekIndex: 0, weekStartDate: '2026-05-25', status: 'accepted' }),
      makeWeek({ id: 'week-1', weekIndex: 1, weekStartDate: '2026-06-01', status: 'accepted' }),
    ])

    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)

    expect(mocks.triggerBackgroundGeneration).not.toHaveBeenCalled()
    expect(usePlanBuilderStore.getState().status).toBe('ready')
  })

  it('libera la cuota reservada si el disparo falla de forma definitiva', async () => {
    const profile = makeProfile()
    seedActivePlan(makeFourWeeks())
    mocks.triggerBackgroundGeneration.mockRejectedValueOnce(
      new PlanEnqueueRejectedError(
        'El servicio alcanzó su presupuesto diario.',
        429,
        null,
        { errorCode: 'spend_cap_exceeded', detail: { scope: 'global', capUsd: 5 } },
      ),
    )

    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)

    expect(mocks.releasePlanBuilderWeekReservations).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan-1', weekIndexes: [2, 3] }),
    )
    expect(usePlanBuilderStore.getState().status).toBe('error')
    expect(usePlanBuilderStore.getState().entitlementOffer).toBeNull()
  })

  // Important 2 (a): el marcador se escribe ANTES de disparar la generación,
  // para que sobreviva si esta pestaña se cierra antes de que el polling
  // termine — ver `recoverPendingRecalibrationIfTerminal` más abajo.
  it('escribe un marcador durable de recalibración pendiente antes de disparar', async () => {
    const profile = makeProfile()
    seedActivePlan(makeFourWeeks())

    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)

    expect(mocks.plans.get('plan-1')?.pendingRecalibration).toEqual({
      weekIndexes: [2, 3],
      requestedAt: expect.any(Number),
    })
  })

  // Important 2 (b) + Important 4: cuando el polling remoto ve el snapshot
  // terminal, la reconciliación corre, limpia el marcador y sube el recuento
  // de lo reemplazado/conservado a `recalibrationNotice` — el mismo canal
  // que ya mira esta página, no `console.info`.
  it('limpia el marcador y sube el recuento a recalibrationNotice tras reconciliar', async () => {
    const profile = makeProfile()
    seedActivePlan(makeFourWeeks())

    const oldPlanned = makeStoredSession('old-planned-w2', '2026-06-16', 'Sesión previa semana 2')
    mocks.sessions.set(oldPlanned.id, oldPlanned)

    const week0 = makeWeek({ id: 'week-0', weekIndex: 0, weekStartDate: '2026-06-01', status: 'accepted' })
    const week1 = makeWeek({ id: 'week-1', weekIndex: 1, weekStartDate: '2026-06-08', status: 'accepted' })
    const week2Generated = makeWeek({
      id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15', status: 'draft',
      sessions: makeProposalSession('2026-06-16'),
    })
    const week3Generated = makeWeek({
      id: 'week-3', weekIndex: 3, weekStartDate: '2026-06-22', status: 'draft',
      sessions: makeProposalSession('2026-06-23'),
    })

    mocks.pollPlanGeneration.mockResolvedValueOnce({
      plan: makePlan({ generationState: 'complete' }),
      weeks: [week0, week1, week2Generated, week3Generated],
      isTerminal: true,
      isStalled: false,
    })

    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)

    // El disparo ya dejó el marcador puesto (test anterior); esperamos a que
    // el `.then()` de la reconciliación —encadenado al polling mockeado—
    // termine de correr y lo limpie.
    await vi.waitFor(() => {
      expect(mocks.plans.get('plan-1')?.pendingRecalibration).toBeUndefined()
    })

    expect(usePlanBuilderStore.getState().recalibrationNotice).toEqual(
      expect.arrayContaining([expect.stringContaining('reemplazo')]),
    )
    expect(mocks.sessions.has(oldPlanned.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// reconcileRecalibratedWeeks (Step 3b — materializa el calendario real)
// ---------------------------------------------------------------------------

describe('reconcileRecalibratedWeeks', () => {
  beforeEach(() => {
    mocks.sessions.clear()
    mocks.weekSummaries.clear()
    mocks.trainingStore.addSession.mockClear()
    mocks.trainingStore.addSession.mockImplementation(async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
      const created: Session = {
        ...session,
        id: `session-${mocks.sessions.size + 1}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        weekStartDate: session.weekStartDate,
      }
      mocks.sessions.set(created.id, created)
      return created
    })
    mocks.trainingStore.loadWeek.mockClear()
    mocks.trainingStore.loadAllSummaries.mockClear()
    vi.mocked(syncService.deleteSession).mockClear()
    vi.mocked(syncService.pushSession).mockClear()
  })

  const plan = makePlan()

  it('bloquea duras cruzadas antes de escribir el calendario recalibrado', async () => {
    const week = makeWeek({ id: 'w2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: [
        { ...makeProposalSession('2026-06-16')[0], rpe: 8 },
        { ...makeProposalSession('2026-06-16', 'PM')[0], sessionType: 'running', rpe: 8 },
      ] })
    const old = makeStoredSession('old', '2026-06-16', 'Anterior')
    mocks.sessions.set(old.id, old)
    const result = await reconcileRecalibratedWeeks({ plan, weeks: [week],
      target: { weekIndexes: [2], asOfDate: '2026-06-10', livedWeekCount: 1 }, profile: makeProfile() })
    expect(result.skippedWeekIndexes).toEqual([2])
    expect(mocks.sessions.get(old.id)).toEqual(old)
    expect(mocks.trainingStore.addSession).not.toHaveBeenCalled()
  })

  it('reemplaza las sesiones planificadas de las semanas futuras', async () => {
    const oldPlanned = makeStoredSession('old-planned', '2026-06-16', 'Sesión previa')
    mocks.sessions.set(oldPlanned.id, oldPlanned)

    const week2 = makeWeek({
      id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: makeProposalSession('2026-06-16'),
    })

    const result = await reconcileRecalibratedWeeks({
      plan,
      weeks: [week2],
      target: { weekIndexes: [2], asOfDate: '2026-06-10', livedWeekCount: 1 },
      profile: makeProfile(),
    })

    expect(result.warnings.some((w) => w.includes('reemplazo'))).toBe(true)
    expect(mocks.sessions.has(oldPlanned.id)).toBe(false)
    expect(vi.mocked(syncService.deleteSession)).toHaveBeenCalledWith(oldPlanned.id)
    expect(Array.from(mocks.sessions.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-06-16', planId: plan.id, planWeekId: 'week-2' }),
    ]))
  })

  it('nunca borra una sesión completada, aunque caiga en el rango', async () => {
    const completed = makeStoredSession('done-1', '2026-06-17', 'Sesión completada', {
      status: 'completed',
      completedAt: 1,
    })
    mocks.sessions.set(completed.id, completed)

    const week2 = makeWeek({
      id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: makeProposalSession('2026-06-16'),
    })

    await reconcileRecalibratedWeeks({
      plan,
      weeks: [week2],
      target: { weekIndexes: [2], asOfDate: '2026-06-10', livedWeekCount: 1 },
      profile: makeProfile(),
    })

    expect(mocks.sessions.has(completed.id)).toBe(true)
    expect(vi.mocked(syncService.deleteSession)).not.toHaveBeenCalledWith(completed.id)
  })

  it('preserva las sesiones manuales del atleta', async () => {
    const manual = makeStoredSession('manual-1', '2026-06-16', 'Sesión manual', { source: 'manual' })
    mocks.sessions.set(manual.id, manual)

    const week2 = makeWeek({
      id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: makeProposalSession('2026-06-17'),
    })

    await reconcileRecalibratedWeeks({
      plan,
      weeks: [week2],
      target: { weekIndexes: [2], asOfDate: '2026-06-10', livedWeekCount: 1 },
      profile: makeProfile(),
    })

    expect(mocks.sessions.has(manual.id)).toBe(true)
    expect(vi.mocked(syncService.deleteSession)).not.toHaveBeenCalledWith(manual.id)
  })

  it('no toca ninguna sesión de la semana en curso', async () => {
    const currentWeekSession = makeStoredSession('current-week-1', '2026-06-09', 'Sesión de la semana en curso')
    mocks.sessions.set(currentWeekSession.id, currentWeekSession)

    // `weeks` incluye la semana en curso (índice 1), pero el `target` —como
    // siempre produce `selectRecalibrationTargets`— sólo lista futuras.
    const currentWeek = makeWeek({
      id: 'week-1', weekIndex: 1, weekStartDate: '2026-06-08',
      sessions: makeProposalSession('2026-06-09'),
    })
    const futureWeek = makeWeek({
      id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: makeProposalSession('2026-06-16'),
    })

    await reconcileRecalibratedWeeks({
      plan,
      weeks: [currentWeek, futureWeek],
      target: { weekIndexes: [2], asOfDate: '2026-06-10', livedWeekCount: 1 },
      profile: makeProfile(),
    })

    expect(mocks.sessions.get(currentWeekSession.id)).toEqual(currentWeekSession)
    expect(vi.mocked(syncService.deleteSession)).not.toHaveBeenCalledWith(currentWeekSession.id)
  })

  it('revierte la semana si la reconciliación falla a mitad', async () => {
    const week2Original = makeStoredSession('week2-original', '2026-06-16', 'Sesión previa semana 2')
    mocks.sessions.set(week2Original.id, week2Original)
    // Minor (fix de revisión): la semana que FALLA es la que sufre mutación
    // real — `applyCreateWeek` borra su sesión planificada previa ANTES de
    // llamar a `addSession`, que es donde recién lanza. Sin sembrar esta
    // sesión, el rollback de week-3 nunca se ejercitaba de verdad.
    const week3Original = makeStoredSession('week3-original', '2026-06-23', 'Sesión previa semana 3')
    mocks.sessions.set(week3Original.id, week3Original)
    const week2OriginalSummary: WeekSummary = {
      id: 'summary-2026-06-15',
      weekStartDate: '2026-06-15',
      totalSessions: 1,
      totalMinutes: 60,
      plannedSessions: 1,
      completedSessions: 0,
      plannedMinutes: 60,
      completedMinutes: 0,
      squashSessions: 1,
      runningSessions: 0,
      strengthSessions: 0,
      objectives: ['Objetivo previo'],
    }
    mocks.weekSummaries.set(week2OriginalSummary.weekStartDate, week2OriginalSummary)

    mocks.trainingStore.addSession.mockImplementation(async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (session.date === '2026-06-23') {
        throw new Error('fallo al guardar semana 3')
      }
      const created: Session = {
        ...session,
        id: 'new-week2-session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        weekStartDate: session.weekStartDate,
      }
      mocks.sessions.delete(week2Original.id)
      mocks.sessions.set(created.id, created)
      return created
    })

    const week2 = makeWeek({
      id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: makeProposalSession('2026-06-16'),
    })
    const week3 = makeWeek({
      id: 'week-3', weekIndex: 3, weekStartDate: '2026-06-22',
      sessions: makeProposalSession('2026-06-23'),
    })

    await expect(reconcileRecalibratedWeeks({
      plan,
      weeks: [week2, week3],
      target: { weekIndexes: [2, 3], asOfDate: '2026-06-10', livedWeekCount: 1 },
      profile: makeProfile(),
    })).rejects.toThrow('fallo al guardar semana 3')

    expect(mocks.sessions.has(week2Original.id)).toBe(true)
    expect(mocks.sessions.has('new-week2-session')).toBe(false)
    expect(mocks.weekSummaries.get('2026-06-15')).toEqual(week2OriginalSummary)
    // La semana que falló también queda restaurada a su estado previo, no
    // sólo la que ya se había aplicado con éxito.
    expect(mocks.sessions.get(week3Original.id)).toEqual(week3Original)
  })

  // Important 3: `reconcileRecalibratedWeeks` ya no depende en silencio de
  // que `applyCreateWeek` haga early-return con `sessions: []`; filtra
  // explícitamente las semanas sin contenido listo y lo reporta por nombre.
  it('salta explícitamente una semana sin sesiones generadas y lo reporta por nombre', async () => {
    const week2 = makeWeek({
      id: 'week-2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: makeProposalSession('2026-06-16'),
    })
    // La semana 3 no llegó a generar contenido (p. ej. terminó en `error`).
    const week3NotReady = makeWeek({
      id: 'week-3', weekIndex: 3, weekStartDate: '2026-06-22', status: 'error', sessions: [],
    })

    const result = await reconcileRecalibratedWeeks({
      plan,
      weeks: [week2, week3NotReady],
      target: { weekIndexes: [2, 3], asOfDate: '2026-06-10', livedWeekCount: 1 },
      profile: makeProfile(),
    })

    expect(result.skippedWeekIndexes).toEqual([3])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Semana 4 no se recalibró'),
    ]))
    // La semana 2, que sí estaba lista, se recalibró igual.
    expect(Array.from(mocks.sessions.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-06-16', planWeekId: 'week-2' }),
    ]))
  })
})

// ---------------------------------------------------------------------------
// recoverPendingRecalibrationIfTerminal (Important 2, c/d — red de seguridad
// al cargar un plan cuya pestaña de recalibración ya no existe)
// ---------------------------------------------------------------------------

describe('loadDraft recupera un marcador de recalibración pendiente', () => {
  beforeEach(() => {
    mocks.plans.clear()
    mocks.weeks.clear()
    mocks.sessions.clear()
    mocks.weekSummaries.clear()
    mocks.jobs.clear()
    mocks.fetchPlanGenerationSnapshot.mockReset().mockResolvedValue(null)
    mocks.supabase = null
    mocks.authUser = null
    coachMemoryGetState.mockReset().mockReturnValue({ athleteProfile: null })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('(c) reconcilia y limpia el marcador si las semanas objetivo ya terminaron', async () => {
    const plan = makePlan({
      id: 'plan-recover-c',
      status: 'active',
      generationState: 'complete',
      pendingRecalibration: { weekIndexes: [2], requestedAt: 1000 },
    })
    mocks.plans.set(plan.id, plan)
    const week0 = makeWeek({ id: 'w0', weekIndex: 0, weekStartDate: '2026-06-01', status: 'accepted', planId: plan.id })
    const week1 = makeWeek({ id: 'w1', weekIndex: 1, weekStartDate: '2026-06-08', status: 'accepted', planId: plan.id })
    const week2 = makeWeek({
      id: 'w2', weekIndex: 2, weekStartDate: '2026-06-15', status: 'draft', planId: plan.id,
      sessions: makeProposalSession('2026-06-16'),
    })
    for (const week of [week0, week1, week2]) mocks.weeks.set(week.id, week)

    await usePlanBuilderStore.getState().loadDraft(plan.id)

    expect(mocks.plans.get(plan.id)?.pendingRecalibration).toBeUndefined()
    expect(Array.from(mocks.sessions.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-06-16', planWeekId: 'w2' }),
    ]))
    expect(usePlanBuilderStore.getState().plan?.pendingRecalibration).toBeUndefined()
  })

  it('reconcilia al recuperar una corrida remota que terminó con la página cerrada', async () => {
    const plan = makePlan({ generationState: 'generating',
      pendingRecalibration: { weekIndexes: [2], requestedAt: 1000 } })
    const pending = makeWeek({ id: 'w2', weekIndex: 2, weekStartDate: '2026-06-15', status: 'generating' })
    const finished = { ...pending, status: 'draft' as const, sessions: makeProposalSession('2026-06-16') }
    mocks.plans.set(plan.id, plan)
    mocks.weeks.set(pending.id, pending)
    mocks.supabase = { auth: {} }
    mocks.fetchPlanGenerationSnapshot.mockResolvedValue({ plan: { ...plan, generationState: 'complete' },
      weeks: [finished], isTerminal: true, isStalled: false })

    await usePlanBuilderStore.getState().loadDraft(plan.id)

    expect(mocks.plans.get(plan.id)?.pendingRecalibration).toBeUndefined()
    expect(Array.from(mocks.sessions.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-06-16', planWeekId: 'w2' }),
    ]))
  })

  it('continúa la reconciliación al recargar mientras el worker aún genera', async () => {
    const plan = makePlan({ generationState: 'generating',
      pendingRecalibration: { weekIndexes: [2], requestedAt: 1000 } })
    const pending = makeWeek({ id: 'w2', weekIndex: 2, weekStartDate: '2026-06-15', status: 'generating' })
    mocks.plans.set(plan.id, plan)
    mocks.weeks.set(pending.id, pending)
    mocks.supabase = { auth: {} }
    mocks.fetchPlanGenerationSnapshot.mockResolvedValueOnce({ plan, weeks: [pending],
      isTerminal: false, isStalled: false })
    mocks.pollPlanGeneration.mockResolvedValueOnce({ plan: { ...plan, generationState: 'complete' },
      weeks: [{ ...pending, status: 'draft', sessions: makeProposalSession('2026-06-16') }],
      isTerminal: true, isStalled: false })

    await usePlanBuilderStore.getState().loadDraft(plan.id)

    await vi.waitFor(() => expect(mocks.plans.get(plan.id)?.pendingRecalibration).toBeUndefined())
    expect(Array.from(mocks.sessions.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-06-16', planWeekId: 'w2' }),
    ]))
  })

  it('no reemplaza una semana que dejó de ser futura al reabrir la página', async () => {
    const plan = makePlan({ pendingRecalibration: { weekIndexes: [1, 2], requestedAt: 1000 } })
    const current = makeWeek({ id: 'w1', weekIndex: 1, weekStartDate: '2026-06-08',
      sessions: makeProposalSession('2026-06-09') })
    const future = makeWeek({ id: 'w2', weekIndex: 2, weekStartDate: '2026-06-15',
      sessions: makeProposalSession('2026-06-16') })
    mocks.plans.set(plan.id, plan)
    for (const week of [current, future]) mocks.weeks.set(week.id, week)
    const old = makeStoredSession('current', '2026-06-09', 'Semana en curso')
    mocks.sessions.set(old.id, old)

    await usePlanBuilderStore.getState().loadDraft(plan.id)

    expect(mocks.sessions.get(old.id)).toEqual(old)
    expect(Array.from(mocks.sessions.values()).filter((session) => session.date === '2026-06-09')).toHaveLength(1)
    expect(usePlanBuilderStore.getState().recalibrationNotice?.join(' ')).toContain('ya no es una semana futura')
  })

  it('(d) NO reconcilia si alguna semana objetivo sigue generándose', async () => {
    const plan = makePlan({
      id: 'plan-recover-d',
      status: 'active',
      generationState: 'generating',
      pendingRecalibration: { weekIndexes: [2], requestedAt: 1000 },
    })
    mocks.plans.set(plan.id, plan)
    const week0 = makeWeek({ id: 'w0', weekIndex: 0, weekStartDate: '2026-06-01', status: 'accepted', planId: plan.id })
    const week1 = makeWeek({ id: 'w1', weekIndex: 1, weekStartDate: '2026-06-08', status: 'accepted', planId: plan.id })
    const week2Generating = makeWeek({
      id: 'w2', weekIndex: 2, weekStartDate: '2026-06-15', status: 'generating', sessions: [], planId: plan.id,
    })
    for (const week of [week0, week1, week2Generating]) mocks.weeks.set(week.id, week)

    await usePlanBuilderStore.getState().loadDraft(plan.id)

    // El marcador sigue puesto: nadie reconcilió nada todavía.
    expect(mocks.plans.get(plan.id)?.pendingRecalibration).toEqual({ weekIndexes: [2], requestedAt: 1000 })
    expect(mocks.sessions.size).toBe(0)
  })

  // Minor (fix de revisión 2/5): `recoverPendingRecalibrationIfTerminal` es
  // el único de los tres caminos que corre en `loadDraft` — exactamente
  // cuando es más probable que el atleta activo cambie (hidratación,
  // `switchActiveAthlete`). Simulamos ese cambio "a mitad de camino"
  // haciendo que la lectura del perfil (el último paso síncrono antes de la
  // reconciliación real) dispare el cambio de epoch, y verificamos que
  // `reconcileAfterRecalibration` se revalida a sí misma antes de escribir
  // sesiones y no las estampa bajo el atleta equivocado.
  it('no escribe sesiones si el atleta activo cambia justo antes de reconciliar', async () => {
    const plan = makePlan({
      id: 'plan-recover-race',
      status: 'active',
      generationState: 'complete',
      pendingRecalibration: { weekIndexes: [2], requestedAt: 1000 },
    })
    mocks.plans.set(plan.id, plan)
    const week0 = makeWeek({ id: 'w0', weekIndex: 0, weekStartDate: '2026-06-01', status: 'accepted', planId: plan.id })
    const week1 = makeWeek({ id: 'w1', weekIndex: 1, weekStartDate: '2026-06-08', status: 'accepted', planId: plan.id })
    const week2 = makeWeek({
      id: 'w2', weekIndex: 2, weekStartDate: '2026-06-15', status: 'draft', planId: plan.id,
      sessions: makeProposalSession('2026-06-16'),
    })
    for (const week of [week0, week1, week2]) mocks.weeks.set(week.id, week)

    // El atleta activo cambia justo antes de que `reconcileAfterRecalibration`
    // dispare la escritura real.
    coachMemoryGetState.mockImplementation(() => {
      bumpSwitchEpoch()
      return { athleteProfile: null }
    })

    await usePlanBuilderStore.getState().loadDraft(plan.id)

    // Nada se escribió bajo el atleta (ahora equivocado), y el marcador
    // sigue puesto para que una carga posterior, ya estable, lo reintente.
    expect(mocks.sessions.size).toBe(0)
    expect(mocks.plans.get(plan.id)?.pendingRecalibration).toEqual({ weekIndexes: [2], requestedAt: 1000 })
  })
})
