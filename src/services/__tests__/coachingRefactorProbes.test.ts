/**
 * Casos del probe docs/reviews/fixtures/coaching-refactor-2026-09-08/probe.mjs,
 * con las expectativas CORREGIDAS por la Fase A. El script y sus salidas se
 * conservan como evidencia histórica; este archivo es el contrato vigente.
 *
 * F06 (recorte a seis sesiones) NO se fija acá: cambia en B4.
 */
import { describe, expect, it } from 'vitest'
import { hydrateSquashSession } from '../training/squashSessionHydrator'
import { materializeRunningTemplate } from '../training/runningTemplateMaterializer'
import { resolveChatRoute } from '../chatRouting'
import { detectChatIntent, inferRequestClassFromIntent } from '../ai/contextOptimizer'
import { CHAT_ROUTING_CORPUS } from '../chatRoutingCorpus'

describe('probes 2026-09-08 → Fase A', () => {
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
})
