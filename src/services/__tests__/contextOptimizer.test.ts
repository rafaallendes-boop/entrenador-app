import { describe, expect, it } from 'vitest'
import type { ChatContext, Session } from '../../types'
import { optimizeChatContext } from '../ai/contextOptimizer'

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
})
