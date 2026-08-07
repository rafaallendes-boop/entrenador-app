import { describe, expect, it } from 'vitest'

import type { ChatContext, ReadinessDaily } from '../../../types'
import { todayISO } from '../../../utils/date'
import { optimizeChatContext } from '../contextOptimizer'
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

  it('does not present WHOOP-derived rpeActual (Esfuerzo) as declared effort', () => {
    const today = todayISO()
    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      readiness: {
        id: `whoop:ath_u1:${today}`, athleteId: 'ath_u1', date: today,
        recoveryScore: 28, strain: 14.1, source: 'whoop', updatedAt: 1,
      },
      dayLog: {
        id: `day:${today}`, date: today, rpeActual: 7,
        prefillSource: { rpeActual: 'whoop' }, updatedAt: 1,
      },
    }

    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).not.toContain('RPE real hoy')
    expect(prompt).not.toContain('Esfuerzo hoy')
  })

  it('shows a manually-set effort as "Esfuerzo" in the prompt', () => {
    const today = todayISO()
    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      dayLog: { id: `day:${today}`, date: today, rpeActual: 8, updatedAt: 1 },
    }

    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('Esfuerzo hoy: 8/10')
  })

  it('labels the weekly high-effort fatigue signal as "esfuerzo", not "RPE real"', () => {
    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      weekDayLogs: [{ id: 'd1', date: '2026-07-01', rpeActual: 9, updatedAt: 1 }],
    }

    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('esfuerzo >= 8/10')
    expect(prompt).not.toContain('RPE real >= 8/10')
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

describe('whoopWorkoutBlock en el prompt', () => {
  const BLOCK = [
    'Carga objetiva registrada por Whoop (ultimos 7 dias):',
    '- 04-08 running 30 min · strain 11.2 → sin sesion asociada',
    'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta.',
  ].join('\n')

  function makeContext(overrides: Partial<ChatContext> = {}): ChatContext {
    return {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      ...overrides,
    }
  }

  const dayLog = {
    id: `day:${todayISO()}`,
    date: todayISO(),
    energyLevel: 7,
    updatedAt: 1,
  }

  it('emits the block when a dayLog exists', () => {
    const prompt = buildCoachSystemPrompt(
      makeContext({ dayLog, whoopWorkoutBlock: BLOCK }),
      { requestClass: 'chat_general' },
    )
    expect(prompt).toContain('Carga objetiva registrada por Whoop')
  })

  it('emits the block when the dayLog is absent', () => {
    // `buildTodaySection` retorna temprano sin dayLog (promptBuilder.ts:1611-1615).
    // Sin este test el bloque desaparecería justo los días sin check-in, que es
    // cuando el coach más necesita saber qué registró Whoop.
    const prompt = buildCoachSystemPrompt(
      makeContext({ whoopWorkoutBlock: BLOCK }),
      { requestClass: 'chat_general' },
    )
    expect(prompt).toContain('Carga objetiva registrada por Whoop')
  })

  it('emits nothing when the block is absent', () => {
    const prompt = buildCoachSystemPrompt(
      makeContext({ dayLog }),
      { requestClass: 'chat_general' },
    )
    expect(prompt).not.toContain('Carga objetiva registrada por Whoop')
  })

  it('is preserved by the context optimizer', () => {
    const optimized = optimizeChatContext(makeContext({ whoopWorkoutBlock: BLOCK }))
    expect(optimized.whoopWorkoutBlock).toBe(BLOCK)
  })
})
