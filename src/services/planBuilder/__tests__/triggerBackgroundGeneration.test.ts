import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import type { PlanBuilderRecentContext } from '../recentContext'

const getSession = vi.hoisted(() => vi.fn())
vi.mock('../../auth', () => ({ supabase: { auth: { getSession } } }))

import {
  MAX_PAYLOAD_BYTES,
  PlanEnqueueRejectedError,
  triggerBackgroundGeneration,
  type TriggerBackgroundGenerationInput,
} from '../triggerBackgroundGeneration'

const ENQUEUE_URL = '/.netlify/functions/enqueue-plan-generation'

function makeInput(overrides: Partial<TriggerBackgroundGenerationInput> = {}): TriggerBackgroundGenerationInput {
  return {
    plan: { id: 'plan-1' } as TrainingPlan,
    weeks: [{ id: 'w0', planId: 'plan-1', weekIndex: 0 } as TrainingPlanWeek],
    profile: { id: 'a1', updatedAt: 0 } as AthleteProfile,
    wizardConfig: {} as PlanWizardConfig,
    ...overrides,
  }
}

beforeEach(() => {
  getSession.mockReset()
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('triggerBackgroundGeneration', () => {
  it('returns the jobId from a synchronous enqueue ack', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ jobId: 'job-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await triggerBackgroundGeneration(makeInput())

    expect(result.jobId).toBe('job-1')
    expect(fetchMock).toHaveBeenCalledWith(ENQUEUE_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('throws a definitive PlanEnqueueRejectedError when enqueue rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Payload inválido para generar plan.' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(triggerBackgroundGeneration(makeInput())).rejects.toBeInstanceOf(PlanEnqueueRejectedError)
  })

  it('does not throw a definitive error for ambiguous network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(triggerBackgroundGeneration(makeInput())).rejects.not.toBeInstanceOf(PlanEnqueueRejectedError)
  })

  it('guards oversized payloads before sending', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const huge = { 0: 'x'.repeat(MAX_PAYLOAD_BYTES + 2_000) }

    await expect(triggerBackgroundGeneration(makeInput({ repairInstructions: huge })))
      .rejects.toBeInstanceOf(PlanEnqueueRejectedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a missing session as a definitive start rejection', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(triggerBackgroundGeneration(makeInput()))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trims recentContext to the most recent weeks before sending', async () => {
    let sentBody = ''
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      sentBody = init.body
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ jobId: 'job-2' }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const recentContext = {
      referenceDate: '2026-07-01',
      lookbackWeeks: 6,
      hasHistory: true,
      structureWeeks: 3,
      weeklyStructure: [],
      summary: { dominantSports: [], recentPainNotes: [], recommendation: 'normal' },
      weeks: Array.from({ length: 6 }, (_, i) => ({
        weekStartDate: `2026-0${i + 1}-01`,
        plannedSessions: 5,
        completedSessions: 4,
        plannedMinutes: 300,
        completedMinutes: 240,
        sports: { squash: 3 },
        painNotes: [],
        sessionHighlights: [],
      })),
    } as PlanBuilderRecentContext

    await triggerBackgroundGeneration(makeInput({ recentContext }))

    const parsed = JSON.parse(sentBody) as { recentContext: PlanBuilderRecentContext }
    expect(parsed.recentContext.weeks).toHaveLength(4)
  })
})
