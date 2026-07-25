import { describe, expect, it } from 'vitest'

import { buildVariantId, type PlanBuilderVariantDescriptor } from '../telemetryVersions'

const BASE: PlanBuilderVariantDescriptor = {
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  effort: 'omitted',
  thinkingMode: 'omitted',
  temperature: 0.25,
  maxTokens: 5000,
  promptVersion: '2026-07-week-v1',
  schemaVersion: '2026-07-week-v1',
  qualityVersion: 1,
  concurrency: 3,
}

describe('buildVariantId', () => {
  it('produces a readable prefix with model short and quality version', () => {
    expect(buildVariantId(BASE)).toMatch(/^s46-q1-[a-z0-9]{8}$/)
  })

  it('is deterministic for the same descriptor', () => {
    expect(buildVariantId(BASE)).toBe(buildVariantId({ ...BASE }))
  })

  it('changes the id when ANY dimension changes', () => {
    const base = buildVariantId(BASE)
    const dims: Array<Partial<PlanBuilderVariantDescriptor>> = [
      { provider: 'openai' },
      { model: 'claude-sonnet-5' },
      { effort: 'high' },
      { thinkingMode: 'extended' },
      { temperature: 0.3 },
      { maxTokens: 12000 },
      { promptVersion: 'x' },
      { schemaVersion: 'x' },
      { qualityVersion: 2 },
      { concurrency: 6 },
    ]
    for (const override of dims) {
      expect(buildVariantId({ ...BASE, ...override }), JSON.stringify(override)).not.toBe(base)
    }
  })

  it('falls back to a safe token when model is null', () => {
    expect(buildVariantId({ ...BASE, model: null })).toMatch(/^unknown-q1-[a-z0-9]{8}$/)
  })
})
