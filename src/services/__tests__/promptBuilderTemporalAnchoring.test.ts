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
})
