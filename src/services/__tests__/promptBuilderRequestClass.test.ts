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
    expect(prompt).toContain('Para referencias como lunes/martes/viernes/sábado, usa exactamente la fecha indicada')
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
