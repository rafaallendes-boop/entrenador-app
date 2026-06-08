import { describe, expect, it, vi } from 'vitest'
import { pollPlanGeneration, shouldKeepLocalGenerationSnapshot } from '../pollPlanGeneration'
import type { PlanGenerationSnapshot } from '../pollPlanGeneration'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

function makePlan(generationState: TrainingPlan['generationState'] = 'generating'): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'a1',
    goalEventId: 'e1',
    status: 'draft',
    generationState,
    title: 'Test',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
    totalWeeks: 2,
    phases: [],
    wizardConfig: {} as never,
    macroSnapshot: {} as never,
    createdAt: 1,
    updatedAt: 1,
    generationSummary: {
      startedAt: 1,
      jobId: 'j1',
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: Date.now(),
    },
  }
}

function makeSnapshot(state: TrainingPlan['generationState'] = 'generating'): PlanGenerationSnapshot {
  return {
    plan: makePlan(state),
    weeks: [] as TrainingPlanWeek[],
    isTerminal: state === 'complete' || state === 'failed' || state === 'cancelled' || state === 'partial',
    isStalled: false,
  }
}

describe('pollPlanGeneration — abort race', () => {
  it('does not call onSnapshot when signal aborts during in-flight fetchPlanGenerationSnapshot', async () => {
    const controller = new AbortController()
    const onSnapshot = vi.fn()

    // Simula fetch lenta: deferred promise que resolvemos manualmente
    let resolveFetch!: (v: PlanGenerationSnapshot | null) => void
    const fetchDeferred = new Promise<PlanGenerationSnapshot | null>((res) => { resolveFetch = res })

    const _fetchFn = vi.fn().mockImplementationOnce(() => fetchDeferred)

    const pollPromise = pollPlanGeneration({
      planId: 'plan-1',
      signal: controller.signal,
      onSnapshot,
      intervalMs: 60_000, // intervalo largo para evitar segunda iteración
      _fetchFn,
    })

    // Abort mientras la fetch está pendiente
    controller.abort()
    // La fetch resuelve DESPUÉS del abort (race condition)
    resolveFetch(makeSnapshot('generating'))

    await pollPromise

    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('calls onSnapshot normally when signal is not aborted', async () => {
    const onSnapshot = vi.fn()
    const snapshot = makeSnapshot('complete')

    const _fetchFn = vi.fn().mockResolvedValueOnce(snapshot)

    await pollPlanGeneration({
      planId: 'plan-1',
      onSnapshot,
      intervalMs: 60_000,
      _fetchFn,
    })

    expect(onSnapshot).toHaveBeenCalledWith(snapshot)
  })

  it('keeps a newer local generating plan over an older remote shell snapshot', () => {
    const local = makePlan('generating')
    const remote = {
      ...makePlan('shell'),
      updatedAt: local.updatedAt - 1,
    }

    expect(shouldKeepLocalGenerationSnapshot(local, remote)).toBe(true)
  })

  it('does not keep local generating plan over a newer remote snapshot', () => {
    const local = makePlan('generating')
    const remote = {
      ...makePlan('shell'),
      updatedAt: local.updatedAt + 1,
    }

    expect(shouldKeepLocalGenerationSnapshot(local, remote)).toBe(false)
  })
})
