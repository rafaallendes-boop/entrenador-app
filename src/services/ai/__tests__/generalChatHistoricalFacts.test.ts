import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../../types'
import { resolveMessageTargets } from '../../chat/messageTargets'
import { optimizeChatContext } from '../contextOptimizer'
import { buildCoachPrompt } from '../promptBuilder'

function done(id: string, date: string, title: string, extra: Partial<Session> = {}): Session {
  return { id, date, weekStartDate: date, timeBlock: 'PM', type: 'squash', status: 'completed', title, durationMin: 60, createdAt: 0, updatedAt: 0, ...extra } as Session
}

function promptFor(message: string, context: ChatContext): string {
  const now = Date.now()
  const targets = resolveMessageTargets({ message, context, pendingIntent: null, scope: { athleteId: null, conversationId: 'c' }, recentMessages: [], now })
  return buildCoachPrompt(optimizeChatContext(context, 'chat_general', targets), { requestClass: 'chat_general', userMessage: message }).systemPrompt
}

describe('F10 — chat general responde con hechos', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 16, 10, 0)) })
  afterEach(() => { vi.useRealTimers() })

  it('"¿Cómo me fue ayer?" incluye título, RPE real y feedback de ayer', () => {
    const yesterday = done('y', '2026-09-15', 'Partido contra Diego Q7', {
      rpe: 7, actualRpe: 9, sessionFeedback: { rating: 2, energyDuringSession: 2, mainChallenge: 'me costó volver a la T' } as Session['sessionFeedback'],
    })
    const older = Array.from({ length: 10 }, (_, i) => done(`o${i}`, `2026-09-0${(i % 9) + 1}`, `Squash viejo ${i}`))
    const history = [...older, yesterday]
    const prompt = promptFor('¿Cómo me fue ayer?', { recentSessions: history, plannedSessions: [], historicalSessions: history })
    expect(prompt).toContain('SESIONES CONSULTADAS')
    expect(prompt).toContain('Partido contra Diego Q7')
    expect(prompt).toContain('RPE9 real')
    expect(prompt).toContain('volver a la T')
  })

  it('lo que no cupo en el detalle se nombra sin inventar hechos (I15)', () => {
    // Siete sesiones ayer; chat general admite 4 líneas de historial con detalle.
    const yesterdayMany = Array.from({ length: 7 }, (_, i) => done(`y${i}`, '2026-09-15', `Bloque de ayer ${i}`, { rpe: 6, actualRpe: 7 }))
    const prompt = promptFor('¿Cómo me fue ayer?', { recentSessions: yesterdayMany, plannedSessions: [], historicalSessions: yesterdayMany })
    expect(prompt).toContain('SESIONES CONSULTADAS')
    expect(prompt).toContain('sin detalle en este mensaje por límite')
  })

  it('una fecha sin sesiones se dice, no se inventa', () => {
    const prompt = promptFor('¿Cómo me fue anteayer?', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(prompt).toContain('No hay sesiones registradas')
  })

  it('no declara vacías las fechas que quedaron en overflow', () => {
    const history = Array.from({ length: 14 }, (_, i) => done(`overflow-${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, `Sesión histórica ${i}`))
    const targets = history.map((session) => ({ sessionId: session.id, date: session.date, timeBlock: session.timeBlock, reason: 'explicit_date' as const }))
    const projection = optimizeChatContext({ recentSessions: history, plannedSessions: [], historicalSessions: history }, 'chat_general', {
      kind: 'resolved', targets: targets.slice(0, 12), overflow: targets.slice(12), dates: history.map((session) => session.date),
    })
    const prompt = buildCoachPrompt(projection, { requestClass: 'chat_general', userMessage: '¿Cómo me fue en esas sesiones?' }).systemPrompt
    expect(prompt).not.toContain('No hay sesiones registradas')
    expect(projection.overflowTargets).toHaveLength(2)
  })

  it('una restricción estructurada sobrevive a una memoria larga', () => {
    const prompt = promptFor('hola', {
      recentSessions: [], plannedSessions: [], historicalSessions: [],
      athleteMemory: `${'nota larga '.repeat(90)} y al final: no saltar`,
      athleteProfile: { id: 'a', updatedAt: 0, recoveryProfile: { restrictions: 'sin impacto en rodilla' } },
    })
    expect(prompt).toContain('sin impacto en rodilla')
  })

  it('muestra RPE real aunque no haya RPE planificado (I15)', () => {
    const yesterday = done('rpe-real', '2026-09-15', 'Trote suave ayer sin plan', { actualRpe: 9 })
    const prompt = promptFor('¿Cómo me fue ayer?', { recentSessions: [yesterday], plannedSessions: [], historicalSessions: [yesterday] })
    expect(prompt).toContain('RPE9 real')
  })

  it('no inventa RPE cuando no hay actualRpe ni rpe', () => {
    const yesterday = done('sin-rpe', '2026-09-15', 'Trote suave ayer sin datos')
    const prompt = promptFor('¿Cómo me fue ayer?', { recentSessions: [yesterday], plannedSessions: [], historicalSessions: [yesterday] })
    const line = prompt.split('\n').find((entry) => entry.includes('Trote suave ayer sin datos'))
    expect(line).toBeDefined()
    expect(line).not.toContain('RPE')
  })
})
