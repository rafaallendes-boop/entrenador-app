import { describe, expect, it } from 'vitest'

import type { ChatContext } from '../../types'
import { buildDynamicRunningSelectionSection } from '../ai/promptModules/runningPrompt'
import type { RunningSelectionResult } from '../training/runningSelector'

describe('runningPrompt', () => {
  it('shows ACWR risk even when weekly sessions count is zero', () => {
    const selection: RunningSelectionResult = {
      focus: 'recovery - Easy Z2 base',
      session: {
        name: 'Easy Z2 base',
        category: 'easy',
        family: 'easy_aerobic',
        runningType: 'z2',
        structure: '30-50 min a ritmo Z2 constante.',
        intensity: 'low',
      },
    }

    const section = buildDynamicRunningSelectionSection({} as ChatContext, {
      selection,
      selectionContext: {
        fatigueLevel: 4,
        phase: 'build',
        recentSessions: [],
        goal: '10k',
        sportProfile: 'hybrid',
        competitionSoon: false,
        historicalSessions: [],
        runningAcwr: {
          acuteLoad: 900,
          chronicLoad: 600,
          ratio: 1.5,
          status: 'risk',
          baselineWeeks: 3,
        },
        runningWeeklyLoad: {
          weekStart: '2026-04-06',
          totalLoad: 0,
          totalDurationMin: 0,
          totalDistanceKm: 0,
          sessionsCount: 0,
        },
      },
    })

    expect(section).toContain('Running ACWR: 1.50 (risk)')
    expect(section).not.toContain('Weekly running load:')
    expect(section).toContain('Running progression intent adjusted to deload')
  })
})
