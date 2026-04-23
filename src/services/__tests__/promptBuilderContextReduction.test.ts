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
    secondarySports: ['running', 'cycling', 'mobility'],
    sportContext: {
      enabledSports: ['squash', 'running', 'cycling', 'mobility'],
      primarySport: 'squash',
      secondarySports: ['running', 'cycling', 'mobility'],
      trainingPriority: 'performance',
    },
    mainGoal: 'Llegar fresco al torneo principal',
    runningProfile: {
      z2PaceMin: '5:20',
      z2PaceMax: '5:40',
      thresholdPace: '4:30',
      fiveKTime: '22:00',
    },
    strengthProfile: {
      squat1RM: 140,
      deadlift1RM: 170,
      benchPress1RM: 95,
    },
    recoveryProfile: {
      currentInjuries: 'molestia leve de gemelo',
      restrictions: 'evitar impacto muy alto seguido',
    },
    scheduleProfile: {
      availableDays: ['monday', 'tuesday', 'thursday'],
      constraints: 'solo PM los martes',
    },
    goalEvents: [
      {
        id: 'goal-1',
        title: 'Open principal',
        date: '2026-05-15',
        sport: 'squash',
        priority: 'primary',
        eventType: 'tournament',
      },
    ],
    planWizardConfig: {
      goalEventId: 'goal-1',
      trainingDays: ['monday', 'tuesday', 'thursday'],
      sessionsPerWeek: 4,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['cycling', 'mobility', 'running'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: '2026-04-01',
      updatedAt: '2026-04-01',
    },
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-21',
    timeBlock: overrides.timeBlock ?? 'PM',
    type: overrides.type ?? 'running',
    title: overrides.title ?? 'Sesion',
    status: overrides.status ?? 'planned',
    durationMin: overrides.durationMin ?? 45,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  }
}

function makeContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: makeProfile(),
    recentMessages: [],
    intent: 'general_chat',
    ...overrides,
  }
}

describe('promptBuilder context reduction', () => {
  let buildCoachPrompt: typeof import('../ai/promptBuilder').buildCoachPrompt

  beforeAll(async () => {
    installLocalStorageMock()
    ;({ buildCoachPrompt } = await import('../ai/promptBuilder'))
  }, 120000)

  it('uses the slim athlete profile and omits heavy sections for generic chat', () => {
    const result = buildCoachPrompt(makeContext({
      intent: 'general_chat',
    }), {
      requestClass: 'chat_general',
      userMessage: '¿Cómo ves mi semana?',
    })

    expect(result.systemPrompt).toContain('PERFIL DEL ATLETA (SLIM)')
    expect(result.systemPrompt).not.toContain('═══ MACRO PLAN ═══')
    expect(result.systemPrompt).not.toContain('═══ NUTRICIÓN Y HIDRATACIÓN ═══')
    expect(result.systemPrompt).not.toContain('══ CARGA HISTÓRICA POR DISCIPLINA')
    expect(result.systemPrompt).not.toContain('Cargas de referencia (usa estos valores')
    expect(result.trace?.profileVariant).toBe('slim')
    expect(result.trace?.includedSections).toContain('athlete_profile_slim')
  })

  it('keeps adjust_session sport detection conservative around the affected session', () => {
    const result = buildCoachPrompt(makeContext({
      intent: 'adjust_session',
      plannedSessions: [
        makeSession({
          id: 'run-12345',
          date: '2026-04-21',
          timeBlock: 'PM',
          type: 'running',
          title: 'Running Z2',
        }),
        makeSession({
          id: 'bike-123',
          date: '2026-04-23',
          timeBlock: 'PM',
          type: 'cycling',
          title: 'Ciclismo suave',
        }),
      ],
    }), {
      requestClass: 'chat_action',
      userMessage: 'Ajusta la sesión del martes PM porque quedé cansado',
    })

    expect(result.trace?.promptRequestType).toBe('adjust_session')
    expect(result.trace?.includedSports).toEqual(['running'])
  })

  it('keeps action-scope sport context on the primary sport when no sport is explicit', () => {
    const result = buildCoachPrompt(makeContext({
      intent: 'plan_week',
      athleteProfile: makeProfile({
        secondarySports: ['running', 'cycling', 'mobility'],
        sportContext: {
          enabledSports: ['squash', 'running', 'cycling', 'mobility'],
          primarySport: 'squash',
          secondarySports: ['running', 'cycling', 'mobility'],
          trainingPriority: 'performance',
        },
        planWizardConfig: {
          ...makeProfile().planWizardConfig!,
          complementarySports: ['cycling', 'mobility', 'running'],
        },
      }),
    }), {
      requestClass: 'chat_action',
      userMessage: 'Armame la semana',
    })

    expect(result.trace?.promptRequestType).toBe('adjust_session')
    expect(result.trace?.includedSports).toEqual(['squash'])
  })

  it('records promptTrace metrics for chat requests', () => {
    const result = buildCoachPrompt(makeContext({
      intent: 'adjust_session',
    }), {
      requestClass: 'chat_action',
      userMessage: 'Agrega una sesión de running suave',
    })

    expect(result.trace).toBeDefined()
    expect(result.trace?.estimatedPromptChars).toBeGreaterThan(0)
    expect(result.trace?.estimatedPromptTokens).toBeGreaterThan(0)
    expect(result.trace?.profileSizeChars).toBeGreaterThan(0)
  })
})
