import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toWeekRow } from '../../../../scripts/loadtest-plan-builder/artifact.mjs'
import { makeRunInputForTest } from './helpers/asyncLoopTestFixtures'

const generateWeekCoreMock = vi.hoisted(() => vi.fn())

vi.mock('../generateWeekCore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generateWeekCore')>()),
  generateWeekCore: generateWeekCoreMock,
}))

import { runAsyncPlanGeneration } from '../asyncGenerationLoop'

describe('transporte de telemetría de rotación', () => {
  beforeEach(() => generateWeekCoreMock.mockReset())

  it('lleva los contadores calculados hasta la fila allowlisteada del artefacto', async () => {
    generateWeekCoreMock.mockResolvedValue({
      sessions: [{
        date: '2026-06-01',
        timeBlock: 'AM',
        sessionType: 'squash',
        title: 'Squash técnico',
        objective: 'Ritmo técnico',
        durationMin: 60,
        rpe: 6,
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
          drills: [{ name: 'Tiros paralelos profundos', durationMin: 20 }],
        },
      }],
      meta: {
        attempts: 1,
        provider: 'claude',
        requestClass: 'plan_builder_week',
        traceId: 'telemetry-rotation',
        repairTaxonomyVersion: 2,
        hydrationActionCount: 0,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        hydratedSessionsAffected: 0,
        correctedSessionsAffected: 0,
        structurallyRepairedSessionsAffected: 0,
        strengthAccessoryRotationActionCount: 3,
        strengthAccessoryRotationSessionsAffected: 1,
        squashDrillRotationActionCount: 2,
        squashDrillRotationSessionsAffected: 1,
        squashDrillRotationOmittedCount: 0,
      },
    })
    const { input, base } = makeRunInputForTest({ weekCount: 1, concurrency: 1 })
    input.writer = { ...base, putWeek: async () => {} }

    const result = await runAsyncPlanGeneration(input)
    const week = result.weeks[0]!
    const row = toWeekRow(week, { scenarioKey: 'telemetry', countRepairsV2: 0 })

    expect(week.generationMeta).toMatchObject({
      strengthAccessoryRotationActionCount: 3,
      squashDrillRotationActionCount: 2,
      squashDrillRotationOmittedCount: 0,
    })
    expect(row).toMatchObject({
      strengthAccessoryRotationActionCount: 3,
      strengthAccessoryRotationSessionsAffected: 1,
      squashDrillRotationActionCount: 2,
      squashDrillRotationSessionsAffected: 1,
      squashDrillRotationOmittedCount: 0,
    })
  })
})
