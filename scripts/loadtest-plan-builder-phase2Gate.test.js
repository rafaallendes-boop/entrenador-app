import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_SCHEMA_VERSION,
  buildArtifact,
  evaluateAcceptance,
} from './loadtest-plan-builder/artifact.mjs'
import { buildManifest } from './loadtest-plan-builder/manifest.mjs'
import {
  PHASE2_EXPECTED,
  PHASE2_THRESHOLDS,
  evaluatePhase2ComparisonEligibility,
  evaluatePhase2Decision,
  evaluatePhase2Variant,
  renderPhase2Eligibility,
} from './loadtest-plan-builder/phase2Gate.mjs'

function completePlan(manifestCase, over = {}) {
  const weeks = Array.from({ length: manifestCase.weekCount }, (_, weekIndex) => ({
    weekIndex,
    scenarioKey: manifestCase.scenarioKey,
    status: 'draft',
    scorable: true,
    sessionCount: 4,
    repairTaxonomyVersion: 2,
    qualityVersion: 2,
    countRepairsV2: 0,
    correctiveActionCount: 0,
    structuralActionCount: 0,
  }))
  return {
    caseId: manifestCase.caseId,
    scenarioKey: manifestCase.scenarioKey,
    weekCount: manifestCase.weekCount,
    outcome: 'succeeded',
    weekCountSucceeded: manifestCase.weekCount,
    weekCountFailed: 0,
    firstWeekReadyMs: 1_000,
    firstWeekReadyE2eMs: 1_200,
    planCompleteMs: 2_000,
    planScore: 90,
    estimatedCostUsd: 0.05,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    retryCount: 0,
    observedModels: ['claude-sonnet-4-6'],
    fallbackUsed: false,
    qualityVersion: 2,
    errorClass: null,
    weeks,
    ...over,
  }
}

function phase2Artifact({
  effort = 'high',
  thinkingMode = 'disabled',
  qualityVersion = 2,
  gitSha = 'phase2-sha',
  gitDirty = false,
  mutatePlans,
} = {}) {
  const plans = buildManifest().map((manifestCase) => completePlan(manifestCase))
  mutatePlans?.(plans)
  return buildArtifact({
    plans,
    variant: {
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      effort,
      thinkingMode,
      temperature: 0.25,
      maxTokens: 5000,
      promptVersion: '2026-07-week-v1',
      schemaVersion: '2026-07-week-v1',
      qualityVersion,
      concurrency: 3,
      variantId: `phase2-${effort}`,
    },
    git: { sha: gitSha, dirty: gitDirty },
  })
}

function passingComparison(over = {}) {
  const {
    firstWeekReady: firstWeekReadyOver,
    planComplete: planCompleteOver,
    score: scoreOver,
    repairs: repairsOver,
    ...topLevelOver
  } = over
  return {
    planPairs: 12,
    completePairs: 12,
    weekPairs: 42,
    scorableWeekPairs: 42,
    onlyControl: [],
    onlyVariant: [],
    duplicateControlCaseIds: [],
    duplicateVariantCaseIds: [],
    unmatchedWeeks: [],
    duplicateWeeks: [],
    firstWeekReady: {
      n: 12,
      p50: 0.7,
      improvedCases: 12,
      totalCases: 12,
      improvedScenarios: 6,
      totalScenarios: 6,
      byScenario: Object.fromEntries(
        ['s1', 's2', 's3', 's4', 's5', 's6'].map((key) => [
          key,
          { n: 2, meanRatio: 0.7, improved: true },
        ]),
      ),
      ...(firstWeekReadyOver ?? {}),
    },
    planComplete: { n: 12, p50: 1, ...(planCompleteOver ?? {}) },
    score: { n: 12, p50: 0, min: 0, ...(scoreOver ?? {}) },
    repairs: {
      weekCountRepairsV2: { n: 42, p50: 0, p90: 0 },
      weekWarningInput: { n: 42, p50: 0, p90: 0 },
      planCountRepairsV2: { n: 12, p50: 0, p90: 0 },
      ...(repairsOver ?? {}),
    },
    ...topLevelOver,
  }
}

function checkById(result, id) {
  return result.checks.find((entry) => entry.id === id)
}

describe('evaluatePhase2Variant', () => {
  it('accepts a strict q2 Sonnet 4.6 artifact from a clean tree', () => {
    expect(evaluatePhase2Variant(phase2Artifact())).toEqual({
      eligible: true,
      reasons: [],
    })
  })

  it('rejects ten complete plans even when structural acceptance allows them', () => {
    const artifact = phase2Artifact({
      mutatePlans: (plans) => {
        for (const index of [0, 2]) {
          plans[index] = {
            ...plans[index],
            outcome: 'failed',
            weekCountSucceeded: 0,
            weekCountFailed: plans[index].weekCount,
            weeks: plans[index].weeks.map((week) => ({
              ...week,
              status: 'error',
              sessionCount: 0,
            })),
          }
        }
      },
    })

    expect(evaluateAcceptance(artifact).accepted).toBe(true)
    const result = evaluatePhase2Variant(artifact)
    expect(result.eligible).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/planes completos 10/)
  })

  it('rejects fallbacks, wrong observed models, dirty or incomplete git state', () => {
    const fallback = phase2Artifact({
      mutatePlans: (plans) => {
        plans[0].fallbackUsed = true
        plans[1].observedModels = ['claude-sonnet-5']
      },
    })
    expect(evaluatePhase2Variant(fallback).reasons.join(' ')).toMatch(/fallback/)
    expect(evaluatePhase2Variant(fallback).reasons.join(' ')).toMatch(/modelo/)
    expect(evaluatePhase2Variant(phase2Artifact({ gitDirty: true })).eligible).toBe(false)

    const missingGit = phase2Artifact()
    missingGit.git = { sha: null, dirty: null }
    expect(evaluatePhase2Variant(missingGit).eligible).toBe(false)
  })

  it('rejects the wrong artifact schema, quality version, thinking or effort', () => {
    const wrongSchema = phase2Artifact()
    wrongSchema.artifactSchemaVersion = ARTIFACT_SCHEMA_VERSION + 1
    expect(evaluatePhase2Variant(wrongSchema).eligible).toBe(false)
    expect(evaluatePhase2Variant(phase2Artifact({ qualityVersion: 1 })).eligible).toBe(false)
    expect(evaluatePhase2Variant(phase2Artifact({ thinkingMode: 'omitted' })).eligible).toBe(false)
    expect(evaluatePhase2Variant(
      phase2Artifact({ effort: 'low' }),
      { ...PHASE2_EXPECTED, efforts: ['medium'] },
    ).eligible).toBe(false)
  })

  it('renders a standalone strict eligibility result for campaign preflight', () => {
    const artifact = phase2Artifact({ effort: 'high' })
    const result = evaluatePhase2Variant(artifact, {
      ...PHASE2_EXPECTED,
      efforts: ['high'],
    })
    const text = renderPhase2Eligibility(artifact, result, 'high')

    expect(text).toMatch(/ELEGIBLE/)
    expect(text).toMatch(/phase2-high/)
    expect(text).toMatch(/effort esperado: high/)
  })

  it('rejects a malformed JSON artifact without crashing the pure check', () => {
    expect(() => evaluatePhase2Variant({ plans: [{}] })).not.toThrow()
    expect(evaluatePhase2Variant({ plans: [{}] }).eligible).toBe(false)
  })
})

describe('evaluatePhase2ComparisonEligibility', () => {
  it('accepts C high versus a medium variant on the same manifest and SHA', () => {
    const result = evaluatePhase2ComparisonEligibility(
      phase2Artifact({ effort: 'high' }),
      phase2Artifact({ effort: 'medium' }),
      passingComparison(),
    )
    expect(result).toEqual({ eligible: true, reasons: [] })
  })

  it('rejects a non-eligible control, a different SHA or a shared dimension drift', () => {
    const dirtyControl = phase2Artifact({ gitDirty: true })
    expect(evaluatePhase2ComparisonEligibility(
      dirtyControl,
      phase2Artifact({ effort: 'medium' }),
      passingComparison(),
    ).reasons.join(' ')).toMatch(/control/)

    expect(evaluatePhase2ComparisonEligibility(
      phase2Artifact(),
      phase2Artifact({ effort: 'medium', gitSha: 'other-sha' }),
      passingComparison(),
    ).reasons.join(' ')).toMatch(/SHA/)

    const changed = phase2Artifact({ effort: 'medium' })
    changed.variant.concurrency = 4
    expect(evaluatePhase2ComparisonEligibility(
      phase2Artifact(),
      changed,
      passingComparison(),
    ).reasons.join(' ')).toMatch(/concurrency/)
  })

  it('rejects missing pairs, duplicate identifiers and different manifests', () => {
    const malformed = passingComparison({
      onlyVariant: ['extra'],
      duplicateControlCaseIds: ['duplicate'],
      unmatchedWeeks: [{ caseId: 'c1', weekIndex: 0, side: 'control' }],
    })
    expect(evaluatePhase2ComparisonEligibility(
      phase2Artifact(),
      phase2Artifact({ effort: 'low' }),
      malformed,
    ).eligible).toBe(false)

    const differentManifest = phase2Artifact({ effort: 'low' })
    differentManifest.manifest.cases[0].weekCount += 1
    expect(evaluatePhase2ComparisonEligibility(
      phase2Artifact(),
      differentManifest,
      passingComparison(),
    ).reasons.join(' ')).toMatch(/manifest/)
  })
})

describe('evaluatePhase2Decision', () => {
  it('accepts every exact boundary frozen by the spec', () => {
    const comparison = passingComparison({
      firstWeekReady: {
        p50: PHASE2_THRESHOLDS.firstWeekRatioP50Max,
        improvedCases: PHASE2_THRESHOLDS.minImprovedCases,
        improvedScenarios: PHASE2_THRESHOLDS.minImprovedScenarios,
      },
      planComplete: { p50: PHASE2_THRESHOLDS.planCompleteRatioP50Max },
      score: {
        p50: PHASE2_THRESHOLDS.scoreDeltaP50Min,
        min: PHASE2_THRESHOLDS.scoreDeltaMin,
      },
    })
    expect(evaluatePhase2Decision(comparison).accepted).toBe(true)
  })

  it('rejects just beyond each latency and score boundary', () => {
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { p50: 0.801 },
    })).accepted).toBe(false)
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { improvedCases: 9 },
    })).accepted).toBe(false)
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { improvedScenarios: 4 },
    })).accepted).toBe(false)
    expect(evaluatePhase2Decision(passingComparison({
      planComplete: { p50: 1.11 },
    })).accepted).toBe(false)
    expect(evaluatePhase2Decision(passingComparison({
      score: { min: -6 },
    })).accepted).toBe(false)
  })

  it('rejects an empty or undersized comparison instead of letting null pass', () => {
    const empty = passingComparison({
      firstWeekReady: { n: 0, p50: null, improvedCases: 0, totalCases: 0 },
      planComplete: { n: 0, p50: null },
      score: { n: 0, p50: null, min: null },
      repairs: {
        weekCountRepairsV2: { n: 0, p50: null, p90: null },
        weekWarningInput: { n: 0, p50: null, p90: null },
        planCountRepairsV2: { n: 0, p50: null, p90: null },
      },
    })
    const result = evaluatePhase2Decision(empty)
    expect(result.accepted).toBe(false)
    expect(checkById(result, 'weekCountRepairsV2.p50').passed).toBe(false)

    expect(evaluatePhase2Decision(passingComparison({
      score: { n: 11 },
    })).accepted).toBe(false)

    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: {
        byScenario: {
          s1: { n: 1 },
          s2: { n: 2 },
          s3: { n: 2 },
          s4: { n: 2 },
          s5: { n: 2 },
          s6: { n: 2 },
        },
      },
    })).accepted).toBe(false)
  })
})
