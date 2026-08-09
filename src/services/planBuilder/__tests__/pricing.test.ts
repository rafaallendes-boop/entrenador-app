import { describe, expect, it } from 'vitest'

import { estimateCostUsd } from '../pricing'

const AUG_2026 = Date.UTC(2026, 7, 15)

describe('estimateCostUsd', () => {
  it('prices a sonnet-4-6 run from input/output/cache tokens', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6', at: AUG_2026,
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000,
    })
    // 3 + 15 + 0.3 + 3.75 = 22.05
    expect(cost).toBeCloseTo(22.05, 6)
  })

  it('scales linearly with token counts', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6', at: AUG_2026,
      inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 0, cacheCreationTokens: 0,
    })
    expect(cost).toBeCloseTo(0.06, 6)
  })

  it('returns null for a model with no dated price entry', () => {
    expect(estimateCostUsd({
      model: 'model-inexistente', at: AUG_2026,
      inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0,
    })).toBeNull()
  })

  it('returns null when no price window covers the timestamp', () => {
    expect(estimateCostUsd({
      model: 'claude-sonnet-4-6', at: Date.UTC(2020, 0, 1),
      inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0,
    })).toBeNull()
  })
})

describe('estimateCostUsd — proveedores reales de producción', () => {
  const AT = Date.parse('2026-08-09T12:00:00Z')

  function cost(model: string, serviceTier?: string) {
    return estimateCostUsd({
      model, at: AT, serviceTier,
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      cacheReadTokens: 0, cacheCreationTokens: 0,
    })
  }

  it('tarifa el chat, que corre en Gemini y no en Claude', () => {
    // chat_general y chat_action son la ruta de mayor volumen del producto.
    expect(cost('gemini-2.5-flash')).toBeCloseTo(0.3 + 2.5, 6)
  })

  it('cobra el tier priority más caro que el estándar para el MISMO modelo', () => {
    const standard = cost('gpt-4.1-mini')!
    const priority = cost('gpt-4.1-mini', 'priority')!
    // Es el bug que el tier arregla: producción corre `priority` en week_creator,
    // y sin distinguirlo se tarifaba al estándar.
    expect(priority).toBeGreaterThan(standard)
    expect(priority / standard).toBeCloseTo((0.7 + 2.8) / (0.4 + 1.6), 6)
  })

  it('devuelve null ante un tier sin precio, en vez de caer al estándar', () => {
    // Un match laxo daría un número plausible y equivocado. `null` ya significa
    // «precio no disponible» y toda agregación lo excluye.
    expect(cost('gpt-4.1-mini', 'scale')).toBeNull()
    expect(cost('gemini-2.5-flash', 'priority')).toBeNull()
  })

  it('sigue tarifando Claude, que no usa tiers', () => {
    expect(cost('claude-sonnet-4-6')).toBeCloseTo(3 + 15, 6)
  })
})
