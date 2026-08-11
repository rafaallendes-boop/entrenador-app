import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '../../types'
import { buildCoachSystemPrompt } from '../ai/promptBuilder'

describe('promptBuilder temporal anchoring guards', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-18T15:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const context: ChatContext = {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteMemory: 'Torneo Nacional el viernes 17 de julio. Partido competitivo el jueves.',
  }

  it('instructs the model to distrust old "hoy" mentions from replayed history in general chat', () => {
    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('mensajes de días anteriores')
    expect(prompt).toContain('la única fecha vigente es la de esta sección')
  })

  it('includes the same history guard in action prompts', () => {
    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_action' })

    expect(prompt).toContain('la única fecha vigente es la de esta sección')
  })

  it('marks athlete memory as potentially stale relative to today', () => {
    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('MEMORIA DEL ATLETA')
    expect(prompt).toContain('HOY es 18 jul 2026')
    expect(prompt).toContain('cualquier fecha anterior ya pasó')
  })

  it('keeps a multiday championship active after its start date', () => {
    vi.setSystemTime(new Date('2026-09-08T15:00:00'))
    const prompt = buildCoachSystemPrompt({
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      athleteProfile: {
        id: 'athlete-window',
        updatedAt: 0,
        primarySport: 'squash',
        goalEvents: [{
          id: 'event-window',
          title: 'Campeonato',
          date: '2026-09-05',
          endDate: '2026-09-11',
          keyDate: '2026-09-09',
          sport: 'squash',
          priority: 'primary',
        }],
      },
    }, { requestClass: 'chat_general' })

    expect(prompt).toContain('═══ MACRO PLAN ═══')
    expect(prompt).toContain('5–11 sep 2026')
    expect(prompt).toContain('Día clave: 9 sep')
    expect(prompt).toContain('Timing del evento: active')
    expect(prompt).toContain('NO la describas como post-evento')
  })
})
