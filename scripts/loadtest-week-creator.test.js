import { describe, expect, it } from 'vitest'

import {
  SCENARIOS,
  buildScenarioSequence,
  collectVariant,
  defaultReportPath,
  evaluateAcceptance,
  pXX,
  summarizeByScenario,
  summarizeResults,
} from './loadtest-week-creator.mjs'

function result(overrides = {}) {
  return {
    ok: true,
    durationMs: 1_000,
    providerAttempts: [{
      ok: true,
      logicalAttempt: 1,
      provider: 'openai',
      model: 'gpt-test',
      systemPromptChars: 2_600,
      userPromptChars: 5_200,
      responseSchemaChars: 3_400,
      inputChars: 11_200,
      responseChars: 1_200,
      promptTokens: 2_800,
      completionTokens: 700,
      reasoningTokens: 100,
    }],
    logicalAttemptCount: 1,
    retryUsed: false,
    fallbackUsed: false,
    providerFallbackUsed: false,
    ...overrides,
  }
}

describe('week creator loadtest metrics', () => {
  it('uses a conservative p95 that includes the slowest sample in a 20-run baseline', () => {
    const samples = [...Array(19).fill(1_000), 25_000]
    expect(pXX(samples, 0.95)).toBe(25_000)
  })

  it('rejects a fast run when fallback usage exceeds the SLO', () => {
    const results = Array.from({ length: 20 }, () => result())
    results[19] = result({
      durationMs: 8_000,
      logicalAttemptCount: 2,
      retryUsed: true,
      fallbackUsed: true,
      providerAttempts: [
        { ok: true, logicalAttempt: 1, provider: 'openai', model: 'gpt-test', responseChars: 800, roundTripMs: 4_000 },
        { ok: true, logicalAttempt: 2, provider: 'openai', model: 'gpt-test', responseChars: 900, roundTripMs: 4_000 },
      ],
    })

    const summary = summarizeResults(results)
    const acceptance = evaluateAcceptance(summary, {
      successTarget: 0.95,
      p95TargetMs: 10_000,
      fallbackTarget: 0.02,
    })

    expect(summary.successRate).toBe('100.0%')
    expect(summary.p95ms).toBe(8_000)
    expect(summary.successfulP95ms).toBe(8_000)
    expect(summary.logicalRetriesUsed).toBe(1)
    expect(summary.fallbacksUsed).toBe(1)
    expect(summary.fallbackRate).toBe('5.0%')
    expect(summary.modelGenerationRate).toBe('95.0%')
    expect(summary.providerErrorBreakdown).toEqual({})
    expect(acceptance.checks).toEqual({ success: true, latency: true, fallback: false })
    expect(acceptance.passed).toBe(false)
  })

  it('accepts fallback usage exactly at the configured budget', () => {
    const results = Array.from({ length: 50 }, () => result())
    results[49] = result({ durationMs: 8_000, fallbackUsed: true })
    const summary = summarizeResults(results)

    expect(summary.fallbackRateValue).toBe(0.02)
    expect(evaluateAcceptance(summary, {
      successTarget: 0.95,
      p95TargetMs: 10_000,
      fallbackTarget: 0.02,
    }).passed).toBe(true)
  })

  it('does not mix a proxy provider fallback with the local deterministic fallback budget', () => {
    const summary = summarizeResults([result({ providerFallbackUsed: true })])

    expect(summary.providerFallbacksUsed).toBe(1)
    expect(summary.fallbacksUsed).toBe(0)
    expect(summary.fallbackRateValue).toBe(0)
  })

  it('does not mix deterministic fallback size into provider output percentiles', () => {
    const summary = summarizeResults([
      result(),
      result({
        durationMs: 2_000,
        logicalAttemptCount: 2,
        retryUsed: true,
        fallbackUsed: true,
        providerAttempts: [
          { ok: true, logicalAttempt: 1, provider: 'openai', model: 'gpt-test', responseChars: 900 },
          { ok: false, logicalAttempt: 2, errorClass: 'timeout', roundTripMs: 1_000 },
        ],
      }),
    ])

    expect(summary.providerAttemptResponseCharsP95).toBe(1_200)
    expect(summary.providerAttemptCount).toBe(3)
  })

  it('summarizes observed prompt sizes and keeps retry growth visible', () => {
    const summary = summarizeResults([
      result({
        providerAttempts: [
          {
            ok: false,
            logicalAttempt: 1,
            systemPromptChars: 2_600,
            userPromptChars: 5_200,
            responseSchemaChars: 3_400,
            inputChars: 11_200,
          },
          {
            ok: true,
            logicalAttempt: 2,
            systemPromptChars: 2_600,
            userPromptChars: 5_800,
            responseSchemaChars: 3_400,
            inputChars: 11_800,
          },
        ],
      }),
    ])

    expect(summary.providerAttemptInputCharsP50).toBe(11_800)
    expect(summary.providerAttemptInputCharsP95).toBe(11_800)
    expect(summary.promptSizesByLogicalAttempt).toEqual({
      1: { count: 1, inputCharsP50: 11_200, inputCharsP95: 11_200 },
      2: { count: 1, inputCharsP50: 11_800, inputCharsP95: 11_800 },
    })
  })
})

describe('week creator loadtest scenarios', () => {
  it('exposes the four validation cohorts with the fields the runner needs', () => {
    for (const key of ['standard', 'eight-doubles', 'partial-week', 'medical']) {
      const scenario = SCENARIOS[key]
      expect(scenario, `scenario ${key} must exist`).toBeTruthy()
      expect(typeof scenario.label).toBe('string')
      expect(typeof scenario.message).toBe('string')
      expect(typeof scenario.buildContext).toBe('function')
      expect(typeof scenario.buildOptions).toBe('function')
    }
  })

  it('distributes N runs across scenarios by weight, totalling exactly N', () => {
    const weights = { standard: 10, 'eight-doubles': 10, 'partial-week': 5, medical: 5 }
    const sequence = buildScenarioSequence(30, weights)

    expect(sequence).toHaveLength(30)
    const counts = sequence.reduce((acc, key) => {
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
    expect(counts).toEqual({ standard: 10, 'eight-doubles': 10, 'partial-week': 5, medical: 5 })
  })

  it('uses the largest-remainder method so small N still covers every weighted scenario', () => {
    const sequence = buildScenarioSequence(4, {
      standard: 10,
      'eight-doubles': 10,
      'partial-week': 5,
      medical: 5,
    })

    expect(sequence).toHaveLength(4)
    expect(new Set(sequence).size).toBe(4)
  })

  it('runs a single scenario for every sample when only one has weight', () => {
    expect(buildScenarioSequence(3, { medical: 1 })).toEqual(['medical', 'medical', 'medical'])
  })

  it('segments the summary by scenario and keeps an overall roll-up', () => {
    const byScenario = summarizeByScenario([
      result({ scenario: 'standard', durationMs: 5_000 }),
      result({ scenario: 'standard', durationMs: 7_000 }),
      result({ scenario: 'eight-doubles', durationMs: 9_000, fallbackUsed: true }),
    ])

    expect(byScenario.overall.n).toBe(3)
    expect(byScenario.byScenario.standard.n).toBe(2)
    expect(byScenario.byScenario.standard.p95ms).toBe(7_000)
    expect(byScenario.byScenario['eight-doubles'].n).toBe(1)
    expect(byScenario.byScenario['eight-doubles'].fallbacksUsed).toBe(1)
  })

  it('writes reports under a gitignored dir with a timestamped json name', () => {
    const path = defaultReportPath(new Date('2026-07-20T18:30:05.000Z'))

    expect(path).toMatch(/^loadtest-results\/week-creator-.*\.json$/)
    expect(path).toContain('2026-07-20')
  })

  it('collects the variant tags so a paid window self-documents its model and tier', () => {
    const variant = collectVariant([
      result({ providerAttempts: [{ ok: true, model: 'gpt-4.1-mini', serviceTier: 'priority' }] }),
      result({ providerAttempts: [{ ok: true, model: 'gpt-4.1-mini', serviceTier: 'priority', reasoningEffort: 'low' }] }),
    ])

    expect(variant.models).toEqual(['gpt-4.1-mini'])
    expect(variant.serviceTiers).toEqual(['priority'])
    expect(variant.reasoningEfforts).toEqual(['low'])
  })

  it('surfaces every distinct tier so a Priority to Standard degradation stays visible', () => {
    const variant = collectVariant([
      result({ providerAttempts: [{ ok: true, model: 'gpt-4.1-mini', serviceTier: 'priority' }] }),
      result({ providerAttempts: [{ ok: true, model: 'gpt-4.1-mini', serviceTier: 'default' }] }),
    ])

    expect(variant.serviceTiers).toEqual(['default', 'priority'])
  })
})
