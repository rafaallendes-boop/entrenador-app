import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../types'
import { detectChatIntent, inferRequestClassFromIntent, optimizeChatContext } from '../ai/contextOptimizer'

function makeSession(id: string, date: string, title: string): Session {
  return {
    id,
    date,
    weekStartDate: '2026-05-05',
    timeBlock: 'AM',
    type: 'squash',
    status: 'planned',
    title,
    durationMin: 60,
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('contextOptimizer budgets by request class', () => {
  const sessions = Array.from({ length: 10 }, (_, index) =>
    makeSession(`s-${index}`, `2026-05-${String(index + 10).padStart(2, '0')}`, `Sesion ${index} con bastante contexto repetido`),
  )
  const context: ChatContext = {
    recentSessions: sessions,
    plannedSessions: sessions,
    historicalSessions: sessions,
    weekDayLogs: Array.from({ length: 5 }, (_, index) => ({
      id: `log-${index}`,
      date: `2026-05-${String(index + 10).padStart(2, '0')}`,
      updatedAt: 1,
      generalNotes: `Nota ${index} con bastante detalle para probar trimming`,
    })),
    recentMessages: Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'coach',
      content: `Mensaje ${index} con bastante contexto para validar recorte`,
    })),
  }

  it('uses a tighter budget for chat_general than chat_action', () => {
    const general = optimizeChatContext(context, 'chat_general')
    const action = optimizeChatContext(context, 'chat_action')

    expect((general.recentMessages ?? []).length).toBeLessThanOrEqual((action.recentMessages ?? []).length)
    expect((general.plannedSessions ?? []).length).toBeLessThanOrEqual((action.plannedSessions ?? []).length)
    expect((general.weekDayLogs ?? []).length).toBeLessThanOrEqual((action.weekDayLogs ?? []).length)
  })

  it('preserves more weekly detail for weekly_summary than chat_general', () => {
    const summary = optimizeChatContext(context, 'weekly_summary')
    const general = optimizeChatContext(context, 'chat_general')

    expect((summary.historicalSessions ?? []).length).toBeGreaterThanOrEqual((general.historicalSessions ?? []).length)
    expect((summary.weekDayLogs ?? []).length).toBeGreaterThanOrEqual((general.weekDayLogs ?? []).length)
  })

  it('detects broader plan and summary intents from chat phrasing', () => {
    expect(detectChatIntent('Hazme un plan para esta semana')).toBe('plan_week')
    expect(detectChatIntent('Armame el lunes con running suave')).toBe('adjust_session')
    expect(detectChatIntent('cámbiame una de las sesiones de fuerza')).toBe('adjust_session')
    expect(detectChatIntent('pon descanso el lunes')).toBe('adjust_session')
    expect(detectChatIntent('borra el entreno del jueves')).toBe('adjust_session')
    expect(detectChatIntent('Resumeme la semana y dejame un balance corto')).toBe('weekly_summary')
  })

  it('maps weekly summary intent to the matching request class', () => {
    expect(inferRequestClassFromIntent('weekly_summary')).toBe('weekly_summary')
    expect(inferRequestClassFromIntent('plan_week')).toBe('chat_action')
    expect(inferRequestClassFromIntent('general_chat')).toBe('chat_general')
  })
})

describe('contextOptimizer recent message dating', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-18T15:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const baseContext = (): ChatContext => ({
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
  })

  it('drops replayed messages older than 7 calendar days', () => {
    const context: ChatContext = {
      ...baseContext(),
      recentMessages: [
        { role: 'user', content: 'mensaje demasiado viejo', timestamp: new Date('2026-07-09T10:00:00').getTime() },
        { role: 'user', content: 'mensaje de hoy', timestamp: new Date('2026-07-18T10:00:00').getTime() },
      ],
    }

    const result = optimizeChatContext(context, 'chat_action')

    expect((result.recentMessages ?? []).map(message => message.content)).toEqual(['mensaje de hoy'])
  })

  it('prefixes messages from previous days with their date and leaves today unlabeled', () => {
    const context: ChatContext = {
      ...baseContext(),
      recentMessages: [
        { role: 'coach', content: 'hoy miércoles no te recomiendo un partido', timestamp: new Date('2026-07-15T12:42:00').getTime() },
        { role: 'user', content: 'quiero un partido hoy', timestamp: new Date('2026-07-18T12:40:00').getTime() },
      ],
    }

    const result = optimizeChatContext(context, 'chat_action')
    const [wednesday, today] = result.recentMessages ?? []

    expect(wednesday?.content).toBe('[Mié 15 jul] hoy miércoles no te recomiendo un partido')
    expect(today?.content).toBe('quiero un partido hoy')
  })

  it('keeps legacy messages without timestamp intact', () => {
    const context: ChatContext = {
      ...baseContext(),
      recentMessages: [
        { role: 'user', content: 'mensaje sin fecha' },
      ],
    }

    const result = optimizeChatContext(context, 'chat_action')

    expect(result.recentMessages).toEqual([{ role: 'user', content: 'mensaje sin fecha' }])
  })
})
