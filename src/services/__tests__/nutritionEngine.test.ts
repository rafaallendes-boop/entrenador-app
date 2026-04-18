import { describe, expect, it } from 'vitest'

import type { AthleteProfile, DayLog, Session } from '../../types'
import { classifyNutritionDayType, getDayNutrition } from '../nutritionEngine'

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-11',
    timeBlock: overrides.timeBlock ?? 'AM',
    type: overrides.type ?? 'running',
    status: overrides.status ?? 'planned',
    title: overrides.title ?? 'Sesion',
    durationMin: overrides.durationMin ?? 60,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  }
}

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 1,
    weightKg: 80,
    nutritionProfile: {
      dailyWaterLiters: 2.5,
      sweatRate: 'moderate',
      fuelingGoal: 'performance',
      ...overrides.nutritionProfile,
    },
    sportContext: {
      enabledSports: ['running'],
      primarySport: 'running',
      secondarySports: [],
      trainingPriority: 'performance',
      ...overrides.sportContext,
    },
    ...overrides,
  }
}

describe('nutritionEngine', () => {
  it('returns rest recommendations when there are no sessions', () => {
    const rec = getDayNutrition([], makeProfile())

    expect(rec.dayType).toBe('rest')
    expect(rec.mainFocus).toContain('Descanso')
  })

  it('classifies a high-intensity squash day correctly', () => {
    const rec = getDayNutrition([
      makeSession({
        type: 'squash',
        subtype: 'competitive',
        durationMin: 75,
        rpe: 8,
      }),
    ], makeProfile({
      sportContext: {
        enabledSports: ['squash'],
        primarySport: 'squash',
        secondarySports: [],
        trainingPriority: 'performance',
      },
    }))

    expect(rec.dayType).toBe('competition')
    expect(rec.keyAction).toContain('partido')
    expect(rec.preWorkoutGuidance?.summary).toContain('warm-up')
  })

  it('classifies a running z2 day as moderate', () => {
    const dayType = classifyNutritionDayType([
      makeSession({
        type: 'running',
        durationMin: 55,
        rpe: 5,
        runningDetails: { runningType: 'z2' },
      }),
    ])

    expect(dayType).toBe('moderate')
  })

  it('classifies threshold or intervals as high', () => {
    const dayType = classifyNutritionDayType([
      makeSession({
        type: 'running',
        durationMin: 50,
        rpe: 8,
        runningDetails: { runningType: 'intervals' },
      }),
    ])

    expect(dayType).toBe('high')
  })

  it('treats a standard strength session as moderate', () => {
    const rec = getDayNutrition([
      makeSession({
        type: 'strength',
        durationMin: 60,
        rpe: 6,
      }),
    ], makeProfile({
      sportContext: {
        enabledSports: ['strength'],
        primarySport: 'strength',
        secondarySports: [],
        trainingPriority: 'performance',
      },
    }))

    expect(rec.dayType).toBe('moderate')
    expect(rec.macroEmphasis).toBe('balanced')
    expect(rec.mainFocus).toContain('Fuerza moderada')
    expect(rec.keyAction).toContain('proteína ligera')
  })

  it('detects double-session days', () => {
    const rec = getDayNutrition([
      makeSession({ id: 'a', type: 'running', runningDetails: { runningType: 'z2' }, durationMin: 45, rpe: 5 }),
      makeSession({ id: 'b', type: 'strength', timeBlock: 'PM', durationMin: 50, rpe: 7 }),
    ], makeProfile())

    expect(rec.dayType).toBe('double_session')
    expect(rec.mealTiming.some((item) => item.label === 'Entre sesiones')).toBe(true)
  })

  it('adjusts macro emphasis for mild fat loss goals', () => {
    const rec = getDayNutrition([
      makeSession({ type: 'running', runningDetails: { runningType: 'z2' }, durationMin: 40, rpe: 5 }),
    ], makeProfile({
      nutritionProfile: {
        fuelingGoal: 'mild_fat_loss',
        dailyWaterLiters: 2.5,
        sweatRate: 'moderate',
      },
      sportContext: {
        enabledSports: ['running'],
        primarySport: 'running',
        secondarySports: [],
        trainingPriority: 'body_composition',
      },
    }))

    expect(rec.macroEmphasis).toBe('carb_support')
    expect(rec.mainFocus).toContain('carbohidratos')
  })

  it('changes hydration guidance by load and sweat rate', () => {
    const moderate = getDayNutrition([
      makeSession({ type: 'running', runningDetails: { runningType: 'z2' }, durationMin: 45, rpe: 5 }),
    ], makeProfile())

    const highSweat = getDayNutrition([
      makeSession({ type: 'running', runningDetails: { runningType: 'intervals' }, durationMin: 55, rpe: 8 }),
    ], makeProfile({
      nutritionProfile: {
        dailyWaterLiters: 2.5,
        sweatRate: 'high',
        fuelingGoal: 'performance',
      },
    }))

    expect(highSweat.hydrationGuidance.totalLiters).toBeGreaterThan(moderate.hydrationGuidance.totalLiters ?? 0)
    expect(highSweat.hydrationGuidance.electrolyteFocus).toBe('recommended')
    expect(highSweat.hydrationGuidance.summary).toContain('antes de tener sed')
  })

  it('uses recovery day type when fatigue signals are present without hard training', () => {
    const dayLog: DayLog = {
      id: 'day-1',
      date: '2026-04-11',
      energyLevel: 3,
      sleepHours: 5.5,
      updatedAt: 1,
    }

    const rec = getDayNutrition([
      makeSession({
        type: 'mobility',
        durationMin: 20,
        rpe: 2,
      }),
    ], makeProfile(), dayLog)

    expect(rec.dayType).toBe('recovery')
    expect(rec.recoveryNote).toContain('fatiga')
  })

  it('changes recommendation copy by day type', () => {
    const light = getDayNutrition([
      makeSession({ type: 'mobility', durationMin: 20, rpe: 3 }),
    ], makeProfile())
    const high = getDayNutrition([
      makeSession({ type: 'running', runningDetails: { runningType: 'intervals' }, durationMin: 60, rpe: 8 }),
    ], makeProfile())

    expect(light.mainFocus).not.toBe(high.mainFocus)
    expect(light.keyAction).not.toBe(high.keyAction)
  })

  it('uses running-specific high-load reasoning and fueling copy', () => {
    const rec = getDayNutrition([
      makeSession({ type: 'running', runningDetails: { runningType: 'intervals' }, durationMin: 60, rpe: 8 }),
    ], makeProfile())

    expect(rec.mainFocus).toContain('running')
    expect(rec.whyItMatters).toContain('ritmos')
  })

  it('uses cycling-specific hydration and recovery copy', () => {
    const rec = getDayNutrition([
      makeSession({
        type: 'cycling',
        durationMin: 110,
        rpe: 7,
        cyclingDetails: {
          sessionCategory: 'primary endurance',
          sessionFamily: 'long_ride',
          targetStructure: 'Rodaje largo continuo',
        },
      }),
    ], makeProfile({
      sportContext: {
        enabledSports: ['cycling'],
        primarySport: 'cycling',
        secondarySports: [],
        trainingPriority: 'performance',
      },
    }))

    expect(rec.mainFocus).toContain('ciclismo')
    expect(rec.hydrationGuidance.summary).toContain('bidón')
    expect(rec.postWorkoutGuidance?.summary).toContain('líquidos')
  })
})
