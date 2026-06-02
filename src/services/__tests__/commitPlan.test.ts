import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, Session, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const sessionsById = new Map<string, Session>()
const weekSummariesByStart = new Map<string, WeekSummary>()
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
      where: vi.fn(() => ({
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
      put: vi.fn(async (plan: TrainingPlan) => {
        trainingPlanPuts.push(plan)
      }),
    },
    trainingPlanWeeks: {
      put: vi.fn(async (week: TrainingPlanWeek) => {
        trainingPlanWeekPuts.push(week)
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
  pushTrainingPlan: vi.fn(),
  pushTrainingPlanWeeks: vi.fn(),
}))

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: {
    getState: () => trainingStoreState,
  },
}))

vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: {
    getState: () => athleteProfileState,
  },
}))

import { commitPlan } from '../planBuilder/commitPlan'
import { analyzePlanCommitImpact } from '../planBuilder/commitImpact'

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
  trainingPlanPuts.length = 0
  trainingPlanWeekPuts.length = 0
  trainingStoreState.loadedWeekStart = null
  trainingStoreState.loadWeek.mockClear()
  trainingStoreState.loadAllSummaries.mockClear()
  trainingStoreState.addSession.mockClear()
})

describe('commitPlan', () => {
  it('previews which planned sessions will be replaced and which history is preserved', async () => {
    const plan = {
      ...makePlan(1),
      wizardConfig: {
        ...makePlan().wizardConfig,
        allowDoubleSession: true,
      },
    }
    const plannedToReplace = makeStoredSession('old-planned', '2026-05-05', 'Sesion previa')
    const completedToPreserve = makeStoredHistorySession('done-1', '2026-05-05', 'PM', 'Sesion completada')
    const untouchedPlanned = makeStoredSession('untouched', '2026-05-06', 'Sesion futura')
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
    expect(impact.totals.replacedPlannedSessions).toBe(1)
    expect(impact.totals.preservedHistorySessions).toBe(1)
    expect(impact.totals.blockedByHistorySessions).toBe(1)
    expect(impact.totals.untouchedPlannedSessions).toBe(1)
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
