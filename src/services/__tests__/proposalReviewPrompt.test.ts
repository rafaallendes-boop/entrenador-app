import { beforeAll, describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../types'

function installLocalStorageMock() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
    },
  })
}

function makeContext(): ChatContext {
  const athleteProfile: AthleteProfile = {
    id: 'athlete-1',
    updatedAt: 1,
    primarySport: 'cycling',
    secondarySports: ['mobility'],
    sportContext: {
      enabledSports: ['cycling', 'mobility'],
      primarySport: 'cycling',
      secondarySports: ['mobility'],
      trainingPriority: 'performance',
    },
    goalEvents: [],
  }

  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile,
    recentMessages: [],
    intent: 'plan_week',
  }
}

describe('promptBuilder cycling and mobility examples', () => {
  let buildCoachSystemPrompt: typeof import('../ai/promptBuilder').buildCoachSystemPrompt

  beforeAll(async () => {
    installLocalStorageMock()
    ;({ buildCoachSystemPrompt } = await import('../ai/promptBuilder'))
  }, 120000)

  it('includes explicit compact examples for cyclingDetails and mobilityDetails', () => {
    const prompt = buildCoachSystemPrompt(makeContext())

    expect(prompt).toContain('Ejemplos compactos válidos:')
    expect(prompt).toContain('"cyclingDetails":{"sessionCategory":"support aerobic"')
    expect(prompt).toContain('"mobilityDetails":{"context":"post_cycling"')
  })
})
