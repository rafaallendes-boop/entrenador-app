import { beforeAll, describe, expect, it, vi } from 'vitest'

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

function makeContext(): ChatContext {
  const athleteProfile: AthleteProfile = {
    id: 'athlete-1',
    updatedAt: 1,
    primarySport: 'running',
    secondarySports: [],
    sportContext: {
      enabledSports: ['running'],
      primarySport: 'running',
      secondarySports: [],
      trainingPriority: 'performance',
    },
    goalEvents: [],
  }

  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile,
    recentMessages: [],
    intent: 'weekly_summary',
  }
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 'session-1',
    date: '2026-06-30',
    timeBlock: 'AM',
    type: 'running',
    status: 'planned',
    title: 'Sesion',
    durationMin: 45,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Session
}

describe('promptBuilder request class branching', () => {
  let buildCoachSystemPrompt: typeof import('../ai/promptBuilder').buildCoachSystemPrompt

  beforeAll(async () => {
    installLocalStorageMock()
    ;({ buildCoachSystemPrompt } = await import('../ai/promptBuilder'))
  }, 120000)

  it('keeps weekly summaries on the minimal text-only branch', () => {
    const prompt = buildCoachSystemPrompt(makeContext(), { requestClass: 'weekly_summary' })

    expect(prompt).toContain('INSTRUCCIONES DE RESUMEN SEMANAL')
    expect(prompt).toContain('no uses <actions>')
    expect(prompt).not.toContain('DEBES responder con create_week')
  })

  it('keeps chat_action on the reduced adjust branch even if the legacy intent says plan_week', () => {
    const prompt = buildCoachSystemPrompt({
      ...makeContext(),
      intent: 'plan_week',
    }, { requestClass: 'chat_action' })

    expect(prompt).toContain('INSTRUCCIONES DE AJUSTE')
    expect(prompt).toContain('No uses create_week para ajustes puntuales')
    expect(prompt).not.toContain('DEBES responder con create_week')
    expect(prompt).not.toContain('EJEMPLO — microciclo competitivo con partido el sábado')
  })

  it('uses the reduced adjust branch for targeted action requests', () => {
    const prompt = buildCoachSystemPrompt({
      ...makeContext(),
      intent: 'adjust_session',
    }, {
      requestClass: 'chat_action',
      userMessage: 'Agrega una sesión de running el martes',
    })

    expect(prompt).toContain('INSTRUCCIONES DE AJUSTE')
    expect(prompt).toContain('No uses create_week para ajustes puntuales')
    expect(prompt).toContain('add_session')
    expect(prompt).not.toContain('EJEMPLO — microciclo competitivo con partido el sábado')
    expect(prompt).not.toContain('Para CREAR una semana completa')
  })

  it('pins weekday names to absolute dates for chat_action date resolution', () => {
    const prompt = buildCoachSystemPrompt({
      ...makeContext(),
      currentWeekSummary: {
        id: 'week-1',
        weekStartDate: '2026-05-04',
        totalSessions: 0,
        totalMinutes: 0,
        plannedSessions: 0,
        completedSessions: 0,
        plannedMinutes: 0,
        completedMinutes: 0,
        squashSessions: 0,
        runningSessions: 0,
        strengthSessions: 0,
        updatedAt: 1,
      },
    }, {
      requestClass: 'chat_action',
      userMessage: 'Agrega running el viernes PM',
    })

    expect(prompt).toContain('2026-05-08 (viernes)')
    expect(prompt).toContain('Para referencias como lunes/martes/viernes/sábado, usa la fecha correspondiente dentro de la semana solicitada')
  })

  it('anchors mañana to the exact date and marks planned sessions with relative labels', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 30, 12))

    try {
      const prompt = buildCoachSystemPrompt({
        ...makeContext(),
        currentWeekSummary: {
          id: 'week-1',
          weekStartDate: '2026-06-29',
          totalSessions: 0,
          totalMinutes: 0,
          plannedSessions: 0,
          completedSessions: 0,
          plannedMinutes: 0,
          completedMinutes: 0,
          squashSessions: 0,
          runningSessions: 0,
          strengthSessions: 0,
          updatedAt: 1,
        },
        plannedSessions: [
          makeSession({
            id: '08673c59-today',
            date: '2026-06-30',
            timeBlock: 'AM',
            type: 'squash',
            title: 'Squash pressure',
            durationMin: 60,
            rpe: 8,
          }),
          makeSession({
            id: 'str-20260701',
            date: '2026-07-01',
            timeBlock: 'PM',
            type: 'strength',
            title: 'Fuerza estructurada',
            durationMin: 60,
            rpe: 7,
          }),
        ],
      }, {
        requestClass: 'chat_action',
        userMessage: 'Agrégame una sesión de pesas para mañana',
      })

      expect(prompt).toContain('Fecha solicitada por el usuario: MAÑANA (2026-07-01')
      expect(prompt).toContain('2026-06-30 (30 jun 2026 · Mar 30) · HOY AM · squash')
      expect(prompt).toContain('2026-07-01 (1 jul 2026 · Mié 1) · MAÑANA PM · fuerza')
      expect(prompt).toContain('no los muestres al usuario')
      expect(prompt).toContain('No llames "mañana" a una sesión marcada HOY')
    } finally {
      vi.useRealTimers()
    }
  })

  it('includes recent proposal outcomes so rejected changes are not treated as applied', () => {
    const prompt = buildCoachSystemPrompt({
      ...makeContext(),
      recentProposals: [{
        id: 'proposal-1',
        status: 'rejected',
        createdAt: 10,
        resolvedAt: 20,
        message: 'Agregar running el viernes PM',
        actions: [{
          type: 'add_session',
          targetDate: '2026-05-08',
          timeBlock: 'PM',
          sessionType: 'running',
          title: 'Rodaje',
          durationMin: 45,
          reason: 'Sostener base',
        }],
      }],
    }, {
      requestClass: 'chat_action',
      userMessage: 'ajusta eso',
    })

    expect(prompt).toContain('PROPUESTAS RECIENTES Y RESULTADO')
    expect(prompt).toContain('rejected: <<user-text>>Agregar running el viernes PM<</user-text>>')
    expect(prompt).toContain('No digas que una propuesta rechazada fue aplicada')
  })
})
