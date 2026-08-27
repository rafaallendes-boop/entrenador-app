import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { reviewPlanQuality } from '../qualityReview'
import { collectAllStrengthKeys, collectCountableKeys } from '../strengthRoleContract'

function plan(): TrainingPlan {
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'e1',
    trainingDays: ['monday', 'tuesday'],
    sessionsPerWeek: 2,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['strength'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-06-14', totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-06-14', currentPhase: 'build', weeksRemaining: 2,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function strength(exerciseNames: string[]): CoachSessionProposal {
  return {
    date: '2026-06-01',
    timeBlock: 'AM',
    sessionType: 'strength',
    title: 'Fuerza',
    objective: 'Fuerza',
    durationMin: 60,
    rpe: 6,
    exercises: exerciseNames.map((name) => ({ name, sets: 3, reps: 5, group: name === 'Dead bug' ? 'core' : 'legs' })),
  }
}

function squash(drillNames: string[]): CoachSessionProposal {
  return {
    date: '2026-06-01',
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Squash',
    objective: 'Squash',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills: drillNames.map((name) => ({ name, durationMin: 10 })),
    },
  }
}

function week(weekIndex: number, exerciseNames: string[]): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: weekIndex === 0 ? '2026-06-01' : '2026-06-08',
    phase: 'build', status: 'draft', sessions: [strength(exerciseNames)],
    weekObjectives: [], targetLoadBySport: { strength: 100 }, validationIssues: [],
    generationMeta: { attempts: 1 }, createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

function squashWeek(weekIndex: number, sessions: CoachSessionProposal[]): TrainingPlanWeek {
  return {
    id: `sw${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: weekIndex === 0 ? '2026-06-01' : '2026-06-08',
    phase: 'build', status: 'draft', sessions,
    weekObjectives: [], targetLoadBySport: { squash: 100 }, validationIssues: [],
    generationMeta: { attempts: 1 }, createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

describe('qualityReview repeated strength templates', () => {
  it('warns when an anchored session repeats 4 of 5 countable accessories', () => {
    const review = reviewPlanQuality(plan(), [
      week(0, ['Dead bug', 'Back squat', 'Bench press', 'Pull up', 'Farmer carry']),
      week(1, [
        'Dead bug', 'Front squat', 'Bench press', 'Pull up',
        'Farmer carry', 'Romanian deadlift',
      ]),
    ])

    expect(review.issues.some((issue) => issue.code === 'quality.strength.repeated_template')).toBe(true)
  })

  it('warns for a production-shaped near clone with only one accessory changed', () => {
    const review = reviewPlanQuality(plan(), [
      week(0, [
        'Dead bug', 'Back squat', 'Bench press', 'Pull up', 'Farmer carry',
        'Romanian deadlift', 'Overhead press', 'Cable chop', 'Bulgarian split squat',
      ]),
      week(1, [
        'Side plank', 'Front squat', 'Bench press', 'Pull up', 'Farmer carry',
        'Romanian deadlift', 'Overhead press', 'Cable chop', 'Bulgarian split squat',
      ]),
    ])

    const repeated = review.issues.find(
      (issue) => issue.code === 'quality.strength.repeated_template',
    )
    expect(repeated?.message).toContain('7 de 8 accesorios (88%)')
  })

  it('does not warn when weeks share fewer than 3 exercises', () => {
    const review = reviewPlanQuality(plan(), [
      week(0, ['Dead bug', 'Back squat', 'Bench press']),
      week(1, ['Side plank', 'Front squat', 'Incline dumbbell press']),
    ])

    expect(review.issues.some((issue) => issue.code === 'quality.strength.repeated_template')).toBe(false)
  })

  it('allows 6 of 8 shared accessories as continuity with progression', () => {
    const earlier = week(0, [
      'Dead bug', 'Back squat', 'Bench press', 'Pull up',
      'Farmer carry', 'Romanian deadlift', 'Overhead press', 'Cable chop',
    ])
    const later = week(1, [
      'Side plank', 'Front squat', 'Bench press', 'Pull up',
      'Farmer carry', 'Romanian deadlift', 'Overhead press', 'Cable chop',
      'Incline dumbbell press',
    ])
    const earlierAll = collectAllStrengthKeys(earlier.sessions)
    const laterCountable = collectCountableKeys(later.sessions)

    expect(laterCountable.size).toBe(8)
    expect([...laterCountable].filter((key) => earlierAll.has(key))).toHaveLength(6)

    const review = reviewPlanQuality(plan(), [earlier, later])

    // 6/8 accesorios contables se conservan: progresión, no clonación.
    expect(review.issues.some((issue) => issue.code === 'quality.strength.repeated_template')).toBe(false)
  })

  it('compares strength sessions by weekly order instead of aggregating D1 and D2', () => {
    const first = week(0, [])
    first.sessions = [
      { ...strength(['Dead bug', 'Back squat', 'Bench press', 'Pull up']), date: '2026-06-01' },
      { ...strength(['Side plank', 'Front squat', 'Farmer carry', 'Romanian deadlift']), date: '2026-06-03' },
    ]
    const second = week(1, [])
    second.sessions = [
      { ...strength(['Pallof press', 'Goblet squat', 'Bench press', 'Farmer carry']), date: '2026-06-08' },
      { ...strength(['Bird dog', 'Hip thrust', 'Pull up', 'Romanian deadlift']), date: '2026-06-10' },
    ]

    const review = reviewPlanQuality(plan(), [first, second])

    // El agregado semanal comparte 4 nombres, pero cada sesión anclada sólo 1.
    expect(review.issues.some((issue) => issue.code === 'quality.strength.repeated_template')).toBe(false)
  })

  it('flags each week at most once even when a whole block shares the same template', () => {
    const threeWeekBlock: TrainingPlan = {
      ...plan(),
      totalWeeks: 3,
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 2, blockFocus: '', intentBySport: {} }],
    } as TrainingPlan
    const sameTemplate = ['Dead bug', 'Back squat', 'Bench press', 'Pull up']

    const review = reviewPlanQuality(threeWeekBlock, [
      week(0, sameTemplate),
      week(1, sameTemplate),
      week(2, sameTemplate),
    ])

    const repeated = review.issues.filter((issue) => issue.code === 'quality.strength.repeated_template')
    // Linear (one per later week), not quadratic C(3,2)=3.
    expect(repeated.length).toBe(2)
    const flaggedWeeks = repeated.map((issue) => issue.weekIndex)
    expect(new Set(flaggedWeeks).size).toBe(flaggedWeeks.length)
  })

  it('prorates partial first weeks before flagging load jumps', () => {
    const partialPlan: TrainingPlan = {
      ...plan(),
      startDate: '2026-06-12',
      endDate: '2026-06-28',
      totalWeeks: 3,
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 2, blockFocus: '', intentBySport: {} }],
    } as TrainingPlan
    const firstPartialWeek: TrainingPlanWeek = {
      ...week(0, ['Dead bug', 'Back squat']),
      weekStartDate: '2026-06-08',
      sessions: [strength(['Dead bug', 'Back squat'])],
    } as TrainingPlanWeek
    const secondFullWeek: TrainingPlanWeek = {
      ...week(1, ['Side plank', 'Front squat']),
      weekStartDate: '2026-06-15',
      sessions: [
        { ...strength(['Side plank', 'Front squat']), date: '2026-06-16', durationMin: 50 },
        { ...strength(['Pallof press', 'Romanian deadlift']), date: '2026-06-18', durationMin: 50 },
      ],
    } as TrainingPlanWeek

    const review = reviewPlanQuality(partialPlan, [firstPartialWeek, secondFullWeek])

    expect(review.issues.some((issue) => issue.code === 'quality.load.progression_jump')).toBe(false)
  })

  it('warns for duplicate squash drills inside a session', () => {
    const review = reviewPlanQuality(plan(), [
      squashWeek(0, [
        squash(['Volea y vuelta a la T', 'Volea y vuelta a la T', '100 drives al cuadro de saque']),
        squash(['Tiros paralelos profundos', 'Boast y drive paralelo de salida', 'Drops desde media cancha']),
      ]),
    ])

    expect(review.issues.some((issue) => issue.code === 'quality.squash.repeated_drills')).toBe(true)
  })

  it('warns for low squash drill variety across a block but not a varied plan', () => {
    const monotonous = reviewPlanQuality(plan(), [
      squashWeek(0, [
        squash(['Volea y vuelta a la T', '100 drives al cuadro de saque', '100 drives desde media cancha']),
        squash(['Volea y vuelta a la T', '100 drives al cuadro de saque', '100 drives desde media cancha']),
      ]),
      squashWeek(1, [
        squash(['Volea y vuelta a la T', '100 drives al cuadro de saque', '100 drives desde media cancha']),
        squash(['Volea y vuelta a la T', '100 drives al cuadro de saque', '100 drives desde media cancha']),
      ]),
    ])
    const varied = reviewPlanQuality(plan(), [
      squashWeek(0, [
        squash(['Tiros paralelos profundos', 'Tiros cruzados profundos', 'Boast y drive paralelo de salida']),
        squash(['Drops desde media cancha', 'Volea ofensiva desde media cancha', 'Patrón largo-corto desde la T']),
      ]),
      squashWeek(1, [
        squash(['Ghosting a cuatro esquinas', 'Presión a esquinas de fondo', 'Juego condicionado solo paralelo']),
        squash(['Partido de entrenamiento al mejor de 3 juegos', 'Game a 11 con marcador real', 'Nick: cierre a la unión baja']),
      ]),
    ])

    expect(monotonous.issues.some((issue) => issue.code === 'quality.squash.low_drill_variety')).toBe(true)
    expect(varied.issues.some((issue) => issue.code === 'quality.squash.low_drill_variety')).toBe(false)
  })
})
