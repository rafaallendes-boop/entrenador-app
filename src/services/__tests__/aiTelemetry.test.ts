import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AITechnicalResult, CoachFeedback } from '../../types'

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
    },
  },
}))

import {
  assertDailyAIRequestLimit,
  DEFAULT_DAILY_AI_LIMITS,
  getDailyAIUsage,
  recordCoachFeedback,
  upsertAIRequestLog,
} from '../ai/aiTelemetry'

describe('aiTelemetry', () => {
  beforeEach(() => {
    mocks.logs.splice(0, mocks.logs.length)
    mocks.feedback.clear()
  })

  it('persists and counts request logs by local day', async () => {
    const now = new Date('2026-05-09T12:00:00').getTime()
    await upsertAIRequestLog({
      traceId: 'trace-1',
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
})
