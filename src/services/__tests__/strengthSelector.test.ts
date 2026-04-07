import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { STRENGTH_EXERCISE_LIBRARY } from '../training/exerciseLibrary'
import {
  deriveProgressionIntent,
  deriveStrengthProgressionState,
  extractRecentStrengthExercises,
  filterByEquipment,
  filterByFatigue,
  filterByPhase,
  getProgressedPrescription,
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
})
