import { describe, expect, it } from 'vitest'
import type { PlanBuilderRecentContext } from '../recentContext'
import { renderPlanBuilderRecentContext } from '../recentContext'

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
})
