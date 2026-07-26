import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { QUALITY_V2_CALIBRATION, QUALITY_V2_CONTROL } from '../qualityCalibrationV2'
import { PRODUCTIVE_QUALITY_VERSION } from '../qualityReview'
import { buildRequestFingerprint, buildVariantId } from '../telemetryVersions'

interface ControlArtifact {
  artifactSchemaVersion: number
  variant: Parameters<typeof buildVariantId>[0]
  manifest: {
    cases: { caseId: string, scenarioKey: string }[]
  }
  plans: {
    caseId: string
    outcome: string
    weeks: { scorable: boolean }[]
  }[]
  git: { dirty: boolean, sha: string }
}

function readControl() {
  const path = resolve(process.cwd(), QUALITY_V2_CONTROL.artifactPath)
  const raw = readFileSync(path, 'utf8')
  return { raw, artifact: JSON.parse(raw) as ControlArtifact }
}

describe('quality v2 calibration provenance', () => {
  it('freezes the three contracts the owner chose', () => {
    expect(QUALITY_V2_CALIBRATION).toEqual({
      weekRepairDivisor: 1,
      weekRepairPenaltyCap: 10,
      planRepairDivisor: 4,
      planRepairPenaltyCap: 8,
      highRepairWarningThreshold: 5,
    })
  })

  it('cites an artifact that exists with the exact recorded hash', () => {
    const { raw } = readControl()
    expect(createHash('sha256').update(raw).digest('hex')).toBe(
      QUALITY_V2_CONTROL.artifactSha256,
    )
  })

  it('matches the control descriptor: fingerprint, variant id and counts', () => {
    const { artifact } = readControl()
    expect(artifact.artifactSchemaVersion).toBe(QUALITY_V2_CONTROL.artifactSchemaVersion)
    expect(buildVariantId(artifact.variant)).toBe(
      QUALITY_V2_CONTROL.controlGenerationVariantId,
    )
    expect(buildRequestFingerprint(artifact.variant)).toBe(
      QUALITY_V2_CONTROL.controlRequestFingerprint,
    )

    const complete = artifact.plans.filter((plan) => plan.outcome === 'succeeded')
    expect(complete).toHaveLength(QUALITY_V2_CONTROL.completePlans)
    expect(
      complete.reduce(
        (sum, plan) => sum + plan.weeks.filter((week) => week.scorable).length,
        0,
      ),
    ).toBe(QUALITY_V2_CONTROL.scorableWeeks)
  })

  it('derives complete scenario coverage from the embedded manifest', () => {
    const { artifact } = readControl()
    const expectedByScenario = new Map<string, string[]>()
    for (const item of artifact.manifest.cases) {
      const cases = expectedByScenario.get(item.scenarioKey) ?? []
      cases.push(item.caseId)
      expectedByScenario.set(item.scenarioKey, cases)
    }

    expect(expectedByScenario.size).toBe(6)
    for (const caseIds of expectedByScenario.values()) expect(caseIds).toHaveLength(2)

    const completedCaseIds = new Set(
      artifact.plans
        .filter((plan) => plan.outcome === 'succeeded')
        .map((plan) => plan.caseId),
    )
    for (const item of artifact.manifest.cases) {
      expect(completedCaseIds.has(item.caseId), item.caseId).toBe(true)
    }
  })

  it('refuses a control produced from a dirty tree', () => {
    const { artifact } = readControl()
    expect(artifact.git.dirty).toBe(false)
    expect(QUALITY_V2_CONTROL.gitDirty).toBe(false)
    expect(artifact.git.sha).toBe(QUALITY_V2_CONTROL.gitSha)
  })

  it('does not let v2 go productive without a calibration record', () => {
    if (PRODUCTIVE_QUALITY_VERSION === 2) {
      expect(QUALITY_V2_CONTROL.artifactPath.length).toBeGreaterThan(0)
      expect(QUALITY_V2_CONTROL.artifactSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(QUALITY_V2_CONTROL.completePlans).toBeGreaterThanOrEqual(10)
    }
  })
})
