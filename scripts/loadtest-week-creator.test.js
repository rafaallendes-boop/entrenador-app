import { describe, expect, it } from 'vitest'

import { evaluateAcceptance, pXX, summarizeResults } from './loadtest-week-creator.mjs'

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
