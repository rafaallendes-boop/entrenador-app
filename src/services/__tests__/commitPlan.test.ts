import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, Session, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const sessionsById = new Map<string, Session>()
const weekSummariesByStart = new Map<string, WeekSummary>()
const trainingPlansById = new Map<string, TrainingPlan>()
const trainingPlanPuts: TrainingPlan[] = []
const trainingPlanWeekPuts: TrainingPlanWeek[] = []

const trainingStoreState = {
  loadedWeekStart: null as string | null,
  loadWeek: vi.fn(async () => {}),
  loadAllSummaries: vi.fn(async () => {}),
  addSession: vi.fn(async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
    const created: Session = {
      ...session,
      id: `session-${sessionsById.size + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      weekStartDate: session.weekStartDate ?? '2026-05-04',
    }
    sessionsById.set(created.id, created)
    return created
  }),
}
let trainingStoreSnapshot = trainingStoreState

const athleteProfileState = {
  athleteProfile: {
    id: 'athlete-1',
    updatedAt: 1,
    name: 'Rafa',
    primarySport: 'squash',
    sportContext: {
      enabledSports: ['squash', 'running', 'strength'],
      primarySport: 'squash',
    },
  } as AthleteProfile,
}

vi.mock('../../db/db', () => ({
  db: {
    transaction: vi.fn(async (_mode: string, ...args: unknown[]) => {
      const callback = args[args.length - 1]
      if (typeof callback === 'function') {
        return callback()
      }
    }),
    sessions: {
      toArray: vi.fn(async () => Array.from(sessionsById.values())),
      where: vi.fn(() => ({
        aboveOrEqual: vi.fn((start: string) => ({
          toArray: vi.fn(async () =>
            Array.from(sessionsById.values()).filter((session) => session.date >= start),
          ),
        })),
        between: vi.fn((start: string, end: string) => ({
          toArray: vi.fn(async () =>
            Array.from(sessionsById.values()).filter((session) => session.date >= start && session.date <= end),
          ),
        })),
        anyOf: vi.fn((dates: string[]) => ({
          toArray: vi.fn(async () =>
            Array.from(sessionsById.values()).filter((session) => dates.includes(session.date)),
          ),
        })),
      })),
      put: vi.fn(async (session: Session) => {
        sessionsById.set(session.id, session)
      }),
      delete: vi.fn(async (id: string) => {
        sessionsById.delete(id)
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        ids.forEach((id) => sessionsById.delete(id))
      }),
    },
    weekSummaries: {
      get: vi.fn(async (weekStartDate: string) => weekSummariesByStart.get(weekStartDate)),
      put: vi.fn(async (summary: WeekSummary) => {
        weekSummariesByStart.set(summary.weekStartDate, summary)
      }),
      delete: vi.fn(async (id: string) => {
        for (const [weekStart, summary] of weekSummariesByStart.entries()) {
          if (summary.id === id) weekSummariesByStart.delete(weekStart)
        }
      }),
    },
    trainingPlans: {
      toArray: vi.fn(async () => Array.from(trainingPlansById.values())),
      put: vi.fn(async (plan: TrainingPlan) => {
        trainingPlansById.set(plan.id, plan)
        trainingPlanPuts.push(plan)
      }),
      bulkPut: vi.fn(async (plans: TrainingPlan[]) => {
        plans.forEach((plan) => {
          trainingPlansById.set(plan.id, plan)
          trainingPlanPuts.push(plan)
        })
      }),
    },
    trainingPlanWeeks: {
      put: vi.fn(async (week: TrainingPlanWeek) => {
        trainingPlanWeekPuts.push(week)
      }),
      bulkPut: vi.fn(async (weeks: TrainingPlanWeek[]) => {
        trainingPlanWeekPuts.push(...weeks)
      }),
    },
  },
}))

vi.mock('../../db/queries', () => ({
  getWeekSummary: vi.fn(async (weekStartDate: string) => weekSummariesByStart.get(weekStartDate)),
  recalculateWeekSummary: vi.fn(async () => {}),
  upsertWeekSummary: vi.fn(async (weekStartDate: string, patch: { objectives?: string[] }) => {
    const summary: WeekSummary = weekSummariesByStart.get(weekStartDate) ?? {
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
    const nextSummary = {
      ...summary,
      objectives: patch.objectives ?? summary.objectives,
    }
    weekSummariesByStart.set(weekStartDate, nextSummary)
    return nextSummary
  }),
}))

vi.mock('../syncService', () => ({
  pushSession: vi.fn(),
  deleteSession: vi.fn(),
  pullSessionsForDateRange: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(),
  pushTrainingPlan: vi.fn(async () => 'pushed' as const),
  pushTrainingPlanWeeks: vi.fn(async () => {}),
}))

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: {
    getState: () => trainingStoreSnapshot,
  },
}))

vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: {
    getState: () => athleteProfileState,
  },
}))

import { commitPlan } from '../planBuilder/commitPlan'
import { analyzePlanCommitImpact } from '../planBuilder/commitImpact'
import { db } from '../../db/db'

function makePlan(totalWeeks = 2): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'complete',
    title: 'Plan regional',
    startDate: '2026-05-04',
    endDate: '2026-05-17',
    totalWeeks,
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
      goalEventDate: '2026-06-01',
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
  }
}

function makeWeek(args: {
  id: string
  weekIndex: number
  weekStartDate: string
  status?: TrainingPlanWeek['status']
  sessions?: TrainingPlanWeek['sessions']
}): TrainingPlanWeek {
  return {
    id: args.id,
    planId: 'plan-1',
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

function makeProposalSession(date: string) {
  return [
    {
      date,
      timeBlock: 'AM' as const,
      sessionType: 'squash' as const,
      title: `Sesion ${date}`,
      durationMin: 60,
      squashDetails: {
        trainingFocus: 'technical' as const,
        drills: [],
        sessionMode: 'drill_session' as const,
      },
    },
    {
      date,
      timeBlock: 'PM' as const,
      sessionType: 'squash' as const,
      title: `Sesion tarde ${date}`,
      durationMin: 45,
      squashDetails: {
        trainingFocus: 'tactical' as const,
        drills: [],
        sessionMode: 'drill_session' as const,
      },
    },
  ]
}

function makeStoredSession(id: string, date: string, title: string): Session {
  return {
    id,
    date,
    weekStartDate: '2026-05-04',
    timeBlock: 'AM',
    type: 'squash',
    source: 'manual',
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
  }
}

function makeStoredHistorySession(id: string, date: string, timeBlock: Session['timeBlock'], title: string): Session {
  return {
    ...makeStoredSession(id, date, title),
    timeBlock,
    status: 'completed',
    completedAt: 1,
  }
}

beforeEach(() => {
  sessionsById.clear()
  weekSummariesByStart.clear()
  trainingPlansById.clear()
  trainingStoreSnapshot = trainingStoreState
  trainingPlanPuts.length = 0
  trainingPlanWeekPuts.length = 0
  trainingStoreState.loadedWeekStart = null
  trainingStoreState.loadWeek.mockClear()
  trainingStoreState.loadAllSummaries.mockClear()
  trainingStoreState.addSession.mockClear()
})

describe('commitPlan', () => {
  it('previews the full replacementRange, including a planned day with no proposed session', async () => {
    const plan = {
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
      },
    }
    const plannedToReplace: Session = {
      ...makeStoredSession('old-planned', '2026-05-05', 'Sesion previa'),
      source: 'coach',
      planId: 'plan-old',
      planWeekId: 'plan-old-week',
    }
    const completedToPreserve = makeStoredHistorySession('done-1', '2026-05-05', 'PM', 'Sesion completada')
    const untouchedPlanned: Session = {
      ...makeStoredSession('untouched', '2026-05-06', 'Sesion futura'),
      source: 'coach',
      planId: 'plan-old',
      planWeekId: 'plan-old-week',
    }
    sessionsById.set(plannedToReplace.id, plannedToReplace)
    sessionsById.set(completedToPreserve.id, completedToPreserve)
    sessionsById.set(untouchedPlanned.id, untouchedPlanned)

    const impact = await analyzePlanCommitImpact(plan, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ], athleteProfileState.athleteProfile)

    expect(impact.totals.generatedSessions).toBe(2)
    expect(impact.totals.creatableSessions).toBe(1)
    expect(impact.totals.replacedPlannedSessions).toBe(2)
    expect(impact.totals.preservedHistorySessions).toBe(1)
    expect(impact.totals.blockedByHistorySessions).toBe(1)
    expect(impact.totals.untouchedPlannedSessions).toBe(0)
    expect(impact.hasHistoryConflicts).toBe(true)
    expect(impact.weeks[0]?.blockedByHistorySessions[0]?.existing.id).toBe('done-1')
  })

  it('refuses to activate a plan when at least one week is not ready', async () => {
    const result = await commitPlan(makePlan(), [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
      makeWeek({
        id: 'week-2',
        weekIndex: 1,
        weekStartDate: '2026-05-11',
        status: 'error',
        sessions: [],
      }),
    ])

    expect(result.errors).toEqual(['Semana 2 no está lista para aceptar (estado error).'])
    expect(trainingStoreState.addSession).not.toHaveBeenCalled()
    expect(trainingPlanPuts).toHaveLength(0)
    expect(trainingPlanWeekPuts).toHaveLength(0)
  })

  it('blocks commit when validation detects a missing primary sport week', async () => {
    const result = await commitPlan(makePlan(1), [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: [{
          date: '2026-05-05',
          timeBlock: 'AM',
          sessionType: 'running',
          title: 'Rodaje',
          durationMin: 45,
        }],
      }),
    ])

    expect(result.errors.some((error) => error.includes('no incluye sesiones de squash'))).toBe(true)
    expect(trainingStoreState.addSession).not.toHaveBeenCalled()
    expect(trainingPlanPuts).toHaveLength(0)
  })

  it('rolls back previously accepted weeks when a later week fails', async () => {
    const plan = {
      ...makePlan(),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'] as TrainingPlan['wizardConfig']['trainingDays'],
        sessionsPerWeek: 2,
      },
    }
    const originalSession = makeStoredSession('old-1', '2026-05-05', 'Sesion previa')
    const originalSummary: WeekSummary = {
      id: 'summary-1',
      weekStartDate: '2026-05-04',
      totalSessions: 1,
      totalMinutes: 60,
      plannedSessions: 1,
      completedSessions: 0,
      plannedMinutes: 60,
      completedMinutes: 0,
      squashSessions: 0,
      runningSessions: 0,
      strengthSessions: 0,
      objectives: ['Mantener base'],
    }
    sessionsById.set(originalSession.id, originalSession)
    weekSummariesByStart.set(originalSummary.weekStartDate, originalSummary)

    trainingStoreState.addSession.mockImplementation(async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (session.date === '2026-05-12') {
        throw new Error('fallo al guardar semana')
      }
      const created: Session = {
        ...session,
        id: 'new-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        weekStartDate: session.weekStartDate ?? '2026-05-04',
      }
      sessionsById.delete(originalSession.id)
      sessionsById.set(created.id, created)
      return created
    })

    const result = await commitPlan(plan, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
      makeWeek({
        id: 'week-2',
        weekIndex: 1,
        weekStartDate: '2026-05-11',
        sessions: makeProposalSession('2026-05-12'),
      }),
    ])

    expect(result.errors).toEqual(['Semana 2: fallo al guardar semana'])
    expect(result.warnings).toContain('Se revirtieron 2 semanas afectadas antes o durante el fallo.')
    expect(result.acceptedWeeks).toEqual([])
    expect(sessionsById.has(originalSession.id)).toBe(true)
    expect(sessionsById.has('new-1')).toBe(false)
    expect(weekSummariesByStart.get('2026-05-04')).toEqual(originalSummary)
    expect(trainingPlanPuts).toHaveLength(0)
    expect(trainingPlanWeekPuts).toHaveLength(0)
    expect(trainingStoreState.loadAllSummaries).toHaveBeenCalledTimes(1)
  })

  it('rollback con gestionado activo no toca ni re-pushea sesiones del self (fuera de scope)', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
    const syncService = await import('../syncService')
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    try {
      const plan = {
        ...makePlan(),
        wizardConfig: {
          ...makePlan().wizardConfig,
          allowDoubleSession: true,
          trainingDays: ['monday'] as TrainingPlan['wizardConfig']['trainingDays'],
          sessionsPerWeek: 2,
        },
      }
      const managedOriginal: Session = {
        ...makeStoredSession('managed-old', '2026-05-05', 'Sesion previa del gestionado'),
        athleteId: 'ath_m_1',
      }
      const selfUntouched: Session = {
        ...makeStoredSession('self-untouched', '2026-05-05', 'Sesion del self'),
        timeBlock: 'PM',
        status: 'completed',
        athleteId: 'ath_self',
      }
      sessionsById.set(managedOriginal.id, managedOriginal)
      sessionsById.set(selfUntouched.id, selfUntouched)

      trainingStoreState.addSession.mockImplementation(async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (session.date === '2026-05-12') {
          throw new Error('fallo al guardar semana')
        }
        const created: Session = {
          ...session,
          id: 'new-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          weekStartDate: session.weekStartDate ?? '2026-05-04',
        }
        sessionsById.set(created.id, created)
        return created
      })

      const result = await commitPlan(plan, [
        makeWeek({
          id: 'week-1',
          weekIndex: 0,
          weekStartDate: '2026-05-04',
          sessions: makeProposalSession('2026-05-05'),
        }),
        makeWeek({
          id: 'week-2',
          weekIndex: 1,
          weekStartDate: '2026-05-11',
          sessions: makeProposalSession('2026-05-12'),
        }),
      ])

      expect(result.acceptedWeeks).toEqual([])
      // La sesión del self sobrevive intacta: ni borrada ni restaurada pisada.
      expect(sessionsById.get('self-untouched')).toMatchObject({ status: 'completed', athleteId: 'ath_self' })
      // Y el rollback NO la re-pushea ni la borra remotamente (estaba fuera de scope).
      const pushedIds = vi.mocked(syncService.pushSession).mock.calls.map(([s]) => (s as Session).id)
      expect(pushedIds).not.toContain('self-untouched')
      const deletedIds = vi.mocked(syncService.deleteSession).mock.calls.map(([id]) => id)
      expect(deletedIds).not.toContain('self-untouched')
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('commits accepted weeks without going through coach proposals', async () => {
    const plan = {
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'] as TrainingPlan['wizardConfig']['trainingDays'],
        sessionsPerWeek: 2,
      },
    }

    const result = await commitPlan(plan, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ])

    expect(result.errors).toEqual([])
    expect(result.acceptedWeeks).toEqual([0])
    expect(trainingStoreState.addSession).toHaveBeenCalledTimes(2)
    expect(trainingPlanPuts).toHaveLength(1)
    expect(trainingPlanWeekPuts).toHaveLength(1)
    expect(trainingPlanPuts[0]?.generationSummary?.qualityReview).toBeDefined()
    expect(trainingPlanPuts[0]?.generationSummary?.qualityReview?.weeks).toHaveLength(1)
    expect(Array.from(sessionsById.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: 'plan-1', planWeekId: 'week-1' }),
    ]))
  })

  it('supersedes prior active plans atomically and only removes their future generated sessions', async () => {
    const syncService = await import('../syncService')
    const previousActive = {
      ...makePlan(1),
      id: 'plan-old',
      status: 'active' as const,
      acceptedAt: 10,
      updatedAt: 10,
    }
    const otherAthleteActive = {
      ...makePlan(1),
      id: 'plan-other-athlete',
      athleteId: 'athlete-2',
      status: 'active' as const,
    }
    trainingPlansById.set(previousActive.id, previousActive)
    trainingPlansById.set(otherAthleteActive.id, otherAthleteActive)

    const generatedFuture: Session = {
      ...makeStoredSession('old-generated-future', '2099-01-04', 'Plan anterior'),
      athleteId: 'athlete-1',
      source: 'coach',
      planId: previousActive.id,
      planWeekId: 'old-week',
    }
    const manualFuture: Session = {
      ...makeStoredSession('manual-future', '2099-01-05', 'Manual'),
      athleteId: 'athlete-1',
      planId: previousActive.id,
      planWeekId: 'old-week',
    }
    const completedFuture: Session = {
      ...generatedFuture,
      id: 'completed-future',
      status: 'completed',
    }
    const adjustedFuture: Session = {
      ...generatedFuture,
      id: 'adjusted-future',
      status: 'adjusted',
    }
    const generatedPast: Session = {
      ...generatedFuture,
      id: 'old-generated-past',
      date: '2000-01-01',
    }
    for (const session of [generatedFuture, manualFuture, completedFuture, adjustedFuture, generatedPast]) {
      sessionsById.set(session.id, session)
    }

    const result = await commitPlan({
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'],
        sessionsPerWeek: 2,
      },
    }, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ])

    expect(result.errors).toEqual([])
    expect(trainingPlansById.get(previousActive.id)).toMatchObject({ status: 'superseded' })
    expect(trainingPlansById.get('plan-1')).toMatchObject({ status: 'active' })
    expect(trainingPlansById.get(otherAthleteActive.id)).toMatchObject({ status: 'active' })
    expect(Array.from(trainingPlansById.values()).filter((candidate) => (
      candidate.athleteId === 'athlete-1' && candidate.status === 'active'
    ))).toHaveLength(1)

    expect(sessionsById.has(generatedFuture.id)).toBe(false)
    expect(sessionsById.has(manualFuture.id)).toBe(true)
    expect(sessionsById.has(completedFuture.id)).toBe(true)
    expect(sessionsById.has(adjustedFuture.id)).toBe(true)
    expect(sessionsById.has(generatedPast.id)).toBe(true)

    await vi.waitFor(() => {
      expect(syncService.pushTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({
        id: previousActive.id,
        status: 'superseded',
      }))
      expect(syncService.pushTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({
        id: 'plan-1',
        status: 'active',
      }))
      expect(syncService.deleteSession).toHaveBeenCalledWith(generatedFuture.id)
    })
    expect(syncService.deleteSession).not.toHaveBeenCalledWith(manualFuture.id)
    expect(syncService.deleteSession).not.toHaveBeenCalledWith(completedFuture.id)
    expect(syncService.deleteSession).not.toHaveBeenCalledWith(adjustedFuture.id)
  })

  it('preserves the future gap before a future plan starts and previews later lifecycle cleanup', async () => {
    const nextPlan = {
      ...makePlan(1),
      startDate: '2099-02-02',
      endDate: '2099-02-08',
    }
    const previousActive = {
      ...makePlan(1),
      id: 'plan-old',
      status: 'active' as const,
    }
    trainingPlansById.set(previousActive.id, previousActive)
    const gapSession: Session = {
      ...makeStoredSession('gap-session', '2099-01-20', 'Mantener hasta el nuevo ciclo'),
      source: 'coach',
      planId: previousActive.id,
      planWeekId: 'old-week-gap',
    }
    const laterSession: Session = {
      ...makeStoredSession('later-session', '2099-02-10', 'Retirar con el ciclo anterior'),
      source: 'coach',
      planId: previousActive.id,
      planWeekId: 'old-week-later',
    }
    sessionsById.set(gapSession.id, gapSession)
    sessionsById.set(laterSession.id, laterSession)

    const impact = await analyzePlanCommitImpact(nextPlan, [
      makeWeek({
        id: 'future-week',
        weekIndex: 0,
        weekStartDate: '2099-02-02',
        sessions: makeProposalSession('2099-02-03'),
      }),
    ], athleteProfileState.athleteProfile)

    expect(impact.lifecycleRemovedSessions.map((session) => session.id)).toEqual([laterSession.id])
    expect(impact.totals.lifecycleRemovedSessions).toBe(1)
    expect(impact.lifecycleRemovedSessions).not.toContainEqual(expect.objectContaining({ id: gapSession.id }))
  })

  it('supersedes and scopes a legacy active self plan', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
    setSelfAthleteId('athlete-1')
    setActiveAthleteId('athlete-1')
    try {
      trainingPlansById.set('legacy-active', {
        ...makePlan(1),
        id: 'legacy-active',
        athleteId: undefined as never,
        status: 'active',
      })

      const result = await commitPlan({
        ...makePlan(1),
        wizardConfig: {
          ...makePlan().wizardConfig,
          allowDoubleSession: true,
          trainingDays: ['monday'],
          sessionsPerWeek: 2,
        },
      }, [
        makeWeek({
          id: 'week-1',
          weekIndex: 0,
          weekStartDate: '2026-05-04',
          sessions: makeProposalSession('2026-05-05'),
        }),
      ])

      expect(result.errors).toEqual([])
      expect(trainingPlansById.get('legacy-active')).toMatchObject({
        athleteId: 'athlete-1',
        status: 'superseded',
      })
    } finally {
      setActiveAthleteId(null)
      setSelfAthleteId(null)
    }
  })

  it('does not adopt a legacy active plan before athlete scope is hydrated', async () => {
    const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    trainingPlansById.set('legacy-active', {
      ...makePlan(1),
      id: 'legacy-active',
      athleteId: undefined as never,
      status: 'active',
    })

    const impact = await analyzePlanCommitImpact(makePlan(1), [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ], athleteProfileState.athleteProfile)

    expect(impact.lifecycleRemovedSessions).toEqual([])
  })

  it('publishes the new active parent durably before independent convergence work', async () => {
    const syncService = await import('../syncService')
    const previousActive = {
      ...makePlan(1),
      id: 'plan-old',
      status: 'active' as const,
    }
    trainingPlansById.set(previousActive.id, previousActive)
    const publicationOrder: string[] = []
    let releaseActive!: () => void
    const activePublished = new Promise<void>((resolve) => { releaseActive = resolve })
    vi.mocked(syncService.pushTrainingPlan).mockImplementation(async (candidate) => {
      publicationOrder.push(`${candidate.id}:${candidate.status}`)
      if (candidate.id === 'plan-1') await activePublished
      return 'pushed'
    })
    vi.mocked(syncService.pushTrainingPlanWeeks).mockImplementation(async () => {
      publicationOrder.push('plan-1:weeks')
    })

    let settled = false
    const commitPromise = commitPlan({
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'],
        sessionsPerWeek: 2,
      },
    }, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ]).then((result) => {
      settled = true
      return result
    })

    await vi.waitFor(() => {
      expect(publicationOrder).toEqual(['plan-1:active'])
    })
    expect(settled).toBe(false)
    releaseActive()

    const result = await commitPromise
    expect(result.errors).toEqual([])
    expect(publicationOrder[0]).toBe('plan-1:active')
    expect(publicationOrder).toEqual(expect.arrayContaining([
      'plan-old:superseded',
      'plan-1:weeks',
    ]))
    expect(settled).toBe(true)

    vi.mocked(syncService.pushTrainingPlan).mockReset().mockResolvedValue('pushed')
    vi.mocked(syncService.pushTrainingPlanWeeks).mockReset().mockResolvedValue(undefined)
  })

  it('does not converge destructive remote lifecycle changes when parent publication fails', async () => {
    const syncService = await import('../syncService')
    const previousActive = {
      ...makePlan(1),
      id: 'plan-old',
      status: 'active' as const,
    }
    trainingPlansById.set(previousActive.id, previousActive)
    const removed: Session = {
      ...makeStoredSession('old-generated-future', '2099-01-04', 'Plan anterior'),
      weekStartDate: '2098-12-29',
      athleteId: 'athlete-1',
      source: 'coach',
      planId: previousActive.id,
      planWeekId: 'old-week',
    }
    sessionsById.set(removed.id, removed)
    vi.mocked(syncService.pushTrainingPlan).mockReset().mockResolvedValue('failed')
    vi.mocked(syncService.pushTrainingPlanWeeks).mockClear()
    vi.mocked(syncService.deleteSession).mockClear()

    const result = await commitPlan({
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'],
        sessionsPerWeek: 2,
      },
    }, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ])

    expect(result.errors).toEqual([])
    expect(result.warnings).toContain(
      'El plan quedó activo en este dispositivo, pero no se pudo publicar. No se modificó el ciclo remoto anterior.',
    )
    expect(syncService.pushTrainingPlan).toHaveBeenCalledTimes(1)
    expect(syncService.pushTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: 'plan-1',
      status: 'active',
    }))
    expect(syncService.pushTrainingPlanWeeks).not.toHaveBeenCalled()
    expect(syncService.deleteSession).not.toHaveBeenCalled()
    expect(trainingPlansById.get('plan-1')).toMatchObject({ status: 'active' })
    expect(trainingPlansById.get(previousActive.id)).toMatchObject({ status: 'superseded' })

    vi.mocked(syncService.pushTrainingPlan).mockReset().mockResolvedValue('pushed')
  })

  it('keeps a local-only commit successful without launching remote convergence', async () => {
    const syncService = await import('../syncService')
    vi.mocked(syncService.pushTrainingPlan).mockReset().mockResolvedValue('no_remote')
    vi.mocked(syncService.pushTrainingPlanWeeks).mockClear()
    vi.mocked(syncService.deleteSession).mockClear()

    const result = await commitPlan({
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'],
        sessionsPerWeek: 2,
      },
    }, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ])

    expect(result.errors).toEqual([])
    expect(result.warnings).not.toContainEqual(expect.stringContaining('no se pudo publicar'))
    expect(syncService.pushTrainingPlanWeeks).not.toHaveBeenCalled()
    expect(syncService.deleteSession).not.toHaveBeenCalled()
    expect(trainingPlansById.get('plan-1')).toMatchObject({ status: 'active' })

    vi.mocked(syncService.pushTrainingPlan).mockReset().mockResolvedValue('pushed')
  })

  it('uses an indexed future-session query and a fresh training-store snapshot when refreshing cleanup', async () => {
    const previousActive = {
      ...makePlan(1),
      id: 'plan-old',
      status: 'active' as const,
    }
    trainingPlansById.set(previousActive.id, previousActive)
    const removed: Session = {
      ...makeStoredSession('old-generated-future', '2099-01-04', 'Plan anterior'),
      weekStartDate: '2098-12-29',
      athleteId: 'athlete-1',
      source: 'coach',
      planId: previousActive.id,
      planWeekId: 'old-week',
    }
    sessionsById.set(removed.id, removed)

    const freshLoadWeek = vi.fn(async () => {})
    const freshLoadAllSummaries = vi.fn(async () => {})
    const freshSnapshot = {
      ...trainingStoreState,
      loadedWeekStart: removed.weekStartDate,
      loadWeek: freshLoadWeek,
      loadAllSummaries: freshLoadAllSummaries,
    }
    vi.mocked(db.sessions.bulkDelete).mockImplementationOnce(async (ids: string[]) => {
      ids.forEach((id) => sessionsById.delete(id))
      trainingStoreState.loadWeek.mockClear()
      trainingStoreState.loadAllSummaries.mockClear()
      trainingStoreSnapshot = freshSnapshot
    })

    const result = await commitPlan({
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'],
        sessionsPerWeek: 2,
      },
    }, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ])

    expect(result.errors).toEqual([])
    expect(db.sessions.where).toHaveBeenCalledWith('date')
    expect(db.sessions.toArray).not.toHaveBeenCalled()
    expect(freshLoadWeek).toHaveBeenCalledWith(removed.weekStartDate)
    expect(freshLoadAllSummaries).toHaveBeenCalledTimes(1)
    expect(trainingStoreState.loadWeek).not.toHaveBeenCalled()
    expect(trainingStoreState.loadAllSummaries).not.toHaveBeenCalled()
  })

  it('preserves a planned manual session when the new plan targets the same slot', async () => {
    const manual = makeStoredSession('manual-slot', '2026-05-05', 'Sesion manual')
    sessionsById.set(manual.id, manual)

    const plan = {
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'] as TrainingPlan['wizardConfig']['trainingDays'],
        sessionsPerWeek: 2,
      },
    }
    const weeks = [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ]
    const impact = await analyzePlanCommitImpact(plan, weeks, athleteProfileState.athleteProfile)

    expect(impact.totals.replacedPlannedSessions).toBe(0)
    expect(impact.totals.preservedHistorySessions).toBe(1)
    expect(impact.totals.blockedByHistorySessions).toBe(1)
    expect(impact.totals.creatableSessions).toBe(1)

    const result = await commitPlan(plan, weeks)

    expect(result.errors).toEqual([])
    expect(sessionsById.get(manual.id)).toEqual(manual)
    expect(Array.from(sessionsById.values()).filter((session) => (
      session.date === manual.date && session.timeBlock === 'AM'
    ))).toEqual([manual])
    expect(Array.from(sessionsById.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: manual.date,
        timeBlock: 'PM',
        planId: 'plan-1',
        planWeekId: 'week-1',
      }),
    ]))
  })

  it('recomputes qualityReview on commit instead of preserving a stale generation review', async () => {
    const plan = {
      ...makePlan(1),
      generationSummary: {
        startedAt: 1,
        strategy: 'single' as const,
        completedWeeks: 1,
        failedWeeks: [],
        totalAttempts: 1,
        qualityReview: {
          qualityVersion: 1 as const,
          score: 42,
          grade: 'poor' as const,
          issues: [],
          weeks: [],
          repairCount: 0,
          criticalIssueCount: 0,
          warningCount: 0,
        },
      },
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
        trainingDays: ['monday'] as TrainingPlan['wizardConfig']['trainingDays'],
        sessionsPerWeek: 2,
      },
    }

    const result = await commitPlan(plan, [
      makeWeek({
        id: 'week-1',
        weekIndex: 0,
        weekStartDate: '2026-05-04',
        sessions: makeProposalSession('2026-05-05'),
      }),
    ])

    expect(result.errors).toEqual([])
    expect(trainingPlanPuts[0]?.generationSummary?.qualityReview?.score).not.toBe(42)
  })
})
