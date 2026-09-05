import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  activeQueries: 0,
  tombstonedAthletes: new Set<string>(),
}))

const planRow = {
  id: 'plan-late',
  user_id: 'user-1',
  athlete_id: 'ath-deleting',
  goal_event_id: 'event-1',
  status: 'draft',
  generation_state: 'generating',
  title: 'Plan remoto',
  start_date: '2026-07-13',
  end_date: '2026-07-19',
  total_weeks: 1,
  phases: [],
  wizard_config: {},
  macro_snapshot: {},
  created_at: 1,
  updated_at: 100,
  generation_summary: null,
}

async function remoteResult<T>(data: T): Promise<{ data: T; error: null }> {
  state.activeQueries += 1
  try {
    if (state.gate) await state.gate
    return { data, error: null }
  } finally {
    state.activeQueries -= 1
  }
}

vi.mock('../../auth', () => ({
  isSupabaseConfigured: false,
  getAuthRedirectUrl: vi.fn(() => 'http://localhost'),
  NATIVE_AUTH_REDIRECT_URL: 'rallyiq://auth/callback',
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => table === 'training_plans'
          ? { maybeSingle: () => remoteResult(planRow) }
          : remoteResult([])),
      })),
    })),
  },
}))

vi.mock('../../sync/athleteDeleteTombstones', () => ({
  hasAthleteDeleteTombstone: vi.fn((_userId: string, athleteId: string) =>
    state.tombstonedAthletes.has(athleteId)),
  hasAthleteDeleteTombstoneForAthlete: vi.fn((athleteId: string) =>
    state.tombstonedAthletes.has(athleteId)),
  rememberAthleteDeleteTombstone: vi.fn((_userId: string, athleteId: string) => {
    state.tombstonedAthletes.add(athleteId)
    return 'test-token'
  }),
}))

import { db } from '../../../db/db'
import { rowToTrainingPlan } from '../planRows'
import { fetchPlanGenerationSnapshot } from '../pollPlanGeneration'

describe('fetchPlanGenerationSnapshot athlete write lease', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    state.gate = null
    state.activeQueries = 0
    state.tombstonedAthletes.clear()
  })

  afterEach(() => {
    db.close()
  })

  it('preserva el marcador local al persistir cada snapshot remoto', async () => {
    const pendingRecalibration = { weekIndexes: [2, 3], requestedAt: 50 }
    await db.trainingPlans.put({ ...rowToTrainingPlan(planRow), pendingRecalibration })

    const snapshot = await fetchPlanGenerationSnapshot('plan-late')

    expect(snapshot?.plan.pendingRecalibration).toEqual(pendingRecalibration)
    expect((await db.trainingPlans.get('plan-late'))?.pendingRecalibration).toEqual(pendingRecalibration)
  })

  it('no reinserta plan ni semanas si el atleta queda tombstoned durante el fetch', async () => {
    let release!: () => void
    state.gate = new Promise<void>((resolve) => { release = resolve })

    const fetching = fetchPlanGenerationSnapshot('plan-late')
    await vi.waitFor(() => expect(state.activeQueries).toBe(2))
    state.tombstonedAthletes.add('ath-deleting')
    release()

    await expect(fetching).resolves.toBeNull()
    expect(await db.trainingPlans.get('plan-late')).toBeUndefined()
    expect(await db.trainingPlanWeeks.where('planId').equals('plan-late').count()).toBe(0)
  })
})
