import { describe, it, expect, beforeEach, vi } from 'vitest'
import { repairGeneratedWeek, type RepairContext } from '../planBuilder/repairWeek'
import type { CoachSessionProposal, AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlanWeek, TrainingPlan } from '../../types/planBuilder'

// Mock the selectors to avoid complex logic in the repair tests
vi.mock('../training/drillSelector', () => ({
  selectSquashDrills: vi.fn(() => ({
    trainingFocus: 'technical',
    sessionKind: 'technical',
    drills: [{ name: 'Drive mock', durationMin: 15 }],
    blocks: [],
  })),
}))
vi.mock('../training/runningSelector', () => ({
  selectRunningSession: vi.fn(() => ({
    focus: 'z2 base',
    session: { runningType: 'z2' },
  })),
}))
vi.mock('../training/strengthSelector', () => ({
  selectStrengthSession: vi.fn(() => ({
    exercises: [{ name: 'Squat', sets: 3, reps: 10, group: 'legs' }],
  })),
}))
vi.mock('../training/mobilitySelector', () => ({
  selectMobilitySession: vi.fn(() => ({
    recommendedFocus: ['hips', 'spine'],
    session: { typicalStructure: '10 min flow' },
  })),
}))
vi.mock('../training/cyclingSelector', () => ({
  selectCyclingSession: vi.fn(() => ({
    session: { category: 'endurance', family: 'z2', structure: '45m steady', intensity: 'z2', notes: '' },
  })),
}))

describe('repairGeneratedWeek', () => {
  let mockContext: RepairContext

  beforeEach(() => {
    const profile: AthleteProfile = {
      id: 'athlete1',
      name: 'Rafa',
      updatedAt: Date.now(),
      sportContext: { primarySport: 'squash' },
    }

    const wizardConfig: PlanWizardConfig = {
      goalEventId: 'event1',
      sessionsPerWeek: 4,
      sessionDurationMins: 45,
      trainingDays: ['monday', 'wednesday', 'friday', 'saturday'],
      complementarySports: ['running', 'strength'],
      allowDoubleSession: false,
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }

    const week: TrainingPlanWeek = {
      id: 'week1',
      planId: 'plan1',
      weekIndex: 0,
      weekStartDate: '2026-05-04', // Monday
      phase: 'base',
      status: 'draft',
      sessions: [],
      weekObjectives: [],
      targetLoadBySport: {},
      validationIssues: [],
      generationMeta: { attempts: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const plan = {
      id: 'plan1',
      profile,
      wizardConfig,
      macroSnapshot: {
        sportDetails: [{ sport: 'squash', role: 'primary' }],
      },
      weeks: [week],
    } as unknown as TrainingPlan

    mockContext = {
      plan,
      week,
      profile,
      wizardConfig,
    }
  })

  it('1. drops sessions with invalid dates', () => {
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Valid', durationMin: 45, objective: 'obj' },
      { date: 'not-a-date', timeBlock: 'PM', sessionType: 'running', title: 'Invalid', durationMin: 45, objective: 'obj' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    // Total should be 4 due to balancing (added 3 fallbacks). But the invalid one was dropped.
    expect(meta.droppedSessionCount).toBeGreaterThanOrEqual(1)
    expect(meta.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_date' }),
      ])
    )
    expect(repaired.find((s) => s.title === 'Invalid')).toBeUndefined()
  })

  it('2. moves sessions outside the week range to an allowed date', () => {
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-03', timeBlock: 'AM', sessionType: 'squash', title: 'Out of week', durationMin: 45, objective: 'obj' },
      { date: '2026-05-04', timeBlock: 'PM', sessionType: 'running', title: 'In week', durationMin: 45, objective: 'obj' },
      // add two more to avoid balancing
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'strength', title: 'In week 2', durationMin: 45, objective: 'obj' },
      { date: '2026-05-08', timeBlock: 'AM', sessionType: 'recovery', title: 'In week 3', durationMin: 45, objective: 'obj' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    expect(meta.movedSessionCount).toBe(1)
    const moved = repaired.find((s) => s.title === 'Out of week')
    expect(moved).toBeDefined()
    expect(moved!.date).not.toBe('2026-05-03') // Should have moved into the week
    const dayName = new Date(`${moved!.date}T00:00:00.000Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }).toLowerCase()
    expect(mockContext.wizardConfig.trainingDays).toContain(dayName)
  })

  it('3. moves sessions on disallowed days to allowed days', () => {
    // Thursday is not allowed
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-07', timeBlock: 'AM', sessionType: 'squash', title: 'Disallowed day', durationMin: 45, objective: 'obj' },
      { date: '2026-05-04', timeBlock: 'PM', sessionType: 'running', title: 'Allowed day', durationMin: 45, objective: 'obj' },
      // add two more to avoid balancing
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'strength', title: 'Allowed 2', durationMin: 45, objective: 'obj' },
      { date: '2026-05-08', timeBlock: 'AM', sessionType: 'recovery', title: 'Allowed 3', durationMin: 45, objective: 'obj' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    expect(meta.movedSessionCount).toBe(1)
    const moved = repaired.find((s) => s.title === 'Disallowed day')
    expect(moved).toBeDefined()
    expect(moved!.date).not.toBe('2026-05-07')
  })

  it('4. resolves collisions by moving to opposite timeBlock or another date', () => {
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Session 1', durationMin: 45, objective: 'obj' },
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'running', title: 'Session 2', durationMin: 45, objective: 'obj' },
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'strength', title: 'Session 3', durationMin: 45, objective: 'obj' },
      { date: '2026-05-08', timeBlock: 'AM', sessionType: 'recovery', title: 'Session 4', durationMin: 45, objective: 'obj' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    expect(meta.movedSessionCount).toBe(1)
    const s1 = repaired.find((s) => s.title === 'Session 1')!
    const s2 = repaired.find((s) => s.title === 'Session 2')!
    // They should not collide anymore
    expect(`${s1.date}|${s1.timeBlock}`).not.toBe(`${s2.date}|${s2.timeBlock}`)
    expect(s1.date).not.toBe(s2.date)
  })

  it('5. filters disallowed sports', () => {
    // Only squash, running, strength are allowed by config. Cycling is not.
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Allowed', durationMin: 45, objective: 'obj' },
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'cycling', title: 'Disallowed', durationMin: 45, objective: 'obj' },
      { date: '2026-05-08', timeBlock: 'AM', sessionType: 'running', title: 'Allowed 2', durationMin: 45, objective: 'obj' },
      { date: '2026-05-09', timeBlock: 'AM', sessionType: 'strength', title: 'Allowed 3', durationMin: 45, objective: 'obj' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    expect(meta.filteredSportCount).toBe(1)
    expect(repaired.find((s) => s.title === 'Disallowed')).toBeUndefined()
  })

  it('6. completes missing sport details (squash and running)', () => {
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Squash without details', durationMin: 45, objective: 'obj', subtype: 'training' },
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'running', title: 'Run without details', durationMin: 45, objective: 'obj' },
      { date: '2026-05-08', timeBlock: 'AM', sessionType: 'strength', title: 'Strength without details', durationMin: 45, objective: 'obj' },
      { date: '2026-05-09', timeBlock: 'AM', sessionType: 'mobility', title: 'Mobility without details', durationMin: 45, objective: 'obj' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    expect(meta.repairedSessionCount).toBe(4)
    
    const sq = repaired.find((s) => s.sessionType === 'squash')!
    expect(sq.squashDetails).toBeDefined()
    expect(sq.squashDetails!.drills.length).toBeGreaterThan(0)
    
    const run = repaired.find((s) => s.sessionType === 'running')!
    expect(run.runningType).toBeDefined()

    const str = repaired.find((s) => s.sessionType === 'strength')!
    expect(str.exercises).toBeDefined()
    expect(str.exercises!.length).toBeGreaterThan(0)

    const mob = repaired.find((s) => s.sessionType === 'mobility')!
    expect(mob.mobilityDetails).toBeDefined()
  })

  it('7. balances session count by trimming excess', () => {
    // Config asks for 4 sessions. We provide 5.
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Session 1', durationMin: 45, objective: 'obj', squashDetails: {} as any },
      { date: '2026-05-04', timeBlock: 'PM', sessionType: 'running', title: 'Session 2', durationMin: 45, objective: 'obj', runningType: 'z2' },
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'strength', title: 'Session 3', durationMin: 45, objective: 'obj', exercises: [] },
      { date: '2026-05-08', timeBlock: 'AM', sessionType: 'squash', title: 'Session 4', durationMin: 45, objective: 'obj', squashDetails: {} as any },
      { date: '2026-05-09', timeBlock: 'AM', sessionType: 'recovery', title: 'Excess Recovery', durationMin: 45, objective: 'obj' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    expect(repaired.length).toBe(4)
    expect(meta.droppedSessionCount).toBeGreaterThanOrEqual(1) // from trimming
    expect(repaired.find((s) => s.title === 'Excess Recovery')).toBeUndefined()
  })

  it('7. balances session count by adding fallbacks', () => {
    // Config asks for 4 sessions. We provide 2.
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Session 1', durationMin: 45, objective: 'obj', squashDetails: {} as any },
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'running', title: 'Session 2', durationMin: 45, objective: 'obj', runningType: 'z2' },
    ]
    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    
    expect(repaired.length).toBe(4)
    expect(meta.addedFallbackCount).toBe(2)
    const newSessions = repaired.filter((s) => s.title !== 'Session 1' && s.title !== 'Session 2')
    // At least one fallback must be primary sport if missing
    expect(newSessions.some((s) => s.sessionType === 'squash' || s.sessionType === 'mobility')).toBe(true)
  })
})
