import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import {
  findStrengthExerciseByName,
  normalizeStrengthExerciseKey,
  STRENGTH_EXERCISE_LIBRARY,
} from '../training/exerciseLibrary'
import {
  deriveProgressionIntent,
  deriveStrengthProgressionState,
  extractRecentStrengthExercises,
  filterByEquipment,
  filterByFatigue,
  filterByPhase,
  getProgressedPrescription,
  getTargetExerciseDensity,
  pickStrengthStructure,
  selectStrengthSession,
  selectMainLiftWithProgression,
  summarizeStrengthProgression,
} from '../training/strengthSelector'

function makeStrengthSession(date: string, exercises: string[]): Session {
  return {
    id: `${date}-${exercises[0]}`,
    date,
    timeBlock: 'AM',
    type: 'strength',
    status: 'completed',
    title: 'Strength',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    exercises: exercises.map((name) => ({ name, sets: 4, reps: 5 })),
  } as Session
}

describe('strengthSelector progression', () => {
  it('contains the squash preparation exercise catalogue with aliases', () => {
    const requested = [
      'Clean',
      'Clean High Pull',
      'Split Jerk',
      'Barbell Jump Squat',
      'Trap Bar Deadlift',
      'Back Squat',
      'Front Squat',
      'Bench Press',
      'Z Press',
      'BB Reverse Lunge',
      'BB Side Lunges',
      'Romanian Deadlift',
      'Hip Thrust',
      'Single Leg Hip Thrust',
      'Bulgarian Split Squat',
      'Step Up',
      'Mixed Grip Pull Up',
      'Weighted Pull Up',
      'TRX Inverted Row',
      '1:2 Kneeling Row',
      'Barbell Single Leg Inverted Row',
      'Box Jump',
      'Broad Jump',
      'Single Leg Broad Jump',
      'Drop Jump',
      'Depth Jump',
      'Half Kneeling Lateral Jump',
      'Lateral Skater Jumps',
      'Alternating Step Up Jump',
      'Pogo Jumps',
      'Escalera Bipodal Frente Ej 1',
      'Escalera Bipodal Frente Ej 2',
      'Escalera Bipodal Frente Ej 3',
      'Escalera Coordinativo Frente 2',
      'Escalera Coordinativo Frente 4',
      'Escalera Bipodal Lateralización Ej 1',
      'Escalera Bipodal Lateralización Ej 3',
      'Pallof Press',
      'Copenhagen Side Plank',
      'Dead Bug',
      'Side Plank + Plate Press',
      'Stability Ball Front Plank',
      'Lateral Band Walk',
      'Bird Dog Renegade Row',
      'Half Kneeling Diagonal Plate Chop',
    ]

    expect(requested.map((name) => [name, findStrengthExerciseByName(name)?.id])).toEqual(
      requested.map((name) => [name, expect.any(String)]),
    )
  })

  it('keeps exercise ids and aliases unambiguous', () => {
    const owners = new Map<string, string>()

    for (const exercise of STRENGTH_EXERCISE_LIBRARY) {
      const keys = [exercise.id, exercise.name, ...(exercise.aliases ?? [])]
      for (const key of keys) {
        const normalized = normalizeStrengthExerciseKey(key)
        const owner = owners.get(normalized)

        expect(owner == null || owner === exercise.id).toBe(true)
        owners.set(normalized, exercise.id)
      }
    }
  })

  it('extracts recent strength exercise keys from completed history only', () => {
    const recent = extractRecentStrengthExercises([
      makeStrengthSession('2026-04-08', ['Back squat', 'Plank']),
      makeStrengthSession('2026-04-06', ['Deadlift']),
      makeStrengthSession('2026-04-04', ['Bench press']),
      {
        ...makeStrengthSession('2026-04-02', ['Front squat']),
        status: 'planned',
      },
    ])

    expect(recent).toEqual(['back_squat', 'plank', 'deadlift', 'bench_press'])
  })

  it('filters high intensity strength work out when fatigue is very high', () => {
    const filtered = filterByFatigue(STRENGTH_EXERCISE_LIBRARY, {
      phase: 'build',
      fatigueLevel: 8,
      recentExercises: [],
      goal: 'mantener',
      sportProfile: 'hybrid',
    })

    expect(filtered.every((exercise) => ['stability', 'recovery', 'hypertrophy'].includes(exercise.intensityType))).toBe(true)
  })

  it('filters taper phase away from lower hypertrophy emphasis', () => {
    const filtered = filterByPhase(STRENGTH_EXERCISE_LIBRARY, {
      phase: 'taper',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'llegar fresco',
      sportProfile: 'sport_support',
    })

    expect(filtered.some((exercise) => exercise.id === 'goblet_squat')).toBe(false)
    expect(filtered.some((exercise) => exercise.id === 'plank')).toBe(true)
  })

  it('maps equipment correctly before selection', () => {
    const filtered = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, ['bands', 'bodyweight'])
    expect(filtered.some((exercise) => exercise.id === 'back_squat')).toBe(false)
    expect(filtered.some((exercise) => exercise.id === 'plank')).toBe(true)
  })

  it('supports squash-specific equipment filters without changing standard exercises', () => {
    const trx = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, ['trx'])
    const ladder = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, ['ladder'])
    const stabilityBall = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, ['stability_ball'])

    expect(trx.some((exercise) => exercise.id === 'trx_inverted_row')).toBe(true)
    expect(ladder.some((exercise) => exercise.id === 'ladder_bipodal_front_1')).toBe(true)
    expect(stabilityBall.some((exercise) => exercise.id === 'stability_ball_front_plank')).toBe(true)
  })

  it('forces deload on strength ACWR risk', () => {
    const intent = deriveProgressionIntent(
      {
        phase: 'build',
        fatigueLevel: 4,
        recentExercises: [],
        goal: 'fuerza',
        sportProfile: 'hybrid',
        strengthAcwr: { sport: 'strength', acuteLoad: 700, chronicLoad: 500, ratio: 1.4, status: 'risk', baselineWeeks: 3 },
      },
      'squat',
      1,
    )

    expect(intent).toBe('deload')
  })

  it('rotates a hybrid athlete after repeating the same main pattern three times', () => {
    const state = deriveStrengthProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'fuerza lower',
      sportProfile: 'hybrid',
      historicalSessions: [
        makeStrengthSession('2026-04-08', ['Back squat', 'Plank']),
        makeStrengthSession('2026-04-06', ['Front squat', 'Dead bug']),
        makeStrengthSession('2026-04-03', ['Goblet squat', 'Pallof press']),
      ],
    })

    expect(state.mainPattern).toBe('squat')
    expect(state.intent).toBe('rotate')
  })

  it('progresses when undertrained and rotation thresholds do not fire', () => {
    const intent = deriveProgressionIntent(
      {
        phase: 'build',
        fatigueLevel: 4,
        recentExercises: [],
        goal: 'fuerza',
        sportProfile: 'strength_primary',
        strengthAcwr: { sport: 'strength', acuteLoad: 250, chronicLoad: 400, ratio: 0.62, status: 'undertrained', baselineWeeks: 3 },
      },
      'hinge',
      1,
    )

    expect(intent).toBe('progress')
  })

  it('selects a different main lift when rotate is active', () => {
    const scored = STRENGTH_EXERCISE_LIBRARY
      .filter((exercise) => ['back_squat', 'front_squat', 'deadlift'].includes(exercise.id))
      .map((exercise) => ({ exercise, score: exercise.id === 'deadlift' ? 9 : 8 }))

    const selected = selectMainLiftWithProgression(
      scored,
      {
        phase: 'build',
        fatigueLevel: 4,
        recentExercises: [],
        goal: 'fuerza',
        sportProfile: 'hybrid',
      },
      new Set<string>(),
      {
        intent: 'rotate',
        mainPattern: 'squat',
        patterns: {},
      },
    )

    expect(selected?.movement).toBe('hinge')
  })

  it('progresses the prescription for the main pattern in build phase', () => {
    const backSquat = STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === 'back_squat')!
    const prescription = getProgressedPrescription(
      backSquat,
      {
        phase: 'build',
        fatigueLevel: 4,
        recentExercises: [],
        goal: 'fuerza',
        sportProfile: 'strength_primary',
      },
      0,
      {
        intent: 'progress',
        mainPattern: 'squat',
        patterns: {},
      },
    )

    expect(prescription).toEqual({ sets: 5, reps: 3, intensity: 'moderate-heavy' })
  })

  it('summarizes the current main pattern state', () => {
    const summary = summarizeStrengthProgression({
      phase: 'build',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'fuerza lower',
      sportProfile: 'hybrid',
      historicalSessions: [makeStrengthSession('2026-04-08', ['Back squat', 'Plank'])],
    })

    expect(summary).toContain('squat')
  })

  it('builds a shorter, lower stress session near competition', () => {
    const selection = selectStrengthSession({
      phase: 'taper',
      fatigueLevel: 5,
      recentExercises: ['back_squat'],
      goal: 'apoyar squash sin cargar piernas',
      sportProfile: 'sport_support',
      primarySport: 'squash',
      availableEquipment: ['dumbbell', 'bands', 'bodyweight'],
      experienceLevel: 'intermediate',
      competitionSoon: true,
      daysToCompetition: 2,
      sessionDurationMin: 40,
    })

    expect(selection.exercises.length).toBeLessThanOrEqual(3)
    expect(selection.focus).toContain('activation')
    expect(selection.exercises.every((exercise) => exercise.intensity !== 'heavy')).toBe(true)
  })

  it('uses duration as the main driver for strength density', () => {
    const longSupport = selectStrengthSession({
      phase: 'build',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'preparacion fisica squash completa',
      sportProfile: 'sport_support',
      primarySport: 'squash',
      experienceLevel: 'intermediate',
      availableEquipment: ['dumbbell', 'bands', 'bodyweight', 'medball', 'trx', 'stability ball'],
      competitionSoon: false,
      sessionDurationMin: 60,
    })

    const shortSupport = selectStrengthSession({
      phase: 'build',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'preparacion fisica corta',
      sportProfile: 'sport_support',
      primarySport: 'squash',
      experienceLevel: 'intermediate',
      availableEquipment: ['dumbbell', 'bands', 'bodyweight'],
      competitionSoon: false,
      sessionDurationMin: 30,
    })

    expect(getTargetExerciseDensity({
      phase: 'build',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'preparacion fisica squash completa',
      sportProfile: 'sport_support',
      primarySport: 'squash',
      sessionDurationMin: 60,
    })).toMatchObject({ min: 5, target: 6, max: 7 })
    expect(longSupport.exercises.length).toBeGreaterThanOrEqual(6)
    expect(shortSupport.exercises.length).toBeGreaterThanOrEqual(3)
    expect(shortSupport.exercises.length).toBeLessThanOrEqual(4)
  })

  it('does not collapse a 60 minute strength session to three exercises on fatigue 7 alone', () => {
    const selection = selectStrengthSession({
      phase: 'build',
      fatigueLevel: 7,
      recentExercises: [],
      goal: 'mantener fuerza sin castigar',
      sportProfile: 'sport_support',
      primarySport: 'squash',
      experienceLevel: 'intermediate',
      availableEquipment: ['dumbbell', 'bands', 'bodyweight', 'trx', 'stability ball'],
      competitionSoon: false,
      sessionDurationMin: 60,
    })

    expect(getTargetExerciseDensity({
      phase: 'build',
      fatigueLevel: 7,
      recentExercises: [],
      goal: 'mantener fuerza sin castigar',
      sportProfile: 'sport_support',
      sessionDurationMin: 60,
    }).target).toBeGreaterThanOrEqual(4)
    expect(selection.exercises.length).toBeGreaterThanOrEqual(4)
  })

  it('reduces a 60 minute session near competition without dropping below coherent volume', () => {
    const selection = selectStrengthSession({
      phase: 'build',
      fatigueLevel: 4,
      recentExercises: [],
      goal: 'activar sin DOMS antes de competir',
      sportProfile: 'sport_support',
      primarySport: 'squash',
      experienceLevel: 'intermediate',
      availableEquipment: ['dumbbell', 'bands', 'bodyweight', 'trx', 'stability ball'],
      competitionSoon: true,
      daysToCompetition: 2,
      sessionDurationMin: 60,
    })

    expect(selection.exercises.length).toBeGreaterThanOrEqual(4)
    expect(selection.exercises.length).toBeLessThanOrEqual(5)
    expect(selection.exercises.every((exercise) => exercise.intensity !== 'heavy')).toBe(true)
  })

  it('prioritizes squash-specific power, lateral work and trunk when fresh', () => {
    const selection = selectStrengthSession({
      phase: 'build',
      fatigueLevel: 3,
      recentExercises: [],
      goal: 'potencia lateral core para squash',
      sportProfile: 'hybrid',
      primarySport: 'squash',
      experienceLevel: 'advanced',
      availableEquipment: ['barbell', 'trap bar', 'bodyweight', 'box', 'ladder', 'plate', 'bands', 'trx', 'stability ball'],
      competitionSoon: false,
      sessionDurationMin: 55,
    })

    const selectedDefinitions = selection.exercises.map((exercise) => findStrengthExerciseByName(exercise.name)!)

    expect(selection.focus).toContain('squash')
    expect(selectedDefinitions.every((exercise) => exercise.sportsTransfer?.includes('squash'))).toBe(true)
    expect(selectedDefinitions.some((exercise) => exercise.intensityType === 'power')).toBe(true)
    expect(selectedDefinitions.some((exercise) =>
      exercise.tags.includes('lateral_strength') ||
      exercise.tags.includes('lateral_power') ||
      exercise.tags.includes('court_footwork'),
    )).toBe(true)
    expect(selectedDefinitions.some((exercise) => exercise.category === 'core')).toBe(true)
  })

  it('keeps high-risk squash power out when fatigue is high or competition is close', () => {
    const riskyPowerIds = new Set(['clean', 'clean_high_pull', 'split_jerk', 'barbell_jump_squat', 'drop_jump', 'depth_jump'])
    const selection = selectStrengthSession({
      phase: 'taper',
      fatigueLevel: 8,
      recentExercises: [],
      goal: 'activar squash sin fatigar',
      sportProfile: 'sport_support',
      primarySport: 'squash',
      experienceLevel: 'advanced',
      availableEquipment: ['barbell', 'trap bar', 'bodyweight', 'box', 'ladder', 'plate', 'bands', 'trx', 'stability ball'],
      competitionSoon: true,
      daysToCompetition: 2,
      sessionDurationMin: 40,
    })

    const selectedIds = selection.exercises.map((exercise) => findStrengthExerciseByName(exercise.name)?.id)

    expect(selection.exercises.length).toBeLessThanOrEqual(3)
    expect(selectedIds.every((id) => id == null || !riskyPowerIds.has(id))).toBe(true)
    expect(selection.exercises.every((exercise) => exercise.intensity !== 'heavy' && exercise.intensity !== 'explosive')).toBe(true)
  })

  it('does not duplicate the main lift when a slot falls back in strength_primary', () => {
    const smallPool = STRENGTH_EXERCISE_LIBRARY.filter((exercise) =>
      ['romanian_deadlift', 'hip_thrust', 'plank'].includes(exercise.id),
    )

    const selection = pickStrengthStructure(
      smallPool,
      {
        phase: 'build',
        fatigueLevel: 3,
        recentExercises: [],
        goal: 'fuerza',
        sportProfile: 'strength_primary',
        availableEquipment: ['dumbbell', 'bands'],
        experienceLevel: 'beginner',
      },
      new Set<string>(),
    )

    const ids = selection.map((exercise) => exercise.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps taper and beginner filters in the relaxed fallback path', () => {
    const selection = selectStrengthSession({
      phase: 'taper',
      fatigueLevel: 8,
      recentExercises: ['plank', 'dead_bug', 'pallof_press'],
      goal: 'mantener fuerza sin fatigar',
      sportProfile: 'hybrid',
      availableEquipment: ['dumbbell', 'bodyweight'],
      experienceLevel: 'beginner',
      sessionDurationMin: 45,
      competitionSoon: false,
    })

    expect(selection.exercises.length).toBeGreaterThan(0)
    expect(selection.exercises.every((exercise) => !['Goblet squat', 'Walking lunge', 'Bulgarian split squat'].includes(exercise.name))).toBe(true)
  })
})
