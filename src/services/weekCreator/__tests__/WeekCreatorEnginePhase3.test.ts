import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatContext } from '../../../types'
import type { AIProvider } from '../../ai/types'
import { useAIDebugStore } from '../../../store/useAIDebugStore'
import { WeekCreatorEngine } from '../WeekCreatorEngine'
import { WEEK_CREATOR_RESPONSE_SCHEMA } from '../weekCreatorResponseSchema'
import { WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA } from '../weekCreatorSkeletonSchema'

const TARGET_WEEK = '2026-07-20'

vi.mock('../../../utils/date', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../utils/date')>(),
  todayISO: () => '2026-07-19',
}))

beforeEach(() => {
  useAIDebugStore.getState().clear()
})

describe('WeekCreatorEngine phase 3 compact contract', () => {
  it('requests a compact skeleton, hydrates focus locally, and validates executable details', async () => {
    const call = vi.fn(async (request: Parameters<AIProvider['call']>[0]) => ({
      text: JSON.stringify(fiveSessionSkeleton()),
      provider: 'mock' as const,
      model: 'phase-3-fixture',
      traceId: request.traceId,
      generationId: request.generationId,
      requestClass: request.requestClass,
    }))
    const provider: AIProvider = { name: 'mock', call }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame cinco sesiones priorizando squash',
      multiSportContext(),
      { targetWeekStart: TARGET_WEEK, provider },
    )

    expect(call).toHaveBeenCalledTimes(1)
    const request = call.mock.calls[0]?.[0]
    expect(request?.responseSchema).toBe(WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA)
    expect(request?.systemPrompt).toContain('esqueletos semanales')
    expect(request?.userMessage).not.toContain('al menos 4 drills técnicos')
    expect(JSON.stringify(request?.responseSchema)).not.toContain('squashDetails')

    const sessions = response.actions?.[0]?.sessions ?? []
    expect(sessions).toHaveLength(5)
    expect(sessions
      .filter((session) => session.sessionType === 'squash')
      .every((session) => (session.squashDetails?.drills.length ?? 0) > 0)).toBe(true)
    expect(sessions.find((session) => session.sessionType === 'strength')?.exercises?.length)
      .toBeGreaterThan(0)
    expect(response.fallbackUsed).toBeFalsy()
    expect(response.retryUsed).toBeFalsy()

    const debugRequest = useAIDebugStore.getState().requests.find((item) => item.traceId === response.traceId)
    expect(debugRequest?.stageTimings?.map((stage) => stage.stage)).toEqual([
      'prompt_build',
      'provider_call',
      'normalize',
      'hydrate',
      'repair',
      'validate',
    ])
    expect(debugRequest?.responseSchemaCharCount).toBe(JSON.stringify(WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA).length)
    expect(debugRequest?.weekCreatorContract).toBe('skeleton_v1')
    expect(debugRequest?.repairStats).toMatchObject({
      repairedSessionCount: 2,
      movedSessionCount: 0,
      addedFallbackCount: 0,
      droppedSessionCount: 0,
      filteredSportCount: 0,
      repairTaxonomyVersion: 2,
      hydrationActionCount: 0,
      correctiveActionCount: 2,
      structuralActionCount: 0,
      hydratedSessionsAffected: 0,
      correctedSessionsAffected: 1,
      structurallyRepairedSessionsAffected: 0,
      hydration: {
        repairedSessionCount: 8,
        movedSessionCount: 0,
        addedFallbackCount: 0,
        droppedSessionCount: 0,
        filteredSportCount: 0,
        repairTaxonomyVersion: 2,
        hydrationActionCount: 5,
        correctiveActionCount: 2,
        structuralActionCount: 1,
        hydratedSessionsAffected: 5,
        correctedSessionsAffected: 2,
        structurallyRepairedSessionsAffected: 1,
      },
    })
  })

  it('keeps the detailed contract for active medical restrictions', async () => {
    const call = vi.fn(async (request: Parameters<AIProvider['call']>[0]) => ({
      text: JSON.stringify({
        type: 'create_week',
        reason: 'Retorno conservador',
        targetDate: TARGET_WEEK,
        sessions: [
          runningSession('2026-07-20', 'Rodaje retorno 1'),
          runningSession('2026-07-22', 'Rodaje retorno 2'),
          runningSession('2026-07-24', 'Rodaje retorno 3'),
        ],
      }),
      provider: 'mock' as const,
      model: 'medical-fixture',
      traceId: request.traceId,
      generationId: request.generationId,
      requestClass: request.requestClass,
    }))
    const provider: AIProvider = { name: 'mock', call }
    const context: ChatContext = {
      athleteProfile: {
        id: 'medical-athlete',
        updatedAt: 0,
        sportContext: { enabledSports: ['running'], primarySport: 'running' },
        scheduleProfile: { availableDays: ['lun', 'mié', 'vie'], sessionsPerWeek: 3 },
        recoveryProfile: { restrictions: 'Retorno progresivo; sin impacto intenso.' },
      },
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana de retorno progresivo',
      context,
      { targetWeekStart: TARGET_WEEK, provider },
    )

    const request = call.mock.calls[0]?.[0]
    expect(request?.responseSchema).toBe(WEEK_CREATOR_RESPONSE_SCHEMA)
    expect(request?.systemPrompt).not.toContain('esqueletos semanales')
    const debugRequest = useAIDebugStore.getState().requests.find((item) => item.traceId === response.traceId)
    expect(debugRequest?.activeRestrictionsPresent).toBe(true)
    expect(debugRequest?.weekCreatorContract).toBe('detailed')
    expect(debugRequest?.stageTimings?.some((stage) => stage.stage === 'hydrate')).toBe(false)
    expect(response.actions?.[0]?.sessions).toHaveLength(3)
  })

  it('hydrates eight sessions and keeps doubles only on explicitly available days', async () => {
    const call = vi.fn(async (request: Parameters<AIProvider['call']>[0]) => ({
      text: JSON.stringify(eightSessionSkeleton()),
      provider: 'mock' as const,
      model: 'eight-session-fixture',
      traceId: request.traceId,
      generationId: request.generationId,
      requestClass: request.requestClass,
    }))
    const provider: AIProvider = { name: 'mock', call }
    const context = multiSportContext()
    if (context.athleteProfile?.scheduleProfile) {
      context.athleteProfile.scheduleProfile.availableDays = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
      context.athleteProfile.scheduleProfile.doubleSessionDays = ['lun', 'mar']
      context.athleteProfile.scheduleProfile.sessionsPerWeek = 7
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana con 8 entrenamientos y respetando mis horarios disponibles',
      context,
      { targetWeekStart: TARGET_WEEK, provider },
    )

    const sessions = response.actions?.[0]?.sessions ?? []
    expect(call).toHaveBeenCalledTimes(1)
    expect(sessions).toHaveLength(8)
    expect(new Set(sessions.map((session) => `${session.date}|${session.timeBlock}`)).size).toBe(8)
    const sessionsByDate = sessions.reduce<Map<string, typeof sessions>>((byDate, session) => {
      byDate.set(session.date, [...(byDate.get(session.date) ?? []), session])
      return byDate
    }, new Map())
    const doubles = [...sessionsByDate.entries()]
      .filter(([, items]) => items.length === 2)
      .map(([date]) => date)
    expect(doubles).toHaveLength(2)
    expect(doubles.every((date) => date === '2026-07-20' || date === '2026-07-21')).toBe(true)
    const debugRequest = useAIDebugStore.getState().requests.find((item) => item.traceId === response.traceId)
    expect(debugRequest?.expectedSessionCount).toBe(8)
  })
})

function multiSportContext(): ChatContext {
  return {
    athleteProfile: {
      id: 'phase-3-athlete',
      updatedAt: 0,
      sportContext: {
        enabledSports: ['squash', 'running', 'strength', 'cycling'],
        primarySport: 'squash',
      },
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'mié', 'jue', 'vie'],
        sessionsPerWeek: 5,
      },
    },
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
  }
}

function baseSession(
  date: string,
  sessionType: 'squash' | 'running' | 'strength' | 'cycling',
  focusKey: string,
  title: string,
  timeBlock: 'AM' | 'PM' = 'AM',
) {
  return {
    date,
    timeBlock,
    sessionType,
    durationMin: sessionType === 'running' ? 45 : 60,
    rpe: sessionType === 'cycling' ? 4 : 6,
    focusKey,
    title,
    objective: `Objetivo de ${title}.`,
  }
}

function fiveSessionSkeleton() {
  return {
    type: 'create_week',
    reason: 'Semana compacta multideporte',
    targetDate: TARGET_WEEK,
    sessions: [
      baseSession('2026-07-20', 'squash', 'squash_technical', 'Squash técnica'),
      baseSession('2026-07-21', 'strength', 'strength_lower', 'Fuerza lower'),
      baseSession('2026-07-22', 'squash', 'squash_control', 'Squash control'),
      baseSession('2026-07-23', 'running', 'running_z2', 'Running Z2'),
      baseSession('2026-07-24', 'squash', 'squash_match', 'Squash match'),
    ],
  }
}

function eightSessionSkeleton() {
  return {
    type: 'create_week',
    reason: 'Semana compacta de ocho sesiones',
    targetDate: TARGET_WEEK,
    sessions: [
      baseSession('2026-07-20', 'squash', 'squash_technical', 'Squash técnica', 'AM'),
      baseSession('2026-07-20', 'strength', 'strength_lower', 'Fuerza lower', 'PM'),
      baseSession('2026-07-21', 'squash', 'squash_control', 'Squash control', 'AM'),
      baseSession('2026-07-21', 'running', 'running_z2', 'Running Z2', 'PM'),
      baseSession('2026-07-22', 'squash', 'squash_tactical', 'Squash táctica'),
      baseSession('2026-07-23', 'strength', 'strength_upper', 'Fuerza upper'),
      baseSession('2026-07-24', 'squash', 'squash_match', 'Squash match'),
      baseSession('2026-07-25', 'cycling', 'cycling_z2', 'Cycling Z2'),
    ],
  }
}

function runningSession(date: string, title: string) {
  return {
    date,
    timeBlock: 'AM',
    sessionType: 'running',
    title,
    durationMin: 35,
    rpe: 3,
    objective: 'Retorno aeróbico suave sin dolor.',
    runningType: 'z2',
  }
}
