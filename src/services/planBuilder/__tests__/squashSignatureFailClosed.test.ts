import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRunInputForTest } from './helpers/asyncLoopTestFixtures'

const generateWeekCoreMock = vi.hoisted(() => vi.fn())
const buildLocalFallbackWeekMock = vi.hoisted(() => vi.fn())

vi.mock('../generateWeekCore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generateWeekCore')>()),
  generateWeekCore: generateWeekCoreMock,
}))

vi.mock('../fallbackWeek', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../fallbackWeek')>()),
  buildLocalFallbackWeek: buildLocalFallbackWeekMock,
}))

import { runAsyncPlanGeneration } from '../asyncGenerationLoop'

const FAILURE = 'quality.squash.signature_uniqueness_unresolved'

function failedCoreResult() {
  return {
    sessions: [],
    meta: {
      attempts: 1,
      provider: 'claude',
      requestClass: 'plan_builder_week',
      traceId: 'signature-failure',
      rawSessionCount: 2,
      validSessionCount: 0,
      repairTaxonomyVersion: 2,
      hydrationActionCount: 0,
      correctiveActionCount: 0,
      structuralActionCount: 0,
      hydratedSessionsAffected: 0,
      correctedSessionsAffected: 0,
      structurallyRepairedSessionsAffected: 0,
      lastError: 'No se pudo diferenciar la firma de squash.',
      errorClass: FAILURE,
    },
  }
}

async function runFailureScenario() {
  generateWeekCoreMock.mockResolvedValue(failedCoreResult())
  const { input, base } = makeRunInputForTest({ weekCount: 1, concurrency: 1 })
  const writtenWeeks: typeof input.weeks = []
  input.writer = {
    ...base,
    putWeek: async (week) => { writtenWeeks.push(week) },
  }
  const result = await runAsyncPlanGeneration(input)
  return { result, writtenWeeks }
}

describe('fail-closed de firmas de squash', () => {
  beforeEach(() => {
    generateWeekCoreMock.mockReset()
    buildLocalFallbackWeekMock.mockReset()
  })

  it('propaga el errorClass exacto sin colapsarlo a validation', async () => {
    const { result } = await runFailureScenario()
    expect(result.weeks[0]?.generationMeta.errorClass).toBe(FAILURE)
  })

  it('consume los reintentos configurados', async () => {
    await runFailureScenario()
    expect(generateWeekCoreMock).toHaveBeenCalledTimes(2)
  })

  it('no invoca el fallback local', async () => {
    await runFailureScenario()
    expect(buildLocalFallbackWeekMock).not.toHaveBeenCalled()
  })

  it('E1: dosis incompatible termina tras un intento, sin fallback ni gasto adicional', async () => {
    const failed = failedCoreResult()
    failed.meta.errorClass = 'quality.session.dose_infeasible'
    failed.meta.lastError = 'La dosis no cabe en el tiempo disponible.'
    generateWeekCoreMock.mockResolvedValue(failed)
    const { input } = makeRunInputForTest({ weekCount: 1, concurrency: 1 })
    const result = await runAsyncPlanGeneration(input)
    expect(generateWeekCoreMock).toHaveBeenCalledTimes(1)
    expect(buildLocalFallbackWeekMock).not.toHaveBeenCalled()
    expect(result.weeks[0]).toMatchObject({ status: 'error', sessions: [],
      generationMeta: { errorClass: 'quality.session.dose_infeasible' } })
  })

  it('termina la semana en error al agotar los reintentos', async () => {
    const { result, writtenWeeks } = await runFailureScenario()
    expect(result.weeks[0]).toMatchObject({ status: 'error', sessions: [] })
    expect(writtenWeeks.at(-1)).toMatchObject({ status: 'error' })
  })
})
