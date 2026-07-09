import { describe, expect, it } from 'vitest'

import type { ChatContext, ReadinessDaily } from '../../../types'
import { todayISO } from '../../../utils/date'
import { buildCoachSystemPrompt } from '../promptBuilder'
import { formatReadinessLine } from '../readinessContext'

describe('formatReadinessLine', () => {
  it('summarizes recovery/sleep/strain', () => {
    const line = formatReadinessLine({
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      recoveryScore: 28,
      sleepHours: 5.2,
      sleepPerformance: 61,
      strain: 14.1,
      source: 'whoop',
      updatedAt: 1,
    })

    expect(line).toContain('28%')
    expect(line).toContain('5.2')
    expect(line).toContain('14.1')
    expect(line?.toLowerCase()).toContain('bajo')
  })

  it('returns null when no readiness', () => {
    expect(formatReadinessLine(undefined)).toBeNull()
  })
})

describe('readiness prompt context', () => {
  it('adds readiness as passive context in the today block', () => {
    const readiness: ReadinessDaily = {
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      recoveryScore: 28,
      sleepHours: 5.2,
      strain: 14.1,
      source: 'whoop',
      updatedAt: 1,
    }
    const context: ChatContext & { readiness: ReadinessDaily } = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      readiness,
    }

    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('Readiness Whoop: recovery 28% (bajo), sueño 5.2h, strain 14.1.')
  })

  it('does not present WHOOP-derived energy or sleep quality as declared feelings', () => {
    const today = todayISO()
    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      readiness: {
        id: `whoop:ath_u1:${today}`,
        athleteId: 'ath_u1',
        date: today,
        recoveryScore: 28,
        sleepHours: 5.2,
        strain: 14.1,
        source: 'whoop',
        updatedAt: 1,
      },
      dayLog: {
        id: `day:${today}`,
        date: today,
        sleepHours: 5.2,
        sleepQuality: 2,
        energyLevel: 3,
        prefillSource: {
          sleepHours: 'whoop',
          sleepQuality: 'whoop',
          energyLevel: 'whoop',
        },
        updatedAt: 1,
      },
    }

    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('Readiness Whoop: recovery 28% (bajo), sueño 5.2h, strain 14.1.')
    expect(prompt).toContain('Sueño: 5.2h')
    expect(prompt).not.toContain('Calidad 2/5')
    expect(prompt).not.toContain('Energía: 3/10')
  })

  it('keeps manually edited subjective check-in fields in the prompt', () => {
    const today = todayISO()
    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      readiness: {
        id: `whoop:ath_u1:${today}`,
        athleteId: 'ath_u1',
        date: today,
        recoveryScore: 28,
        sleepHours: 5.2,
        strain: 14.1,
        source: 'whoop',
        updatedAt: 1,
      },
      dayLog: {
        id: `day:${today}`,
        date: today,
        sleepHours: 5.2,
        sleepQuality: 2,
        energyLevel: 3,
        prefillSource: {
          sleepHours: 'whoop',
        },
        updatedAt: 1,
      },
    }

    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('Sueño: 5.2h · Calidad 2/5')
    expect(prompt).toContain('Energía: 3/10')
  })
})
