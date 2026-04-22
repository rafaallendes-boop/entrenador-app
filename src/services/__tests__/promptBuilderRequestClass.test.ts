import { beforeAll, describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../types'

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

  it('uses the full planning branch for chat plan requests', () => {
    const prompt = buildCoachSystemPrompt({
      ...makeContext(),
      intent: 'plan_week',
    }, { requestClass: 'chat_action' })

    expect(prompt).toContain('INSTRUCCIONES DEL COACH-PLANNER')
    expect(prompt).toContain('DEBES responder con create_week')
    expect(prompt).not.toContain('NUTRICIÓN Y HIDRATACIÓN')
    expect(prompt).not.toContain('INSTRUCCIONES DE AJUSTE')
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
})
