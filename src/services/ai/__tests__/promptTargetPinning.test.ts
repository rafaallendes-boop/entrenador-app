import { describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../../types'
import type { AIProvider } from '../types'

const mocks = vi.hoisted(() => ({ text: '' }))
const provider: AIProvider = { name: 'mock', call: async (r) => ({ text: mocks.text, provider: 'mock', requestClass: r.requestClass, traceId: r.traceId }) }
vi.mock('../providerResolver', () => ({ getProviderForRequestClass: () => provider, getActiveProvider: () => provider, isRealProviderConfigured: () => false }))
vi.mock('../aiTelemetry', () => ({ assertDailyAIRequestLimit: vi.fn(async () => undefined), recordCoachFeedback: vi.fn(), upsertAIRequestLog: vi.fn(async () => undefined) }))
vi.mock('../../athlete/activeAthlete', () => ({ getActiveAthleteId: () => 'ath_a', getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => 0, ATHLETE_PROFILE_LOCAL_ID: 'default' }))

import { CoachEngine } from '../CoachEngine'
import { optimizeChatContext } from '../contextOptimizer'
import { buildCoachPrompt } from '../promptBuilder'
import type { MessageTarget, MessageTargetResolution } from '../../chat/messageTargets'

function planned(index: number, extra: Partial<Session> = {}): Session {
  const day = String(index + 1).padStart(2, '0')
  return { id: `${String(index).padStart(2, '0')}b4pin0-0000-4000-8000-${String(index).padStart(12, '0')}`, date: `2099-10-${day}`, weekStartDate: `2099-10-${day}`,
    timeBlock: 'AM', type: 'recovery', status: 'planned', title: `Recuperación ${index}`, durationMin: 30, createdAt: 0, updatedAt: 0, ...extra } as Session
}
const target = (s: Session): MessageTarget => ({ sessionId: s.id, date: s.date, timeBlock: s.timeBlock, reason: 'explicit_date' })
const resolvedOf = (targets: Session[], overflow: Session[] = []): MessageTargetResolution =>
  ({ kind: 'resolved', targets: targets.map(target), overflow: overflow.map(target), dates: [] })
const domainOf = (sessions: Session[]): ChatContext => ({ recentSessions: sessions, plannedSessions: sessions, historicalSessions: [] })
const sessions = Array.from({ length: 14 }, (_, i) => planned(i))
const count = (text: string, needle: string) => text.split(needle).length - 1

describe('I15 — el detalle respeta el presupuesto', () => {
  it('un objetivo fuera de las primeras seis entra con detalle y el total sigue en 6', () => {
    const projection = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf([sessions[12]]))
    expect(projection.plannedSessions).toHaveLength(6)
    expect(projection.plannedSessions?.map((s) => s.id)).toContain(sessions[12].id)
    const prompt = buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt
    expect(prompt).toContain('SESIONES QUE NOMBRA EL MENSAJE')
    expect(prompt).not.toContain('sin detalle en este mensaje')
  })

  it('doce objetivos: seis con detalle (tope de líneas), doce en el índice', () => {
    const targets = sessions.slice(2, 14)
    const projection = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf(targets))
    expect(projection.plannedSessions).toHaveLength(6)
    expect(projection.plannedSessions?.every((s) => targets.some((t) => t.id === s.id))).toBe(true)
    expect(projection.targetIndex).toHaveLength(12)
    expect(count(buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt, 'sin detalle en este mensaje')).toBe(6)
  })

  it('el tope de caracteres también manda sobre los objetivos', () => {
    const heavy = [0, 1, 2].map((i) => planned(i, { objective: 'x'.repeat(900) }))
    const projection = optimizeChatContext(domainOf(heavy), 'chat_action', resolvedOf(heavy))
    expect(projection.plannedSessions?.map((s) => s.id)).toEqual([heavy[0].id])
    expect(projection.targetIndex).toHaveLength(3)
  })

  it('ni la primera sesión puede superar sola el presupuesto', () => {
    const huge = planned(0, { objective: 'x'.repeat(10000) })
    const small = planned(1)
    const projection = optimizeChatContext(domainOf([huge, small]), 'chat_action', resolvedOf([huge]))
    expect(projection.plannedSessions?.map((session) => session.id)).toEqual([small.id])
    expect(projection.targetIndex?.map((ref) => ref.id)).toEqual([huge.id])
    expect(buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt).toContain('sin detalle en este mensaje')
  })

  it('los vecinos del mismo día van después de los objetivos', () => {
    const neighbor = planned(12, { id: 'neighbor-same-day', timeBlock: 'PM' })
    const projection = optimizeChatContext(domainOf([...sessions, neighbor]), 'chat_action', resolvedOf([sessions[12]]))
    const ids = projection.plannedSessions?.map((s) => s.id) ?? []
    expect(ids).toContain(sessions[12].id)
    expect(ids).toContain('neighbor-same-day')
    expect(ids).toHaveLength(6)
  })

  it('el exceso queda fuera del índice y se declara', () => {
    const projection = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf(sessions.slice(0, 12), sessions.slice(12)))
    expect(projection.targetIndex).toHaveLength(12)
    expect(projection.overflowTargets?.map((ref) => ref.id)).toEqual([sessions[12].id, sessions[13].id])
    expect(buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt).toContain('Quedaron fuera por límite 2')
  })

  it('el engine descarta acciones sobre sesiones excedentes', async () => {
    const promptContext = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf(sessions.slice(0, 12), sessions.slice(12)))
    mocks.text = `Listo.\n<actions>[
      {"type":"update_session","sessionId":"${sessions[0].id.slice(0, 8)}","newTitle":"A","reason":"r"},
      {"type":"update_session","sessionId":"${sessions[13].id.slice(0, 8)}","newTitle":"B","reason":"r"}
    ]</actions>`
    const response = await CoachEngine.sendAction('ajusta estas sesiones', domainOf(sessions), { promptContext })
    expect(response.actions?.map((a) => a.newTitle)).toEqual(['A'])
    expect(response.meta?.warnings).toContain('chat_action_target_overflow_dropped')
  })
})
