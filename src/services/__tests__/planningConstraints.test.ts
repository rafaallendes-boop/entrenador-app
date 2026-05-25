import { beforeAll, describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext, CoachAction } from '../../types'
import {
  filterCoachSessionsToAllowedSports,
  getAllowedPlanningSports,
  getPlanWizardDefaultComplementarySports,
  getPlanningPrimarySport,
  sanitizeCoachActionsForPlan,
} from '../planningConstraints'

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'default',
    updatedAt: 1,
    primarySport: 'running',
    secondarySports: ['squash', 'strength'],
    sportContext: {
      enabledSports: ['running', 'squash', 'strength'],
      primarySport: 'running',
      secondarySports: ['squash', 'strength'],
      trainingPriority: 'performance',
    },
    goalEvents: [
      {
        id: 'goal-squash',
        title: '2do nacional',
        date: '2026-05-10',
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
      complementarySports: ['strength'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: '2026-04-01',
      updatedAt: '2026-04-01',
    },
    ...overrides,
  }
}

function makeContext(profile: AthleteProfile): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: profile,
    recentMessages: [],
    intent: 'plan_week',
  }
}

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

describe('planningConstraints', () => {
  it('uses the current competition plan as the source of truth for allowed sports', () => {
    const profile = makeProfile()

    expect(getPlanningPrimarySport(profile)).toBe('squash')
    expect(getAllowedPlanningSports(profile)).toEqual(['squash', 'strength'])
  })

  it('infers support sports from enabled sports when the plan has no explicit complementary sports', () => {
    const profile = makeProfile({
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: [],
      },
    })

    expect(getAllowedPlanningSports(profile)).toEqual(['squash', 'running', 'strength'])
  })

  it('allows only squash when it is the only enabled sport', () => {
    const profile = makeProfile({
      sportContext: {
        enabledSports: ['squash'],
        primarySport: 'squash',
        secondarySports: [],
        trainingPriority: 'performance',
      },
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: [],
      },
    })

    expect(getAllowedPlanningSports(profile)).toEqual(['squash'])
  })

  it('infers support sports from structured running and strength profiles', () => {
    const profile = makeProfile({
      sportContext: {
        enabledSports: ['squash'],
        primarySport: 'squash',
        secondarySports: [],
        trainingPriority: 'performance',
      },
      runningProfile: {
        z2PaceMin: '5:20',
        z2PaceMax: '5:45',
      },
      strengthProfile: {
        squat1RM: 120,
      },
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: [],
      },
    })

    expect(getAllowedPlanningSports(profile)).toEqual(['squash', 'running', 'strength'])
  })

  it('starts a new plan with no complementary sports selected by default', () => {
    expect(getPlanWizardDefaultComplementarySports(undefined, 'squash')).toEqual([])
  })

  it('keeps saved complementary sports when editing an existing plan', () => {
    const config = makeProfile().planWizardConfig!

    expect(getPlanWizardDefaultComplementarySports(config, 'squash')).toEqual(['strength'])
  })

  it('allows running when the current plan explicitly includes it', () => {
    const profile = makeProfile({
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: ['running'],
      },
    })

    expect(getAllowedPlanningSports(profile)).toEqual(['squash', 'running'])
  })

  it('ignores habitual running in the profile when the current plan excludes it', () => {
    const profile = makeProfile({
      runningProfile: {
        z2PaceMin: '5:20',
        z2PaceMax: '5:40',
        thresholdPace: '4:35',
        longRunPace: '5:40',
      },
    })

    expect(getAllowedPlanningSports(profile)).toEqual(['squash', 'strength'])
  })

  it('keeps mixed create_week intact so partial weeks are rejected before applying', () => {
    const profile = makeProfile()
    const actions: CoachAction[] = [
      {
        type: 'create_week',
        reason: 'semana nueva',
        weekObjectives: ['priorizar squash'],
        sessions: [
          {
            date: '2026-04-13',
            timeBlock: 'AM',
            sessionType: 'squash',
            title: 'Squash tecnico',
            durationMin: 60,
          },
          {
            date: '2026-04-14',
            timeBlock: 'AM',
            sessionType: 'running',
            title: 'Running tempo',
            durationMin: 45,
          },
        ],
      },
    ]

    const result = sanitizeCoachActionsForPlan(actions, profile)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].type).toBe('create_week')
    expect(result.actions[0].sessions).toHaveLength(2)
    expect(result.actions[0].sessions?.map((session) => session.sessionType)).toEqual(['squash', 'running'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('rechazarla antes de aplicar')
  })

  it('filters direct session proposals with a disallowed sport', () => {
    const profile = makeProfile()

    const actions: CoachAction[] = [
      {
        type: 'add_session',
        reason: 'agregar running',
        targetDate: '2026-04-16',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Running Z2',
        durationMin: 40,
      },
      {
        type: 'replace_session_type',
        reason: 'cambiar por running',
        sessionId: 'abcd1234',
        newType: 'running',
      },
    ]

    const result = sanitizeCoachActionsForPlan(actions, profile)

    expect(result.actions).toEqual([])
    expect(result.warnings).toHaveLength(2)
  })

  it('can filter arbitrary session arrays down to the allowed sports', () => {
    const profile = makeProfile({
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: ['running'],
      },
    })

    const filtered = filterCoachSessionsToAllowedSports([
      { date: '2026-04-13', timeBlock: 'AM', sessionType: 'squash', title: 'Match prep', durationMin: 60 },
      { date: '2026-04-14', timeBlock: 'AM', sessionType: 'running', title: 'Tempo', durationMin: 45 },
      { date: '2026-04-15', timeBlock: 'PM', sessionType: 'strength', title: 'Gym', durationMin: 50 },
    ], profile)

    expect(filtered.map((session) => session.sessionType)).toEqual(['squash', 'running'])
  })
})

describe('planning prompt allowed sports', () => {
  let buildCoachSystemPrompt: typeof import('../ai/promptBuilder').buildCoachSystemPrompt

  beforeAll(async () => {
    installLocalStorageMock()
    ;({ buildCoachSystemPrompt } = await import('../ai/promptBuilder'))
  }, 120000)

  it('does not reintroduce running into the prompt when the current plan excludes it', () => {
    const prompt = buildCoachSystemPrompt(makeContext(makeProfile()))

    expect(prompt).toContain('Usa solo deportes permitidos: squash, strength')
    expect(prompt).not.toMatch(/CARGAS Y RITMOS[\s\S]*Running:/)
    expect(prompt).not.toContain('Running Z2')
    expect(prompt).not.toContain('SELECCION DINAMICA DE RUNNING')
  })

  it('keeps running available in the prompt when the current plan explicitly allows it', () => {
    const profile = makeProfile({
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        complementarySports: ['running'],
      },
    })

    const prompt = buildCoachSystemPrompt(makeContext(profile), {
      requestClass: 'chat_action',
      userMessage: 'Agrega running Z2',
    })

    expect(prompt).toContain('Usa solo deportes permitidos: squash, running')
    expect(prompt).toContain('Running:')
    expect(prompt).toContain('SELECCION DINAMICA DE RUNNING')
  })

  it('does not reintroduce strength into a running-only plan', () => {
    const profile = makeProfile({
      sportContext: {
        enabledSports: ['running'],
        primarySport: 'running',
        secondarySports: [],
        trainingPriority: 'performance',
      },
      goalEvents: [
        {
          id: 'goal-running',
          title: '10k objetivo',
          date: '2026-05-10',
          sport: 'running',
          priority: 'primary',
          eventType: 'race',
        },
      ],
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        goalEventId: 'goal-running',
        complementarySports: [],
      },
    })

    const prompt = buildCoachSystemPrompt(makeContext(profile))

    expect(prompt).toContain('Usa solo deportes permitidos: running')
    expect(prompt).toContain('Running:')
    expect(prompt).not.toContain('Fuerza estructurada')
    expect(prompt).not.toContain('Fuerza de apoyo')
    expect(prompt).not.toContain('SELECCION DINAMICA DE FUERZA')
  })

  it('does not reintroduce strength into a cycling-only plan', () => {
    const profile = makeProfile({
      sportContext: {
        enabledSports: ['cycling'],
        primarySport: 'cycling',
        secondarySports: [],
        trainingPriority: 'performance',
      },
      goalEvents: [
        {
          id: 'goal-cycling',
          title: 'Gran fondo',
          date: '2026-05-10',
          sport: 'cycling',
          priority: 'primary',
          eventType: 'cycling_event',
        },
      ],
      planWizardConfig: {
        ...makeProfile().planWizardConfig!,
        goalEventId: 'goal-cycling',
        complementarySports: [],
      },
    })

    const prompt = buildCoachSystemPrompt(makeContext(profile))

    expect(prompt).toContain('Usa solo deportes permitidos: cycling')
    expect(prompt).toContain('Ciclismo Z2')
    expect(prompt).not.toContain('Fuerza estructurada')
    expect(prompt).not.toContain('Fuerza de apoyo')
    expect(prompt).not.toContain('SELECCION DINAMICA DE FUERZA')
  })
})
