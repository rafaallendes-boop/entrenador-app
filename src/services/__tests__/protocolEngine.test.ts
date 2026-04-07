import { describe, expect, it } from 'vitest'

import type { DayLog, Session } from '../../types'
import {
  adaptProtocol,
  buildWarmup,
  getProtocolSummary,
  normalizeGeneratedProtocol,
  resolveProtocolContext,
  resolveSessionProtocols,
} from '../protocolEngine'

function makeSession(overrides: Partial<Session> & { type: Session['type'] }): Session {
  const { type, ...rest } = overrides
  return {
    id: 'session-1',
    date: '2026-04-10',
    timeBlock: 'AM',
    type,
    status: 'planned',
    title: 'Session',
    durationMin: 60,
    rpe: 7,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
  } as Session
}

describe('protocolEngine', () => {
  it('resolves readiness context with consecutive days and upcoming competition', () => {
    const session = makeSession({ type: 'squash', subtype: 'training', date: '2026-04-10' })
    const recentSessions = [
      makeSession({ type: 'squash', date: '2026-04-08', status: 'completed' }),
      makeSession({ type: 'squash', date: '2026-04-09', status: 'completed' }),
      makeSession({ type: 'squash', date: '2026-04-11', status: 'planned', subtype: 'match' }),
      makeSession({ type: 'running', date: '2026-04-11', status: 'planned', subtype: 'competitive' }),
    ]
    const dayLog: DayLog = {
      id: '2026-04-10',
      date: '2026-04-10',
      energyLevel: 4,
      sleepHours: 5,
      sleepQuality: 2,
      painLevel: 0,
      updatedAt: 1,
    }

    const context = resolveProtocolContext(session, 'warmup', { recentSessions, dayLog })
    expect(context.consecutiveTrainingDays).toBe(3)
    expect(context.hasCompetitionSoon).toBe(true)
    expect(context.daysToCompetition).toBe(1)
    expect(context.energyLevel).toBe(4)
  })

  it('adapts warmup protectively when pain is present', () => {
    const protocol = buildWarmup({
      kind: 'warmup',
      sport: 'running',
      sessionType: 'running',
      runningType: 'tempo',
      plannedRpe: 8,
      painLevel: 5,
      painNotes: 'soleus tight',
      consecutiveTrainingDays: 1,
      hasCompetitionSoon: false,
    })!

    expect(protocol.tone).toBe('protective')
    expect(protocol.durationMin).toBeLessThanOrEqual(10)
    expect(protocol.steps[0].label).toContain('movilidad suave')
  })

  it('normalizes a legacy protocol array and summarizes it', () => {
    const normalized = normalizeGeneratedProtocol(
      [
        { title: 'Block A', durationMin: 5, steps: ['Trote suave', 'Movilidad'] },
        { title: 'Block B', durationMin: 3, steps: ['2 progresivos'] },
      ],
      'warmup',
    )

    expect(normalized).toBeDefined()
    expect(normalized?.durationMin).toBe(8)
    expect(normalized?.steps).toHaveLength(3)
    expect(getProtocolSummary(normalized)).toContain('8 min')
  })

  it('reuses stored protocol data and adapts it to low readiness', () => {
    const session = makeSession({
      type: 'running',
      runningDetails: { runningType: 'tempo' },
      warmup: {
        title: 'Warm-up recomendado',
        durationMin: 10,
        note: 'Base note',
        tone: 'general',
        steps: [{ label: 'Trote suave' }, { label: 'Movilidad' }],
        source: 'base',
      },
    })

    const resolved = resolveSessionProtocols(session, {
      dayLog: {
        id: '2026-04-10',
        date: '2026-04-10',
        sleepHours: 5,
        sleepQuality: 2,
        energyLevel: 4,
        updatedAt: 1,
      },
    })

    expect(resolved.warmup?.tone).toBe('recovery')
    expect(resolved.warmup?.source).toBe('adapted')
    expect(resolved.warmup?.durationMin).toBeLessThan(10)
  })

  it('competitive context shortens and sharpens the base protocol', () => {
    const adapted = adaptProtocol(
      {
        title: 'Entrada',
        durationMin: 10,
        note: 'Base',
        tone: 'general',
        steps: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        source: 'base',
      },
      {
        kind: 'warmup',
        sport: 'squash',
        sessionType: 'squash',
        sessionSubtype: 'match',
        plannedRpe: 8,
        consecutiveTrainingDays: 1,
        hasCompetitionSoon: true,
        daysToCompetition: 0,
      },
    )

    expect(adapted.tone).toBe('competitive')
    expect(adapted.title).toContain('pre-competitiva')
    expect(adapted.durationMin).toBe(10)
  })
})
