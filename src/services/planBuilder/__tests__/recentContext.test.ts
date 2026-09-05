import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import type { PlanBuilderRecentContext, PlanBuilderRecentWeekContext } from '../recentContext'
import { renderPlanBuilderRecentContext, summarizeWeeklyStructure, trimRecentContextForPayload } from '../recentContext'

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

describe('trimRecentContextForPayload', () => {
  function makeWeek(overrides: Partial<PlanBuilderRecentWeekContext> = {}): PlanBuilderRecentWeekContext {
    return {
      weekStartDate: '2026-06-01',
      plannedSessions: 5,
      completedSessions: 4,
      plannedMinutes: 300,
      completedMinutes: 240,
      sports: { squash: 3, strength: 1 },
      painNotes: [],
      sessionHighlights: [],
      ...overrides,
    }
  }

  function makeContext(overrides: Partial<PlanBuilderRecentContext> = {}): PlanBuilderRecentContext {
    return {
      referenceDate: '2026-07-01',
      lookbackWeeks: 6,
      hasHistory: true,
      weeks: [],
      structureWeeks: 3,
      weeklyStructure: [],
      summary: {
        dominantSports: [{ sport: 'squash', sessions: 12 }],
        recentPainNotes: [],
        recommendation: 'normal',
      },
      ...overrides,
    }
  }

  it('keeps only the most recent weeks', () => {
    const weeks = Array.from({ length: 6 }, (_, i) => makeWeek({ weekStartDate: `2026-0${i + 1}-01` }))
    const trimmed = trimRecentContextForPayload(makeContext({ weeks }))
    expect(trimmed.weeks).toHaveLength(4)
    expect(trimmed.weeks.map((week) => week.weekStartDate)).toEqual([
      '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01',
    ])
  })

  it('caps per-week highlights and pain notes', () => {
    const week = makeWeek({
      sessionHighlights: Array.from({ length: 10 }, (_, i) => `highlight ${i}`),
      painNotes: Array.from({ length: 8 }, (_, i) => `pain ${i}`),
    })
    const trimmed = trimRecentContextForPayload(makeContext({ weeks: [week] }))
    expect(trimmed.weeks[0].sessionHighlights).toHaveLength(3)
    expect(trimmed.weeks[0].painNotes).toHaveLength(3)
  })

  // `livedPlanWeeks` crece con el largo del plan: una recalibración en la
  // semana 9 de un plan de 12 arrastra 8 objetos al payload de
  // `generate-plan-background` y los renderiza en CADA prompt del batch.
  // El tope existe justo para acotar ese payload.
  it('caps the lived plan weeks like the pre-plan history', () => {
    const lived = Array.from({ length: 8 }, (_, i) => makeWeek({
      weekStartDate: `2026-07-${String(i + 1).padStart(2, '0')}`,
      sessionHighlights: Array.from({ length: 10 }, (_, j) => `highlight ${j}`),
    }))
    const trimmed = trimRecentContextForPayload(makeContext({ livedPlanWeeks: lived }))
    expect(trimmed.livedPlanWeeks).toHaveLength(4)
    expect(trimmed.livedPlanWeeks?.map((week) => week.weekStartDate)).toEqual([
      '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08',
    ])
    expect(trimmed.livedPlanWeeks?.[0].sessionHighlights).toHaveLength(3)
  })

  it('leaves livedPlanWeeks undefined when the context has none', () => {
    expect(trimRecentContextForPayload(makeContext()).livedPlanWeeks).toBeUndefined()
  })

  it('preserves the summary and structural fields', () => {
    const context = makeContext({ weeklyStructure: [{ weekday: 1, sports: [{ sport: 'squash', count: 2 }] }] })
    const trimmed = trimRecentContextForPayload(context)
    expect(trimmed.summary).toEqual(context.summary)
    expect(trimmed.weeklyStructure).toEqual(context.weeklyStructure)
    expect(trimmed.referenceDate).toBe('2026-07-01')
  })
})
