import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AITechnicalResult, CoachFeedback } from '../../types'
import type { TrainingPlanWeek } from '../../types/planBuilder'

const mocks = vi.hoisted(() => ({
  logs: [] as AITechnicalResult[],
  feedback: new Map<string, CoachFeedback>(),
}))

vi.mock('../../db/db', () => ({
  db: {
    aiRequestLogs: {
      put: vi.fn(async (entry: AITechnicalResult) => {
        const index = mocks.logs.findIndex((log) => log.traceId === entry.traceId)
        if (index >= 0) mocks.logs[index] = { ...entry }
        else mocks.logs.push({ ...entry })
      }),
      count: vi.fn(async () => mocks.logs.length),
      orderBy: vi.fn(() => ({
        limit: vi.fn((limit: number) => ({
          toArray: vi.fn(async () => [...mocks.logs].sort((a, b) => a.startedAt - b.startedAt).slice(0, limit)),
        })),
        reverse: vi.fn(() => ({
          limit: vi.fn((limit: number) => ({
            toArray: vi.fn(async () => [...mocks.logs].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)),
          })),
        })),
      })),
      where: vi.fn(() => ({
        aboveOrEqual: vi.fn((start: number) => ({
          toArray: vi.fn(async () => mocks.logs.filter((log) => log.startedAt >= start)),
        })),
      })),
      bulkDelete: vi.fn(async (ids: string[]) => {
        for (const id of ids) {
          const index = mocks.logs.findIndex((log) => log.traceId === id)
          if (index >= 0) mocks.logs.splice(index, 1)
        }
      }),
    },
    coachFeedback: {
      get: vi.fn(async (id: string) => mocks.feedback.get(id)),
      put: vi.fn(async (entry: CoachFeedback) => {
        mocks.feedback.set(entry.id, { ...entry })
      }),
      orderBy: vi.fn(() => ({
        reverse: vi.fn(() => ({
          limit: vi.fn((limit: number) => ({
            toArray: vi.fn(async () => [...mocks.feedback.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)),
          })),
        })),
      })),
    },
  },
}))

import {
  assertDailyAIRequestLimit,
  DEFAULT_DAILY_AI_LIMITS,
  getBetaQualitySnapshot,
  getDailyAIUsage,
  recordCoachFeedback,
  upsertAIRequestLog,
} from '../ai/aiTelemetry'
import {
  assertPlanBuilderWeekRateLimit,
  reservePlanBuilderWeekUsage,
  syncPlanBuilderWeekUsageFromWeeks,
} from '../planBuilder/rateLimit'

function makeRemoteWeek(input: {
  planId?: string
  weekIndex?: number
  now: number
  status?: TrainingPlanWeek['status']
  traceId?: string
}): TrainingPlanWeek {
  const weekIndex = input.weekIndex ?? 0
  return {
    id: `week-${weekIndex}`,
    planId: input.planId ?? 'plan-1',
    weekIndex,
    weekStartDate: '2026-05-04',
    phase: 'base',
    status: input.status ?? 'draft',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: {
      attempts: 1,
      provider: 'claude',
      model: 'claude-sonnet-test',
      requestClass: 'plan_builder_week',
      traceId: input.traceId ?? `trace-week-${weekIndex}`,
      durationMs: 5000,
      lastAttemptAt: input.now,
      retryUsed: false,
      fallbackUsed: false,
    },
    createdAt: input.now,
    updatedAt: input.now,
  }
}

describe('aiTelemetry', () => {
  beforeEach(() => {
    mocks.logs.splice(0, mocks.logs.length)
    mocks.feedback.clear()
  })

  it('persists and counts request logs by local day', async () => {
    const now = new Date('2026-05-09T12:00:00').getTime()
    await upsertAIRequestLog({
      traceId: 'trace-1',
      generationId: 'generation-1',
      attempt: 1,
      requestClass: 'chat_action',
      surface: 'chat',
      status: 'completed',
      startedAt: now,
    })

    await upsertAIRequestLog({
      traceId: 'trace-2',
      requestClass: 'chat_general',
      surface: 'chat',
      status: 'completed',
      startedAt: now,
    })

    expect(await getDailyAIUsage(now)).toMatchObject({
      chat_action: 1,
      chat_general: 1,
    })
  })

  it('throws a rate_limit error when a requestClass reaches its beta daily cap', async () => {
    const now = new Date('2026-05-09T12:00:00').getTime()
    for (let i = 0; i < DEFAULT_DAILY_AI_LIMITS.plan_builder_pair; i++) {
      mocks.logs.push({
        traceId: `trace-${i}`,
        requestClass: 'plan_builder_pair',
        surface: 'plan_builder',
        status: 'completed',
        startedAt: now,
      })
    }

    await expect(assertDailyAIRequestLimit('plan_builder_pair', now)).rejects.toMatchObject({
      code: 'rate_limit',
    })
  })

  it('reserves async Plan Builder week usage so background jobs appear in daily usage', async () => {
    const now = new Date('2026-05-09T12:00:00').getTime()

    await reservePlanBuilderWeekUsage({
      planId: 'plan-1',
      weekIndexes: [0, 1],
      now,
    })

    expect(await getDailyAIUsage(now)).toMatchObject({
      plan_builder_week: 2,
    })
    expect(mocks.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: expect.stringContaining('plan-builder-week-reservation:plan-1:0:'),
        status: 'started',
        requestClass: 'plan_builder_week',
      }),
      expect.objectContaining({
        traceId: expect.stringContaining('plan-builder-week-reservation:plan-1:1:'),
        status: 'started',
        requestClass: 'plan_builder_week',
      }),
    ]))
  })

  it('blocks async Plan Builder starts that would exceed the remaining weekly cap', async () => {
    const now = new Date('2026-05-09T12:00:00').getTime()
    for (let i = 0; i < DEFAULT_DAILY_AI_LIMITS.plan_builder_week - 1; i++) {
      mocks.logs.push({
        traceId: `trace-${i}`,
        requestClass: 'plan_builder_week',
        surface: 'plan_builder',
        status: 'completed',
        startedAt: now,
      })
    }

    await expect(assertPlanBuilderWeekRateLimit([0], now)).resolves.toBeUndefined()
    await expect(assertPlanBuilderWeekRateLimit([0, 1], now)).rejects.toMatchObject({
      code: 'rate_limit',
    })
  })

  it('replaces an async reservation with the real remote week trace when polling syncs results', async () => {
    const now = new Date('2026-05-09T12:00:00').getTime()
    await reservePlanBuilderWeekUsage({
      planId: 'plan-1',
      weekIndexes: [0],
      now: now - 10_000,
    })

    await syncPlanBuilderWeekUsageFromWeeks('plan-1', [
      makeRemoteWeek({ now, traceId: 'remote-trace-1' }),
    ], now)

    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]).toMatchObject({
      traceId: 'remote-trace-1',
      requestClass: 'plan_builder_week',
      surface: 'plan_builder',
      status: 'completed',
      provider: 'claude',
      model: 'claude-sonnet-test',
      durationMs: 5000,
      startedAt: now - 5000,
      completedAt: now,
    })
  })

  it('upserts one feedback record per target', async () => {
    const first = await recordCoachFeedback({
      targetType: 'coach_message',
      targetId: 'msg-1',
      rating: 1,
      traceId: 'trace-1',
    })
    const second = await recordCoachFeedback({
      targetType: 'coach_message',
      targetId: 'msg-1',
      rating: -1,
      traceId: 'trace-1',
    })

    expect(first.id).toBe('feedback:coach_message:msg-1')
    expect(second.createdAt).toBe(first.createdAt)
    expect(mocks.feedback.get('feedback:coach_message:msg-1')?.rating).toBe(-1)
  })

  it('builds a beta quality snapshot without storing prompts or full responses', async () => {
    await upsertAIRequestLog({
      traceId: 'trace-1',
      generationId: 'generation-1',
      attempt: 1,
      requestClass: 'chat_action',
      surface: 'chat',
      status: 'completed',
      provider: 'gemini',
      outcome: 'ok',
      responseCharCount: 120,
      inputCharCount: 4200,
      promptTokens: 1000,
      completionTokens: 300,
      reasoningTokens: 80,
      endToEndDurationMs: 5400,
      generationOutcome: 'model_success',
      generationCompletedAt: Date.now(),
      startedAt: Date.now(),
    })
    await recordCoachFeedback({
      targetType: 'coach_message',
      targetId: 'msg-1',
      rating: 1,
      traceId: 'trace-1',
    })

    const snapshot = await getBetaQualitySnapshot()

    expect(snapshot.requestCount).toBe(1)
    expect(snapshot.feedbackCount).toBe(1)
    expect(snapshot.positiveFeedback).toBe(1)
    expect(snapshot.recentRequests[0]).toMatchObject({
      traceId: 'trace-1',
      generationId: 'generation-1',
      responseCharCount: 120,
      inputCharCount: 4200,
      promptTokens: 1000,
      completionTokens: 300,
      reasoningTokens: 80,
      endToEndDurationMs: 5400,
      generationOutcome: 'model_success',
      generationCompletedAt: expect.any(Number),
    })
    expect(JSON.stringify(snapshot)).not.toContain('systemPrompt')
  })
})
