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
    exercises: [
      { name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' },
      { name: 'Remo medio arrodillado', sets: 3, reps: 10, group: 'pull' },
      { name: 'Press sobre cabeza', sets: 3, reps: 8, group: 'push' },
      { name: 'Zancada lateral con barra', sets: 3, reps: '8/lado', group: 'legs' },
      { name: 'Plancha lateral', sets: 3, reps: '30s/lado', group: 'core' },
      { name: 'Bici de asalto', sets: 1, reps: '4 min: 30s fuerte / 30s suave', group: 'cardio' },
    ],
  })),
  getTargetExerciseDensity: vi.fn(() => ({ min: 6, target: 8, max: 9 })),
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
      strengthProfile: {
        deadlift1RM: 150,
        overheadPress1RM: 60,
      },
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

  it('repairs tempo running sessions with pace targets and interval structure', () => {
    mockContext.profile.runningProfile = {
      z2PaceMin: '5:20',
      z2PaceMax: '5:45',
      thresholdPace: '4:35',
    }

    const sessions: CoachSessionProposal[] = [
      {
        date: '2026-05-05',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Carrera Tempo - Resistencia Especifica',
        durationMin: 60,
        runningType: 'tempo',
        objective: 'Resistencia especifica',
      },
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Squash 1', durationMin: 45, objective: 'obj' },
      { date: '2026-05-07', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 45, objective: 'obj', exercises: [{ name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' }] },
      { date: '2026-05-09', timeBlock: 'AM', sessionType: 'mobility', title: 'Movilidad', durationMin: 30, objective: 'obj', exercises: [{ name: '90/90 de cadera', sets: 2, reps: '60s/lado', group: 'mobility' }] },
    ]

    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)
    const tempo = repaired.find((session) => session.sessionType === 'running')

    expect(meta.repairedSessionCount).toBeGreaterThan(0)
    expect(tempo?.targetPaceMin).toBe('4:25')
    expect(tempo?.targetPaceMax).toBe('4:35')
    expect(tempo?.intervalStructure?.blocks.map((block) => block.label)).toEqual([
      'Calentamiento Z2',
      'Tempo umbral controlado',
      'Enfriamiento Z2',
    ])
    expect(tempo?.intervalStructure?.blocks[1].targetPace).toBe('4:25-4:35 /km')
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

  it('6b. normalizes and enriches existing strength sessions during repair', () => {
    const sessions: CoachSessionProposal[] = [
      {
        date: '2026-05-04',
        timeBlock: 'AM',
        sessionType: 'squash',
        title: 'Squash valid',
        durationMin: 45,
        objective: 'obj',
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
          drills: [{ name: 'Tiros paralelos profundos', durationMin: 15 }],
          blocks: [],
        },
      },
      {
        date: '2026-05-06',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Run valid',
        durationMin: 45,
        objective: 'obj',
        runningType: 'z2',
        targetPaceMin: '5:30',
        targetPaceMax: '6:00',
        targetHrMin: 130,
        targetHrMax: 150,
        intervalStructure: { blocks: [{ label: 'Rodaje Z2', durationMin: 45 }] },
      },
      {
        date: '2026-05-08',
        timeBlock: 'AM',
        sessionType: 'strength',
        title: 'Strength flat',
        durationMin: 60,
        objective: 'obj',
        exercises: [
          { name: 'Peso muerto con trap bar', sets: 4, reps: 6 },
          { name: 'Escalera lateral – dos pies por cuadro', sets: 3, reps: 10 },
          { name: 'Press Pallof', sets: 3, reps: 10 },
        ],
      },
      { date: '2026-05-09', timeBlock: 'AM', sessionType: 'recovery', title: 'Recovery valid', durationMin: 30, objective: 'obj' },
    ]

    const { sessions: repaired, meta } = repairGeneratedWeek(sessions, mockContext)

    const strength = repaired.find((s) => s.sessionType === 'strength')!
    expect(meta.repairedSessionCount).toBe(1)
    expect(strength.exercises?.length).toBeGreaterThanOrEqual(8)
    expect(strength.exercises?.slice(0, 2).map((exercise) => exercise.group)).toEqual(['core', 'core'])
    expect(strength.exercises?.[0].name).toBe('Control de tronco dead bug')
    expect(strength.exercises?.filter((exercise) => !['core', 'cardio', 'mobility'].includes(exercise.group ?? '')).length).toBeGreaterThanOrEqual(4)
    expect(strength.exercises?.find((exercise) => exercise.name === 'Peso muerto con trap bar')).toMatchObject({
      weight: 110,
      targetPercent1RM: 77.5,
    })
    expect(strength.exercises?.at(-1)?.name).toBe('Escalera lateral – dos pies por cuadro')
  })

  it('7. balances session count by trimming excess', () => {
    // Config asks for 4 sessions. We provide 5.
    const sessions: CoachSessionProposal[] = [
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Session 1', durationMin: 45, objective: 'obj', squashDetails: { trainingFocus: 'technical', drills: [] } },
      { date: '2026-05-04', timeBlock: 'PM', sessionType: 'running', title: 'Session 2', durationMin: 45, objective: 'obj', runningType: 'z2' },
      { date: '2026-05-06', timeBlock: 'AM', sessionType: 'strength', title: 'Session 3', durationMin: 45, objective: 'obj', exercises: [] },
      { date: '2026-05-08', timeBlock: 'AM', sessionType: 'squash', title: 'Session 4', durationMin: 45, objective: 'obj', squashDetails: { trainingFocus: 'technical', drills: [] } },
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
      { date: '2026-05-04', timeBlock: 'AM', sessionType: 'squash', title: 'Session 1', durationMin: 45, objective: 'obj', squashDetails: { trainingFocus: 'technical', drills: [] } },
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
