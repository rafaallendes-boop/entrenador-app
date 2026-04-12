import { beforeAll, describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext, Session } from '../../types'

function installLocalStorageMock() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
    },
  })
}

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 1,
    primarySport: 'squash',
    secondarySports: ['cycling', 'mobility'],
    sportContext: {
      enabledSports: ['squash', 'cycling', 'mobility'],
      primarySport: 'squash',
      secondarySports: ['cycling', 'mobility'],
      trainingPriority: 'performance',
    },
    goalEvents: [
      {
        id: 'goal-squash',
        title: 'Open de squash',
        date: '2026-04-20',
        sport: 'squash',
        priority: 'primary',
        eventType: 'tournament',
      },
    ],
    planWizardConfig: {
      goalEventId: 'goal-squash',
      trainingDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 4,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['cycling', 'mobility'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: '2026-04-01',
      updatedAt: '2026-04-01',
    },
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-09',
    timeBlock: overrides.timeBlock ?? 'AM',
    type: overrides.type ?? 'running',
    status: overrides.status ?? 'completed',
    title: overrides.title ?? 'Sesion',
    durationMin: overrides.durationMin ?? 45,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  }
}

function makeContext(profile: AthleteProfile, overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: profile,
    recentMessages: [],
    intent: 'plan_week',
    ...overrides,
  }
}

describe('promptBuilder dynamic cycling and mobility sections', () => {
  let buildCoachSystemPrompt: typeof import('../ai/promptBuilder').buildCoachSystemPrompt

  beforeAll(async () => {
    installLocalStorageMock()
    ;({ buildCoachSystemPrompt } = await import('../ai/promptBuilder'))
  }, 120000)

  it('does not mark cycling competitionSoon from a squash match alone', () => {
    const profile = makeProfile()
    const context = makeContext(profile, {
      plannedSessions: [
        makeSession({
          id: 'squash-match',
          date: '2026-04-10',
          type: 'squash',
          subtype: 'match',
          status: 'planned',
          title: 'Partido de squash',
        }),
      ],
    })

    const prompt = buildCoachSystemPrompt(context)

    expect(prompt).toMatch(/CICLISMO[\s\S]*competencia cercana no/)
  })

  it('marks cycling competitionSoon when there is a cycling goal event near', () => {
    const profile = makeProfile({
      goalEvents: [
        {
          id: 'goal-cycling',
          title: 'Gran Fondo',
          date: '2026-04-12',
          sport: 'cycling',
          priority: 'primary',
          eventType: 'cycling_event',
        },
      ],
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        goalEventId: 'goal-cycling',
        complementarySports: ['mobility'],
      },
      primarySport: 'cycling',
      secondarySports: ['mobility'],
      sportContext: {
        enabledSports: ['cycling', 'mobility'],
        primarySport: 'cycling',
        secondarySports: ['mobility'],
        trainingPriority: 'performance',
      },
    })

    const prompt = buildCoachSystemPrompt(makeContext(profile))

    expect(prompt).toMatch(/CICLISMO[\s\S]*competencia cercana si/)
  })

  it('uses post-running mobility when the latest completed session was running', () => {
    const profile = makeProfile()
    const context = makeContext(profile, {
      historicalSessions: [
        makeSession({
          id: 'run-1',
          date: '2026-04-08',
          type: 'running',
          status: 'completed',
          title: 'Running Z2',
          updatedAt: 10,
        }),
      ],
    })

    const prompt = buildCoachSystemPrompt(context)

    expect(prompt).toContain('MOVILIDAD')
    expect(prompt).toContain('Movilidad post-running')
  })

  it('includes explicit cyclingDetails guidance when cycling is enabled', () => {
    const prompt = buildCoachSystemPrompt(makeContext(makeProfile()))

    expect(prompt).toContain('cyclingDetails')
    expect(prompt).toContain('sessionCategory')
    expect(prompt).toContain('sessionFamily')
  })

  it('includes explicit mobilityDetails guidance when mobility is enabled', () => {
    const prompt = buildCoachSystemPrompt(makeContext(makeProfile()))

    expect(prompt).toContain('mobilityDetails')
    expect(prompt).toContain('focusAreas')
    expect(prompt).toContain('pre_training_activation')
  })

  it('includes explicit practice_match guidance for squash planning', () => {
    const prompt = buildCoachSystemPrompt(makeContext(makeProfile()))

    expect(prompt).toContain('practice_match')
    expect(prompt).toContain('competition_match')
    expect(prompt).toContain('Partido de entrenamiento con foco tactico')
  })

  it('marks warmup and cooldown as optional for compact create_week responses', () => {
    const prompt = buildCoachSystemPrompt(makeContext(makeProfile()))

    expect(prompt).toContain('Warmup y cooldown (opcionales)')
    expect(prompt).toContain('el sistema genera protocolos base automáticamente')
  })
  it('keeps extracted reference and schema sections in the final prompt', () => {
    const prompt = buildCoachSystemPrompt(makeContext(makeProfile()))

    expect(prompt).toContain('ADDENDUM - CAMPOS EXPLICITOS PARA CYCLING Y MOBILITY')
    expect(prompt).toContain('CARGAS Y RITMOS DE REFERENCIA')
  })

  it('uses personalized nutrition targets from getDayNutrition in the prompt context', () => {
    const profile = makeProfile({
      weightKg: 80,
      nutritionProfile: {
        dailyWaterLiters: 2.5,
      },
    })
    const prompt = buildCoachSystemPrompt(makeContext(profile, {
      plannedSessions: [
        makeSession({
          id: 'tempo-1',
          date: '2026-04-11',
          type: 'running',
          runningDetails: { runningType: 'tempo' },
          status: 'planned',
          durationMin: 45,
          rpe: 6,
        }),
      ],
    }))

    expect(prompt).toContain('Proteína diaria objetivo: ~144g proteína')
    expect(prompt).toContain('Hidratación recomendada:')
  })
})
