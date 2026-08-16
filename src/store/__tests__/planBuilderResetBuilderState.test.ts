import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { usePlanBuilderStore } from '../usePlanBuilderStore'
import type { TrainingPlan } from '../../types/planBuilder'
import type { EntitlementRequiredDetail } from '../../services/entitlements/entitlementError'

const plan = {
  id: 'p1',
  athleteId: 'ath_self',
  goalEventId: 'ev1',
  status: 'active',
  generationState: 'complete',
  title: 'Torneo',
  startDate: '2026-06-01',
  endDate: '2026-08-15',
  totalWeeks: 2,
  phases: [],
  wizardConfig: {} as never,
  macroSnapshot: {} as never,
  createdAt: 1,
  updatedAt: 1,
} as TrainingPlan

const entitlementOffer: EntitlementRequiredDetail = {
  requestClass: 'plan_builder_week',
  requiredTier: 'advanced',
  currentTier: 'free',
}

describe('resetBuilderState', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    usePlanBuilderStore.getState().resetBuilderState()
    db.close()
  })

  it('limpia el plan y todo el estado transitorio en memoria', () => {
    usePlanBuilderStore.setState({
      plan,
      status: 'done',
      weeks: [],
      issues: [],
      currentWeekIndex: 1,
      completedWeeks: 2,
      failedWeekIndexes: [1],
      streamingTextByWeekIndex: { 1: 'stream' },
      generationJob: {} as never,
      lastError: 'x',
      entitlementOffer,
    })

    usePlanBuilderStore.getState().resetBuilderState()

    expect(usePlanBuilderStore.getState()).toMatchObject({
      plan: null,
      weeks: [],
      issues: [],
      status: 'idle',
      currentWeekIndex: null,
      completedWeeks: 0,
      failedWeekIndexes: [],
      streamingTextByWeekIndex: {},
      generationJob: null,
      lastError: null,
      entitlementOffer: null,
    })
  })

  it('no borra el plan de Dexie', async () => {
    await db.trainingPlans.put(plan)
    usePlanBuilderStore.setState({ plan, status: 'done' })

    usePlanBuilderStore.getState().resetBuilderState()

    expect(await db.trainingPlans.get('p1')).toBeDefined()
  })

  it('resetForAthleteSwitch conserva el contrato y delega al reset en memoria', () => {
    usePlanBuilderStore.setState({ plan, status: 'done', lastError: 'x', entitlementOffer })

    usePlanBuilderStore.getState().resetForAthleteSwitch()

    expect(usePlanBuilderStore.getState().plan).toBeNull()
    expect(usePlanBuilderStore.getState().status).toBe('idle')
    expect(usePlanBuilderStore.getState().lastError).toBeNull()
    expect(usePlanBuilderStore.getState().entitlementOffer).toBeNull()
  })
})
