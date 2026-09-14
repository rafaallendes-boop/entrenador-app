/**
 * Casos del probe docs/reviews/fixtures/coaching-refactor-2026-09-08/probe.mjs,
 * con las expectativas CORREGIDAS por las Fases A y B. El script y sus
 * salidas se conservan como evidencia histórica; este archivo es el contrato
 * vigente.
 */
import { describe, expect, it } from 'vitest'
import { hydrateSquashSession } from '../training/squashSessionHydrator'
import { materializeRunningTemplate } from '../training/runningTemplateMaterializer'
import { resolveChatRoute } from '../chatRouting'
import { detectChatIntent, inferRequestClassFromIntent, optimizeChatContext } from '../ai/contextOptimizer'
import { CHAT_ROUTING_CORPUS } from '../chatRoutingCorpus'
import { buildCoachPrompt } from '../ai/promptBuilder'
import { resolveMessageTargets } from '../chat/messageTargets'

describe('probes 2026-09-08 → Fases A y B', () => {
  it.each(['technical', 'control'] as const)('F03: %s a 15 min conserva el bloque principal', (kind) => {
    const result = hydrateSquashSession({ kind, durationMin: 15, phase: 'base', fatigueLevel: 3, goal: '', recentDrills: [],
      competitionSoon: false, withShadowsAccessory: true, partnerAvailability: 'either' })
    expect(result.details.blocks?.map(block => block.kind)).toContain(kind)
  })

  it('F05: progress y hold son intenciones distintas y ambas siguen siendo correctas', () => {
    const count = (intent?: 'progress' | 'hold') => {
      const result = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: { fiveKTime: '25:00' }, intent })
      if (!result.ok) throw new Error(result.message)
      return result.structure.blocks.filter(block => block.distanceKm === 0.4).reduce((n, block) => n + (block.repetitions ?? 1), 0)
    }
    expect(count('progress')).toBe(11)
    expect(count('hold')).toBe(9)
    expect(count(undefined)).toBe(9)
    // La conservación al editar el título está en SessionFormRunningTemplates.test.tsx.
  })

  it('F07: las cinco frases del probe coinciden en UI y engine con el corpus', () => {
    const probeIds = ['hist-1', 'hist-2', 'create-1', 'advice-1', 'plan-1']
    for (const id of probeIds) {
      const testCase = CHAT_ROUTING_CORPUS.find(candidate => candidate.id === id)!
      expect(resolveChatRoute(testCase.message).kind, id).toBe(testCase.expected)
      const uiClass = inferRequestClassFromIntent(detectChatIntent(testCase.message))
      const expectedUi = testCase.expected === 'chat_action' ? 'chat_action' : testCase.expected === 'week_creator' ? 'week_creator' : 'chat_general'
      expect(uiClass, id).toBe(expectedUi)
    }
  })

  it('F06: el objetivo fuera de las primeras seis sesiones se fija sin ampliar el presupuesto', () => {
    const sessions = Array.from({ length: 14 }, (_, i) => ({
      id: `${String(i).padStart(2, '0')}f06prb-0000-4000-8000-${String(i).padStart(12, '0')}`, date: `2099-10-${String(i + 1).padStart(2, '0')}`,
      weekStartDate: '2099-09-28', timeBlock: 'AM' as const, type: 'squash' as const, status: 'planned' as const, title: `Sesión ${i}`, durationMin: 60, createdAt: 0, updatedAt: 0,
    }))
    const target = sessions[12]
    const projection = optimizeChatContext({ recentSessions: sessions, plannedSessions: sessions, historicalSessions: [] }, 'chat_action',
      { kind: 'resolved', targets: [{ sessionId: target.id, date: target.date, timeBlock: 'AM', reason: 'explicit_date' }], overflow: [], dates: [target.date] })
    expect(projection.plannedSessions).toHaveLength(6)
    expect(projection.plannedSessions?.some((s) => s.id === target.id)).toBe(true)
    expect(projection.sourceCapture?.sessions).toHaveLength(14)
  })

  it('F10: el prompt de chat general incluye los hechos de la sesión consultada', () => {
    const yesterday = { id: 'f10', date: '2020-01-01', weekStartDate: '2019-12-30', timeBlock: 'PM' as const, type: 'squash' as const, status: 'completed' as const,
      title: 'Partido probe F10', durationMin: 60, rpe: 7, actualRpe: 8, createdAt: 0, updatedAt: 0 }
    const context = { recentSessions: [yesterday], plannedSessions: [], historicalSessions: [yesterday] }
    const projection = optimizeChatContext(context, 'chat_general',
      { kind: 'resolved', targets: [{ sessionId: 'f10', date: '2020-01-01', timeBlock: 'PM', reason: 'explicit_date' }], overflow: [], dates: ['2020-01-01'] })
    const prompt = buildCoachPrompt(projection, { requestClass: 'chat_general', userMessage: '¿cómo me fue?' }).systemPrompt
    expect(prompt).toContain('Partido probe F10')
    expect(prompt).toContain('RPE8 real')
  })

  it('B4: "la sesión del jueves" con dos candidatas aclara en vez de tomar ambas', () => {
    const now = new Date(2026, 8, 16, 10).getTime()
    const thu = (id: string, timeBlock: 'AM' | 'PM') => ({ id, date: '2026-09-17', weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const,
      title: `Jueves ${timeBlock}`, durationMin: 60, createdAt: 0, updatedAt: 0 })
    const two = { recentSessions: [thu('a', 'AM'), thu('b', 'PM')], plannedSessions: [], historicalSessions: [] }
    const scope = { athleteId: null, conversationId: 'c' }
    expect(resolveMessageTargets({ message: 'mueve la sesión del jueves al viernes', context: two, pendingIntent: null, scope, recentMessages: [], now }).kind).toBe('clarify')
  })
})
