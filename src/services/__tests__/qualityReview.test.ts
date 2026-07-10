import { describe, expect, it } from 'vitest'
import type { AthleteProfile, CoachSessionProposal, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { getExpectedSessionsForPlanWeek } from '../planBuilder/dateRange'
import { buildPlanQualityRepairInstructions, reviewPlanQuality } from '../planBuilder/qualityReview'

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }
}

function makePlan(): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'complete',
    title: 'Plan Nacional',
    startDate: '2026-05-04',
    endDate: '2026-06-01',
    totalWeeks: 1,
    phases: [],
    wizardConfig: makeWizardConfig(),
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-06-01',
      currentPhase: 'peak',
      weeksRemaining: 4,
      blockFocus: 'Peak',
      headline: 'Peak',
      timeline: [],
      sportDetails: [{
        sport: 'squash',
        role: 'primary',
        phaseFocus: 'Peak',
        weeklyIntent: 'Priorizar calidad competitiva',
        volumeBias: 'hold',
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

function squash(date: string, title: string): CoachSessionProposal {
  return {
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title,
    durationMin: 60,
    rpe: 7,
    objective: 'Trabajo específico',
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills: [
        { name: 'Drive cruzado', durationMin: 12 },
        { name: 'Boast y recuperación', durationMin: 12 },
      ],
    },
  }
}

function makeWeek(sessions: CoachSessionProposal[]): TrainingPlanWeek {
  return {
    id: 'week-1',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-05-04',
    phase: 'peak',
    status: 'draft',
    sessions,
    weekObjectives: [{ goal: 'Priorizar sesiones clave con volumen controlado.' }],
    targetLoadBySport: { squash: 70, running: 15, strength: 15 },
    validationIssues: [],
    generationMeta: { attempts: 1, repairedSessionCount: 2 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function strength(date: string, exercises?: CoachSessionProposal['exercises']): CoachSessionProposal {
  return {
    date,
    timeBlock: 'AM',
    sessionType: 'strength',
    title: 'Fuerza soporte',
    durationMin: 60,
    rpe: 6,
    exercises: exercises ?? [
      { name: 'Dead bug', sets: 3, reps: 8, group: 'core' },
      { name: 'Plancha lateral', sets: 3, reps: '30s', group: 'core' },
      { name: 'Sentadilla frontal', sets: 4, reps: 4, group: 'legs' },
      { name: 'Press Z', sets: 4, reps: 4, group: 'push' },
      { name: 'Peso muerto rumano', sets: 3, reps: 6, group: 'legs' },
      { name: 'Remo unilateral', sets: 3, reps: 8, group: 'pull' },
    ],
  }
}

function running(date: string): CoachSessionProposal {
  return {
    date,
    timeBlock: 'AM',
    sessionType: 'running',
    title: 'Z2 soporte squash',
    durationMin: 40,
    rpe: 4,
    runningType: 'z2',
    targetHrMin: 130,
    targetHrMax: 145,
    intervalStructure: { blocks: [{ label: 'Z2', durationMin: 35 }] },
  }
}

describe('reviewPlanQuality', () => {
  const completeStrengthProfile: AthleteProfile = {
    id: 'athlete-1',
    updatedAt: 1,
    strengthProfile: {
      squat1RM: 120,
      deadlift1RM: 140,
      benchPress1RM: 90,
      overheadPress1RM: 65,
    },
  }

  it('flags underuse of a complete 1RM profile on multi-week plans', () => {
    const plan = { ...makePlan(), totalWeeks: 4 }
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      running('2026-05-07'),
      strength('2026-05-08', [
        { name: 'Sentadilla', sets: 4, reps: 5, group: 'legs', targetPercent1RM: 75 },
        { name: 'Dead bug', sets: 3, reps: 8, group: 'core' },
        { name: 'Remo unilateral', sets: 3, reps: 8, group: 'pull' },
        { name: 'Copenhagen', sets: 3, reps: '30s', group: 'core' },
        { name: 'Salto lateral', sets: 3, reps: 6, group: 'other' },
        { name: 'Farmer carry', sets: 3, reps: '30m', group: 'other' },
      ]),
    ])

    const review = reviewPlanQuality(plan, [week], { profile: completeStrengthProfile })

    expect(review.issues.some((item) => item.code === 'quality.strength.profile_1rm_underused')).toBe(true)
    expect(review.issues.find((item) => item.code === 'quality.strength.profile_1rm_underused')?.message)
      .toContain('peso muerto')
  })

  it('accepts complete 1RM coverage when all profile references are prescribed', () => {
    const plan = { ...makePlan(), totalWeeks: 4 }
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      running('2026-05-07'),
      strength('2026-05-08', [
        { name: 'Sentadilla', sets: 4, reps: 5, group: 'legs', targetPercent1RM: 75 },
        { name: 'Peso muerto', sets: 4, reps: 4, group: 'legs', targetPercent1RM: 80 },
        { name: 'Press banca', sets: 4, reps: 5, group: 'push', targetPercent1RM: 75 },
        { name: 'Press de hombros', sets: 3, reps: 5, group: 'push', targetPercent1RM: 70 },
        { name: 'Dead bug', sets: 3, reps: 8, group: 'core' },
        { name: 'Remo unilateral', sets: 3, reps: 8, group: 'pull' },
      ]),
    ])

    const review = reviewPlanQuality(plan, [week], { profile: completeStrengthProfile })

    expect(review.issues.some((item) => item.code === 'quality.strength.profile_1rm_underused')).toBe(false)
  })

  it('counts close variants of the base lift as covering the reference', () => {
    const plan = { ...makePlan(), totalWeeks: 4 }
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      running('2026-05-07'),
      strength('2026-05-08', [
        // Variantes del mismo patrón (factor 0.8-0.95) sí demuestran uso del 1RM.
        { name: 'Sentadilla frontal', sets: 4, reps: 5, group: 'legs', targetPercent1RM: 70 },
        { name: 'Peso muerto sumo', sets: 4, reps: 4, group: 'legs', targetPercent1RM: 80 },
        { name: 'Press inclinado', sets: 4, reps: 6, group: 'push', targetPercent1RM: 70 },
        { name: 'Press de hombros', sets: 3, reps: 5, group: 'push', targetPercent1RM: 70 },
      ]),
    ])

    const review = reviewPlanQuality(plan, [week], { profile: completeStrengthProfile })

    expect(review.issues.some((item) => item.code === 'quality.strength.profile_1rm_underused')).toBe(false)
  })

  it('does not count lifts above the strict 1RM as covering the reference', () => {
    const plan = { ...makePlan(), totalWeeks: 4 }
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      running('2026-05-07'),
      strength('2026-05-08', [
        { name: 'Sentadilla', sets: 4, reps: 5, group: 'legs', targetPercent1RM: 75 },
        { name: 'Peso muerto', sets: 4, reps: 4, group: 'legs', targetPercent1RM: 80 },
        { name: 'Press de hombros', sets: 3, reps: 5, group: 'push', targetPercent1RM: 70 },
        // Hip thrust carga sobre el 1RM de sentadilla (factor 1.2) pero no es un
        // patrón de sentadilla; no debe considerarse cobertura adicional.
        { name: 'Hip thrust', sets: 4, reps: 8, group: 'legs', targetPercent1RM: 60 },
      ]),
    ])

    const review = reviewPlanQuality(plan, [week], { profile: completeStrengthProfile })

    const coverageIssue = review.issues.find((item) => item.code === 'quality.strength.profile_1rm_underused')
    expect(coverageIssue).toBeDefined()
    expect(coverageIssue?.message).toContain('press banca')
  })

  it('does not count accessory lifts loaded off a reference as covering it', () => {
    const plan = { ...makePlan(), totalWeeks: 4 }
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      running('2026-05-07'),
      strength('2026-05-08', [
        { name: 'Sentadilla', sets: 4, reps: 5, group: 'legs', targetPercent1RM: 75 },
        { name: 'Peso muerto', sets: 4, reps: 4, group: 'legs', targetPercent1RM: 80 },
        { name: 'Press de hombros', sets: 3, reps: 5, group: 'push', targetPercent1RM: 70 },
        // Remo con barra carga sobre el 1RM de banca (factor 0.75) pero no es
        // el press de banca principal: no debe cubrir la referencia de banca.
        { name: 'Remo con barra', sets: 4, reps: 6, group: 'pull', targetPercent1RM: 70 },
      ]),
    ])

    const review = reviewPlanQuality(plan, [week], { profile: completeStrengthProfile })

    const coverageIssue = review.issues.find((item) => item.code === 'quality.strength.profile_1rm_underused')
    expect(coverageIssue).toBeDefined()
    expect(coverageIssue?.message).toContain('press banca')
  })

  it('scores a complete squash plan week as good or better', () => {
    const plan = makePlan()
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      {
        date: '2026-05-07',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Z2 soporte squash',
        durationMin: 40,
        rpe: 4,
        runningType: 'z2',
        targetHrMin: 130,
        targetHrMax: 145,
        intervalStructure: { blocks: [{ label: 'Z2', durationMin: 35 }] },
      },
      {
        date: '2026-05-08',
        timeBlock: 'AM',
        sessionType: 'strength',
        title: 'Fuerza soporte',
        durationMin: 60,
        rpe: 6,
        exercises: [
          { name: 'Dead bug', sets: 3, reps: 8, group: 'core' },
          { name: 'Plancha lateral', sets: 3, reps: '30s', group: 'core' },
          { name: 'Sentadilla frontal', sets: 4, reps: 4, group: 'legs' },
          { name: 'Press Z', sets: 4, reps: 4, group: 'push' },
          { name: 'Peso muerto rumano', sets: 3, reps: 6, group: 'legs' },
          { name: 'Remo unilateral', sets: 3, reps: 8, group: 'pull' },
        ],
      },
    ])

    const review = reviewPlanQuality(plan, [week])

    expect(review.score).toBeGreaterThanOrEqual(78)
    expect(review.grade).not.toBe('poor')
    expect(review.weeks[0]?.repairCount).toBe(2)
  })

  it('rejects hard running support inside squash peak weeks', () => {
    const plan = makePlan()
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      {
        date: '2026-05-07',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Tempo',
        durationMin: 60,
        rpe: 6,
        runningType: 'tempo',
        targetPaceMin: '4:25',
        targetPaceMax: '4:35',
        intervalStructure: { blocks: [{ label: 'Tempo', durationMin: 30, targetPace: '4:25-4:35 /km' }] },
      },
      strength('2026-05-08'),
    ])

    const review = reviewPlanQuality(plan, [week])

    expect(review.issues.some((item) => item.code === 'squash.support_aerobic.too_hard')).toBe(true)
    expect(review.criticalIssueCount).toBeGreaterThan(0)
  })

  it('penalizes missing strength and target aerobic support in squash peak', () => {
    const plan = makePlan()
    const week = makeWeek([
      squash('2026-05-04', 'Squash 1'),
      squash('2026-05-05', 'Squash 2'),
      squash('2026-05-06', 'Squash 3'),
      squash('2026-05-07', 'Squash 4'),
      squash('2026-05-08', 'Squash 5'),
    ])

    const review = reviewPlanQuality(plan, [week])

    expect(review.score).toBeLessThan(100)
    expect(review.issues.some((item) => item.code === 'quality.support.missing_strength')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.support.missing_aerobic')).toBe(true)
  })

  it('flags weeks that relied on dropped sessions and repair fallbacks', () => {
    const plan = makePlan()
    const week = {
      ...makeWeek([
        squash('2026-05-04', 'Squash 1'),
        squash('2026-05-05', 'Squash 2'),
        squash('2026-05-06', 'Squash 3'),
        running('2026-05-07'),
        strength('2026-05-08'),
      ]),
      generationMeta: {
        attempts: 1,
        droppedSessionCount: 3,
        addedFallbackCount: 2,
        repairedSessionCount: 10,
      },
    }

    const review = reviewPlanQuality(plan, [week])

    expect(review.issues.some((item) => item.code === 'quality.generation.dropped_sessions')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.generation.repair_fallback_added')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.generation.high_repair_count')).toBe(true)
    expect(review.weeks[0]?.repairCount).toBe(12)
    expect(review.score).toBeGreaterThanOrEqual(90)
  })

  it('flags plan-level reliance on repair fallbacks and dropped sessions', () => {
    const plan = makePlan()
    const first = {
      ...makeWeek([
        squash('2026-05-04', 'Squash 1'),
        squash('2026-05-05', 'Squash 2'),
        squash('2026-05-06', 'Squash 3'),
        squash('2026-05-07', 'Squash 4'),
        strength('2026-05-08'),
      ]),
      generationMeta: { attempts: 1, droppedSessionCount: 2, addedFallbackCount: 2 },
    }
    const second = {
      ...makeWeek([
        squash('2026-05-11', 'Squash 1'),
        squash('2026-05-12', 'Squash 2'),
        squash('2026-05-13', 'Squash 3'),
        squash('2026-05-14', 'Squash 4'),
        strength('2026-05-15'),
      ]),
      id: 'week-2',
      weekIndex: 1,
      weekStartDate: '2026-05-11',
      generationMeta: { attempts: 1, droppedSessionCount: 2, addedFallbackCount: 2 },
    }

    const review = reviewPlanQuality(plan, [first, second])

    expect(review.issues.some((item) => item.code === 'quality.generation.repair_fallback_reliance')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.generation.dropped_session_reliance')).toBe(true)
  })

  it('turns quality issues into targeted repair instructions by week', () => {
    const plan = makePlan()
    const week = makeWeek([
      squash('2026-05-04', 'Squash 1'),
      squash('2026-05-05', 'Squash 2'),
      squash('2026-05-06', 'Squash 3'),
      squash('2026-05-07', 'Squash 4'),
      squash('2026-05-08', 'Squash 5'),
    ])

    const review = reviewPlanQuality(plan, [week])
    const instructions = buildPlanQualityRepairInstructions(review)

    expect(instructions[0]).toContain('Repara la semana 1')
    expect(instructions[0]).toContain('Problemas detectados')
    expect(instructions[0]).toContain('create_week')
  })

  it('caps expected sessions for final taper week and flags excessive taper volume', () => {
    const plan: TrainingPlan = {
      ...makePlan(),
      endDate: '2026-06-05',
      wizardConfig: {
        ...makeWizardConfig(),
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        sessionsPerWeek: 6,
        allowDoubleSession: true,
        doubleSessionDays: ['monday', 'wednesday', 'friday'],
      },
    }
    const week: TrainingPlanWeek = {
      ...makeWeek([
        squash('2026-06-01', 'Toque'),
        strength('2026-06-01'),
        { date: '2026-06-02', timeBlock: 'AM', sessionType: 'running', title: 'Z2', durationMin: 60, rpe: 4, runningType: 'z2', intervalStructure: { blocks: [{ label: 'Z2', durationMin: 45 }] } },
        { date: '2026-06-02', timeBlock: 'PM', sessionType: 'mobility', title: 'Movilidad', durationMin: 60, rpe: 2, mobilityDetails: { context: 'full_body', focusAreas: ['full_body'], targetStructure: 'Worlds greatest stretch 5/l' } },
        squash('2026-06-03', 'Puntos cortos'),
        { date: '2026-06-03', timeBlock: 'PM', sessionType: 'recovery', title: 'Recovery', durationMin: 60, rpe: 2 },
      ]),
      weekStartDate: '2026-06-01',
      phase: 'taper',
    }

    const review = reviewPlanQuality(plan, [week])

    expect(getExpectedSessionsForPlanWeek(plan, week)).toBe(4)
    expect(review.issues.some((item) => item.code === 'week.sessions.count_mismatch')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.taper.session_too_long')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.mobility.english_structure')).toBe(true)
  })

  it('reduces expected taper sessions progressively as the squash event approaches', () => {
    const plan: TrainingPlan = {
      ...makePlan(),
      endDate: '2026-07-20',
      wizardConfig: {
        ...makeWizardConfig(),
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        sessionsPerWeek: 6,
        allowDoubleSession: true,
        doubleSessionDays: ['monday', 'wednesday', 'friday'],
      },
    }
    const week21DaysOut: TrainingPlanWeek = {
      ...makeWeek([]),
      weekStartDate: '2026-06-29',
      phase: 'taper',
    }
    const week14DaysOut: TrainingPlanWeek = {
      ...week21DaysOut,
      weekStartDate: '2026-07-06',
    }
    const week7DaysOut: TrainingPlanWeek = {
      ...week21DaysOut,
      weekStartDate: '2026-07-13',
    }

    expect(getExpectedSessionsForPlanWeek(plan, week21DaysOut)).toBe(5)
    expect(getExpectedSessionsForPlanWeek(plan, week14DaysOut)).toBe(4)
    expect(getExpectedSessionsForPlanWeek(plan, week7DaysOut)).toBe(4)
  })

  it('rejects race-day running and requires a squash match event session', () => {
    const plan: TrainingPlan = {
      ...makePlan(),
      startDate: '2026-06-01',
      endDate: '2026-06-01',
      macroSnapshot: {
        ...makePlan().macroSnapshot,
        goalEventDate: '2026-06-01',
      },
      wizardConfig: {
        ...makeWizardConfig(),
        trainingDays: ['monday'],
        sessionsPerWeek: 2,
        allowDoubleSession: true,
        doubleSessionDays: ['monday'],
      },
    }
    const week: TrainingPlanWeek = {
      ...makeWeek([
        {
          date: '2026-06-01',
          timeBlock: 'AM',
          sessionType: 'running',
          title: 'Activación running',
          durationMin: 20,
          rpe: 3,
          runningType: 'z2',
        },
        {
          ...squash('2026-06-01', 'Squash técnico ligero'),
          timeBlock: 'PM',
          subtype: 'light',
          squashDetails: {
            trainingFocus: 'technical',
            sessionMode: 'drill_session',
            sessionKind: 'technical',
            drills: [{ name: 'Drive cruzado', durationMin: 10 }],
          },
        },
      ]),
      weekStartDate: '2026-06-01',
      phase: 'race',
    }

    const review = reviewPlanQuality(plan, [week])

    expect(getExpectedSessionsForPlanWeek(plan, week)).toBe(2)
    expect(review.issues.some((item) => item.code === 'squash.race_day.non_squash')).toBe(true)
    expect(review.issues.some((item) => item.code === 'squash.race_day.missing_event')).toBe(true)
  })

  it('flags repeated strength templates across adjacent weeks', () => {
    const plan = { ...makePlan(), totalWeeks: 2 }
    const first = makeWeek([
      squash('2026-05-04', 'Squash 1'),
      squash('2026-05-05', 'Squash 2'),
      squash('2026-05-06', 'Squash 3'),
      { date: '2026-05-07', timeBlock: 'AM', sessionType: 'running', title: 'Z2', durationMin: 45, rpe: 5, runningType: 'z2', intervalStructure: { blocks: [{ label: 'Z2', durationMin: 35 }] } },
      strength('2026-05-08'),
    ])
    const second: TrainingPlanWeek = {
      ...makeWeek([
        squash('2026-05-11', 'Squash 1'),
        squash('2026-05-12', 'Squash 2'),
        squash('2026-05-13', 'Squash 3'),
        { date: '2026-05-14', timeBlock: 'AM', sessionType: 'running', title: 'Z2', durationMin: 45, rpe: 5, runningType: 'z2', intervalStructure: { blocks: [{ label: 'Z2', durationMin: 35 }] } },
        strength('2026-05-15'),
      ]),
      id: 'week-2',
      weekIndex: 1,
      weekStartDate: '2026-05-11',
    }

    const review = reviewPlanQuality(plan, [first, second])

    expect(review.issues.some((item) => item.code === 'quality.strength.repeated_template')).toBe(true)
  })

  it('flags fallback reliance and squash semantic mismatches', () => {
    const plan = { ...makePlan(), totalWeeks: 2 }
    const first = {
      ...makeWeek([
        {
          ...squash('2026-05-04', 'Squash - Sombras y Salidas'),
          subtype: 'match',
          squashDetails: {
            trainingFocus: 'technical',
            sessionMode: 'practice_match',
            sessionKind: 'mixed',
            blocks: [
              { kind: 'shadows', drills: [{ name: 'Split-step y vuelta a la T' }] },
              { kind: 'control', drills: [{ name: 'Voleas en solitario' }] },
            ],
            drills: [
              { name: 'Split-step y vuelta a la T' },
              { name: 'Voleas en solitario' },
            ],
          },
        },
        squash('2026-05-05', 'Squash control'),
        squash('2026-05-06', 'Squash juego'),
        { date: '2026-05-07', timeBlock: 'AM', sessionType: 'running', title: 'Z2', durationMin: 45, rpe: 5, runningType: 'z2', targetPaceMin: '5:30', intervalStructure: { blocks: [{ label: 'Z2', durationMin: 35 }] } },
        strength('2026-05-08'),
      ]),
      generationMeta: { attempts: 1, fallbackUsed: true, repairedSessionCount: 2 },
    } satisfies TrainingPlanWeek
    const second: TrainingPlanWeek = {
      ...makeWeek([
        squash('2026-05-11', 'Squash 1'),
        squash('2026-05-12', 'Squash 2'),
        squash('2026-05-13', 'Squash 3'),
        { date: '2026-05-14', timeBlock: 'AM', sessionType: 'running', title: 'Z2', durationMin: 45, rpe: 5, runningType: 'z2', targetPaceMin: '5:30', intervalStructure: { blocks: [{ label: 'Z2', durationMin: 35 }] } },
        strength('2026-05-15'),
      ]),
      id: 'week-2',
      weekIndex: 1,
      weekStartDate: '2026-05-11',
      generationMeta: { attempts: 1, fallbackUsed: true, repairedSessionCount: 2 },
    }

    const review = reviewPlanQuality(plan, [first, second])

    expect(review.issues.some((item) => item.code === 'quality.generation.fallback_reliance')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.squash.mode_mismatch')).toBe(true)
    expect(review.issues.some((item) => item.code === 'quality.squash.title_mismatch')).toBe(true)
  })
})
