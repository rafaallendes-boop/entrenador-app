import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import type { PlanBuilderRecentContext } from '../recentContext'
import { renderPlanBuilderRecentContext, summarizeWeeklyStructure } from '../recentContext'

function makeSession(partial: Partial<Session> & Pick<Session, 'date' | 'type'>): Session {
  return {
    id: `${partial.date}-${partial.type}-${Math.random().toString(36).slice(2)}`,
    weekStartDate: undefined,
    timeBlock: 'AM',
    status: 'completed',
    title: `${partial.type} session`,
    durationMin: 60,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as Session
}

describe('renderPlanBuilderRecentContext', () => {
  it('keeps new users explicit instead of inventing history', () => {
    const text = renderPlanBuilderRecentContext(undefined)

    expect(text).toContain('Sin historial suficiente')
    expect(text).toContain('No inventes adherencia')
  })

  it('summarizes adherence, recovery and recent sports when history exists', () => {
    const context: PlanBuilderRecentContext = {
      referenceDate: '2026-06-04',
      lookbackWeeks: 6,
      hasHistory: true,
      weeks: [{
        weekStartDate: '2026-05-25',
        plannedSessions: 5,
        completedSessions: 4,
        adherencePct: 80,
        plannedMinutes: 300,
        completedMinutes: 240,
        avgActualRpe: 7,
        avgSleep: 7.2,
        avgEnergy: 7,
        sports: { squash: 3, strength: 1 },
        painNotes: ['2026-05-28: leve isquio'],
        sessionHighlights: ['2026-05-27 squash: Match RPE 8'],
      }],
      structureWeeks: 1,
      weeklyStructure: [],
      summary: {
        avgAdherencePct: 80,
        avgCompletedMinutes: 240,
        avgActualRpe: 7,
        avgSleep: 7.2,
        avgEnergy: 7,
        dominantSports: [{ sport: 'squash', sessions: 3 }, { sport: 'strength', sessions: 1 }],
        recentPainNotes: ['2026-05-28: leve isquio'],
        recommendation: 'normal',
      },
    }

    const text = renderPlanBuilderRecentContext(context)

    expect(text).toContain('Historial reciente real')
    expect(text).toContain('Adherencia promedio: 80%')
    expect(text).toContain('Deportes recientes: squash 3, strength 1')
    expect(text).toContain('Alertas de dolor')
  })

  it('renders the weekly structure skeleton when present', () => {
    const context: PlanBuilderRecentContext = {
      referenceDate: '2026-06-04',
      lookbackWeeks: 6,
      hasHistory: true,
      weeks: [],
      structureWeeks: 2,
      weeklyStructure: [
        { weekday: 1, sports: [{ sport: 'squash', count: 2, typicalDurationMin: 75 }, { sport: 'strength', count: 1, typicalDurationMin: 60 }] },
        { weekday: 3, sports: [{ sport: 'running', count: 1, typicalDurationMin: 50 }] },
      ],
      summary: {
        dominantSports: [],
        recentPainNotes: [],
        recommendation: 'normal',
      },
    }

    const text = renderPlanBuilderRecentContext(context)

    expect(text).toContain('Esqueleto semanal')
    expect(text).toContain('Lun: squash ×2 ~75min')
    expect(text).toContain('strength ~60min')
    expect(text).toContain('Mié: running ~50min')
  })
})

describe('summarizeWeeklyStructure', () => {
  it('returns empty for no sessions', () => {
    expect(summarizeWeeklyStructure([])).toEqual([])
  })

  it('groups sessions by ISO weekday (1=Mon..7=Sun) with counts and typical duration', () => {
    // 2026-06-01 is a Monday.
    const sessions: Session[] = [
      makeSession({ date: '2026-06-01', type: 'squash', durationMin: 80 }),
      makeSession({ date: '2026-06-08', type: 'squash', durationMin: 70 }),
      makeSession({ date: '2026-06-01', type: 'strength', durationMin: 60 }),
      makeSession({ date: '2026-06-03', type: 'running', durationMin: 50 }),
      makeSession({ date: '2026-06-05', type: 'squash', durationMin: 90, status: 'skipped' }),
    ]

    const result = summarizeWeeklyStructure(sessions)

    const monday = result.find((day) => day.weekday === 1)
    expect(monday?.sports.find((s) => s.sport === 'squash')).toMatchObject({ count: 2, typicalDurationMin: 75 })
    expect(monday?.sports.find((s) => s.sport === 'strength')).toMatchObject({ count: 1, typicalDurationMin: 60 })
    expect(result.find((day) => day.weekday === 3)?.sports[0]).toMatchObject({ sport: 'running', count: 1 })
    // Skipped Friday session is ignored.
    expect(result.find((day) => day.weekday === 5)).toBeUndefined()
  })
})
