import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userId: 'user-a' as string | undefined,
  upsertAIRequestLog: vi.fn(async () => undefined),
}))

vi.mock('../../services/ai/aiTelemetry', () => ({
  upsertAIRequestLog: mocks.upsertAIRequestLog,
}))

vi.mock('../useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
  },
}))

const { useAIDebugStore } = await import('../useAIDebugStore')

describe('useAIDebugStore account-scoped telemetry', () => {
  beforeEach(() => {
    mocks.userId = 'user-a'
    mocks.upsertAIRequestLog.mockClear()
    useAIDebugStore.getState().clear()
  })

  it('estampa la cuenta activa al crear la fila y la conserva al actualizarla', () => {
    useAIDebugStore.getState().startRequest({
      traceId: 'trace-1',
      surface: 'chat',
      requestClass: 'chat_general',
      startedAt: Date.now(),
    })

    mocks.userId = 'user-b'
    useAIDebugStore.getState().completeRequest('trace-1', {})

    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      traceId: 'trace-1',
      userId: 'user-a',
      status: 'completed',
    })
    expect(mocks.upsertAIRequestLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ traceId: 'trace-1', userId: 'user-a' }),
    )
  })
})
