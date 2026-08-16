import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import type { AITechnicalResult } from '../../../types'

let currentTier: 'free' | 'weekly' | 'advanced' = 'free'
vi.mock('../../../store/useEntitlementStore', () => ({
  getEntitlementTier: () => currentTier,
}))

const { assertDailyAIRequestLimit, getDailyAIUsage, upsertAIRequestLog } = await import('../aiTelemetry')
const { AIProviderError } = await import('../types')

const USER = 'user-a'

function log(
  traceId: string,
  userId: string | undefined,
  requestClass: AITechnicalResult['requestClass'],
): AITechnicalResult {
  return { traceId, userId, surface: 'chat', requestClass, startedAt: Date.now() } as AITechnicalResult
}

beforeEach(async () => {
  await db.aiRequestLogs.clear()
  currentTier = 'free'
})

describe('account scoping', () => {
  it('no cuenta filas de otra cuenta', async () => {
    await upsertAIRequestLog(log('t1', 'user-a', 'chat_general'))
    await upsertAIRequestLog(log('t2', 'user-b', 'chat_general'))
    expect((await getDailyAIUsage(Date.now(), 'user-a')).chat_general).toBe(1)
  })

  it('las filas legacy sin userId no cuentan para nadie', async () => {
    await upsertAIRequestLog(log('t1', undefined, 'chat_general'))
    expect((await getDailyAIUsage(Date.now(), 'user-a')).chat_general ?? 0).toBe(0)
    expect((await getDailyAIUsage(Date.now(), null)).chat_general ?? 0).toBe(0)
  })
})

describe('BUCKET COMPARTIDO: 15 de chat_general agotan tambien chat_action', () => {
  it('el mensaje 16 falla aunque sea de la otra clase del bucket', async () => {
    for (let i = 0; i < 15; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('chat_action', Date.now(), { userId: USER }),
    ).rejects.toBeInstanceOf(AIProviderError)
  })

  it('con 14 usados todavia pasa', async () => {
    for (let i = 0; i < 14; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('chat_action', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })

  it('import_extract tiene contador propio y no se agota con el chat', async () => {
    for (let i = 0; i < 15; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('import_extract', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })
})

describe('el limite depende del tier', () => {
  it('weekly aguanta 100 de chat donde free ya habria fallado', async () => {
    currentTier = 'weekly'
    for (let i = 0; i < 100; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('chat_general', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })
})

describe('ORDEN: clase bloqueada por plan NO reporta cuota', () => {
  it('free + week_creator no lanza rate_limit: el gate de entitlement es quien rechaza', async () => {
    currentTier = 'free'
    await expect(
      assertDailyAIRequestLimit('week_creator', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })
})
