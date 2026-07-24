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
