import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
  let optimizeChatContext: typeof import('../ai/contextOptimizer').optimizeChatContext

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T12:00:00'))
    installLocalStorageMock()
    ;({ buildCoachPrompt } = await import('../ai/promptBuilder'))
    ;({ optimizeChatContext } = await import('../ai/contextOptimizer'))
  }, 120000)

  afterAll(() => {
    vi.useRealTimers()
  })

  it('uses the slim athlete profile and omits heavy sections for generic chat without nearby competition', () => {
    const result = buildCoachPrompt(makeContext({
      intent: 'general_chat',
      athleteProfile: makeProfile({ goalEvents: [] }),
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

  it('keeps macro plan context for generic chat when competition is within 14 days', () => {
    const result = buildCoachPrompt(makeContext({
      intent: 'general_chat',
    }), {
      requestClass: 'chat_general',
      userMessage: '¿Cómo ves mi semana?',
    })

    expect(result.systemPrompt).toContain('═══ MACRO PLAN ═══')
    expect(result.trace?.includedSections).toContain('macro_plan')
  })

  it('keeps adjust_session sport detection conservative around the affected session', () => {
    const result = buildCoachPrompt(makeContext({
      intent: 'adjust_session',
      plannedSessions: [
        makeSession({
          id: 'run-12345',
          date: '2026-05-12',
          timeBlock: 'PM',
          type: 'running',
          title: 'Running Z2',
        }),
        makeSession({
          id: 'bike-123',
          date: '2026-05-14',
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

  it('keeps weekly summary prompts under the proxy limit with heavy context', () => {
    const longText = 'detalle de entrenamiento y recuperacion '.repeat(90)
    const plannedSessions = Array.from({ length: 18 }, (_, index) => makeSession({
      id: `planned-${index}`,
      date: `2026-05-${String(5 + (index % 7)).padStart(2, '0')}`,
      timeBlock: index % 2 === 0 ? 'AM' : 'PM',
      type: index % 3 === 0 ? 'strength' : index % 3 === 1 ? 'running' : 'squash',
      title: `Sesion planificada ${index}`,
      objective: longText,
      exercises: Array.from({ length: 8 }, (__, exerciseIndex) => ({
        id: `ex-${index}-${exerciseIndex}`,
        name: `Ejercicio ${exerciseIndex} ${longText.slice(0, 80)}`,
        sets: 4,
        reps: 8,
        completed: false,
      })),
    }))
    const historicalSessions = Array.from({ length: 18 }, (_, index) => makeSession({
      id: `history-${index}`,
      date: `2026-04-${String(10 + (index % 14)).padStart(2, '0')}`,
      status: 'completed',
      type: index % 2 === 0 ? 'running' : 'squash',
      title: `Sesion completada ${index}`,
      completionNotes: longText,
      sessionFeedback: {
        rating: 3,
        energyDuringSession: 3,
        mainChallenge: longText,
      },
    }))
    const context = optimizeChatContext(makeContext({
      intent: 'weekly_summary',
      athleteMemory: longText,
      athleteProfile: makeProfile({
        mainGoal: longText,
        secondaryGoal: longText,
        runningProfile: {
          z2PaceMin: '5:20',
          z2PaceMax: '5:40',
          thresholdPace: '4:30',
          fiveKTime: '22:00',
          notes: longText,
        },
        recoveryProfile: {
          currentInjuries: longText,
          restrictions: longText,
          previousInjuries: longText,
        },
        scheduleProfile: {
          availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          constraints: longText,
        },
      }),
      currentWeekSummary: {
        id: 'week-heavy',
        weekStartDate: '2026-05-04',
        updatedAt: 1,
        totalSessions: 10,
        totalMinutes: 600,
        plannedSessions: 10,
        completedSessions: 6,
        plannedMinutes: 600,
        completedMinutes: 360,
        squashSessions: 2,
        runningSessions: 3,
        strengthSessions: 1,
        plannedSquashSessions: 3,
        plannedRunningSessions: 4,
        plannedStrengthSessions: 2,
        adherencePct: 60,
        avgActualRpe: 8.2,
        avgSleep: 5.8,
        avgEnergy: 4.6,
        objectives: [longText, longText],
      },
      plannedSessions,
      historicalSessions,
      recentSessions: [...plannedSessions, ...historicalSessions],
      weekDayLogs: Array.from({ length: 7 }, (_, index) => ({
        id: `log-${index}`,
        date: `2026-05-${String(4 + index).padStart(2, '0')}`,
        updatedAt: 1,
        sleepHours: 5.5 + index * 0.1,
        energyLevel: 4,
        painLevel: 2,
        rpeActual: 8,
        postSessionComment: longText,
        generalNotes: longText,
      })),
    }), 'weekly_summary')

    const result = buildCoachPrompt(context, {
      requestClass: 'weekly_summary',
      userMessage: 'Genera un resumen semanal corto y concreto.',
    })

    expect(result.trace?.promptRequestType).toBe('weekly_summary')
    expect(result.systemPrompt).toContain('INSTRUCCIONES DE RESUMEN SEMANAL')
    expect(result.systemPrompt.length).toBeLessThanOrEqual(18000)
  })
})
