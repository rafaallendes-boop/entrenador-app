import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatContext } from '../../../types'
import type { AIProvider } from '../../ai/types'
import { useAIDebugStore } from '../../../store/useAIDebugStore'
import { WeekCreatorEngine } from '../WeekCreatorEngine'

beforeEach(() => {
  useAIDebugStore.getState().clear()
})

describe('WeekCreatorEngine phase 2 repair policy', () => {
  it('keeps the single complete create_week, drops accessory actions, and fixes targetDate locally', async () => {
    const call = vi.fn(async (request: Parameters<AIProvider['call']>[0]) => ({
      text: JSON.stringify({
        actions: [
          {
            type: 'create_week',
            reason: 'Semana recuperable',
            targetDate: '2026-04-27',
            sessions: [
              runningSession('2026-05-04', 'Rodaje base'),
              runningSession('2026-05-06', 'Rodaje progresivo'),
              runningSession('2026-05-08', 'Rodaje largo'),
            ],
          },
          {
            type: 'delete_session',
            reason: 'Acción accesoria innecesaria',
            sessionId: 'session-old',
          },
        ],
      }),
      provider: 'mock' as const,
      model: 'phase-2-fixture',
      traceId: request.traceId,
      generationId: request.generationId,
      requestClass: request.requestClass,
    }))
    const provider: AIProvider = { name: 'mock', call }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame tres sesiones de running',
      runningContext(),
      { targetWeekStart: '2026-05-04', provider },
    )

    expect(call).toHaveBeenCalledTimes(1)
    expect(response.fallbackUsed).toBeFalsy()
    expect(response.retryUsed).toBeFalsy()
    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-05-04',
    })
    expect(response.message).toContain('Se ignoraron 1 acción(es) accesoria(s)')
    expect(response.message).toContain('Se corrigió targetDate')

    const request = useAIDebugStore.getState().requests.find((item) => item.traceId === response.traceId)
    expect(request?.repairStats?.codes).toEqual(expect.arrayContaining([
      'extra_actions_ignored',
      'target_date_repaired',
    ]))
  })

  it('keeps provider failures in the retryable provider_failure lane', async () => {
    const call = vi.fn(async () => {
      throw new Error('provider timeout')
    })
    const provider: AIProvider = { name: 'mock', call }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame tres sesiones de running',
      runningContext(),
      { targetWeekStart: '2026-05-04', provider },
    )

    expect(call).toHaveBeenCalledTimes(2)
    expect(response.fallbackUsed).toBe(true)
    expect(response.retryUsed).toBe(true)
    expect(useAIDebugStore.getState().requests.some((request) =>
      request.warnings?.includes('week_creator_failure_category:provider_failure'),
    )).toBe(true)
  })
})

function runningSession(date: string, title: string) {
  return {
    date,
    timeBlock: 'AM',
    sessionType: 'running',
    title,
    durationMin: 45,
    objective: 'Construir base aeróbica.',
    runningType: 'z2',
  }
}

function runningContext(): ChatContext {
  return {
    athleteProfile: {
      id: 'phase-2-athlete',
      updatedAt: Date.now(),
      sportContext: {
        enabledSports: ['running'],
        primarySport: 'running',
      },
      scheduleProfile: {
        availableDays: ['lun', 'mié', 'vie'],
        sessionsPerWeek: 3,
      },
    },
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
  }
}
