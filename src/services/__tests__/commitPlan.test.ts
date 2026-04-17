import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachProposal, Session, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const sessionsById = new Map<string, Session>()
const weekSummariesByStart = new Map<string, WeekSummary>()
const proposalsById = new Map<string, CoachProposal>()
const trainingPlanPuts: TrainingPlan[] = []
const trainingPlanWeekPuts: TrainingPlanWeek[] = []
const coachActionsState = {
  proposals: [] as CoachProposal[],
  addProposal: vi.fn(),
  acceptProposal: vi.fn(),
}
const trainingStoreState = {
  loadedWeekStart: null as string | null,
  loadWeek: vi.fn(async () => {}),
  loadAllSummaries: vi.fn(async () => {}),
}

vi.mock('../../db/db', () => ({
  db: {
    sessions: {
      where: vi.fn(() => ({
        between: vi.fn((start: string, end: string) => ({
          toArray: vi.fn(async () =>
            Array.from(sessionsById.values()).filter((session) => session.date >= start && session.date <= end),
          ),
        })),
      })),
      put: vi.fn(async (session: Session) => {
        sessionsById.set(session.id, session)
      }),
      delete: vi.fn(async (id: string) => {
        sessionsById.delete(id)
      }),
    },
    weekSummaries: {
      put: vi.fn(async (summary: WeekSummary) => {
        weekSummariesByStart.set(summary.weekStartDate, summary)
      }),
      delete: vi.fn(async (id: string) => {
        for (const [weekStart, summary] of weekSummariesByStart.entries()) {
          if (summary.id === id) weekSummariesByStart.delete(weekStart)
        }
      }),
    },
    coachProposals: {
      get: vi.fn(async (id: string) => proposalsById.get(id)),
      put: vi.fn(async (proposal: CoachProposal) => {
        proposalsById.set(proposal.id, proposal)
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
}))

vi.mock('../syncService', () => ({
  pushSession: vi.fn(),
  deleteSession: vi.fn(),
  pushWeekSummary: vi.fn(),
  pushCoachProposal: vi.fn(),
}))

vi.mock('../../store/useCoachActionsStore', () => ({
  useCoachActionsStore: {
    getState: () => coachActionsState,
    setState: (update: ((state: typeof coachActionsState) => Partial<typeof coachActionsState>) | Partial<typeof coachActionsState>) => {
      const next = typeof update === 'function' ? update(coachActionsState) : update
      Object.assign(coachActionsState, next)
    },
  },
}))

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: {
    getState: () => trainingStoreState,
  },
}))

import { commitPlan } from '../planBuilder/commitPlan'

function makePlan(totalWeeks = 2): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
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
  return [{
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
  }]
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

beforeEach(() => {
  sessionsById.clear()
  weekSummariesByStart.clear()
  proposalsById.clear()
  trainingPlanPuts.length = 0
  trainingPlanWeekPuts.length = 0
  coachActionsState.proposals = []
  coachActionsState.addProposal.mockReset()
  coachActionsState.acceptProposal.mockReset()
  trainingStoreState.loadedWeekStart = null
  trainingStoreState.loadWeek.mockClear()
  trainingStoreState.loadAllSummaries.mockClear()

  let proposalCounter = 0
  coachActionsState.addProposal.mockImplementation(async (message: string, actions: CoachProposal['actions']) => {
    proposalCounter += 1
    const proposal: CoachProposal = {
      id: `proposal-${proposalCounter}`,
      message,
      actions,
      status: 'pending',
      createdAt: proposalCounter,
    }
    proposalsById.set(proposal.id, proposal)
    coachActionsState.proposals = [...coachActionsState.proposals, proposal]
    return proposal
  })
})

describe('commitPlan', () => {
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
    expect(coachActionsState.acceptProposal).not.toHaveBeenCalled()
    expect(trainingPlanPuts).toHaveLength(0)
    expect(trainingPlanWeekPuts).toHaveLength(0)
  })

  it('rolls back previously accepted weeks when a later week fails', async () => {
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

    coachActionsState.acceptProposal.mockImplementation(async (proposalId: string) => {
      if (proposalId === 'proposal-1') {
        sessionsById.delete(originalSession.id)
        sessionsById.set('new-1', makeStoredSession('new-1', '2026-05-05', 'Sesion generada'))
        weekSummariesByStart.set('2026-05-04', {
          ...originalSummary,
          totalSessions: 2,
          totalMinutes: 120,
          objectives: ['Semana generada'],
        })
        const acceptedProposal = proposalsById.get(proposalId)
        if (acceptedProposal) {
          proposalsById.set(proposalId, { ...acceptedProposal, status: 'accepted', resolvedAt: 10 })
          coachActionsState.proposals = coachActionsState.proposals.map((proposal) =>
            proposal.id === proposalId ? { ...proposal, status: 'accepted', resolvedAt: 10 } : proposal,
          )
        }
        return { errors: [], warnings: [] }
      }

      return { errors: ['colisión de sesiones'], warnings: [] }
    })

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
        sessions: makeProposalSession('2026-05-12'),
      }),
    ])

    expect(result.errors).toEqual(['Semana 2: colisión de sesiones'])
    expect(result.warnings).toContain('Se revirtieron 1 semanas aceptadas antes del fallo.')
    expect(result.acceptedWeeks).toEqual([])
    expect(sessionsById.has(originalSession.id)).toBe(true)
    expect(sessionsById.has('new-1')).toBe(false)
    expect(weekSummariesByStart.get('2026-05-04')).toEqual(originalSummary)
    expect(proposalsById.get('proposal-1')?.status).toBe('rejected')
    expect(trainingPlanPuts).toHaveLength(0)
    expect(trainingPlanWeekPuts).toHaveLength(0)
    expect(trainingStoreState.loadAllSummaries).toHaveBeenCalledTimes(1)
  })
})
