import { describe, expect, it } from 'vitest'

import type { CoachProposal, Session } from '../../types'
import { normalizeCoachProposal, summarizeCoachProposalUsage } from '../coachProposalMetadata'

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 'session-1',
    date: partial.date ?? '2026-04-10',
    timeBlock: partial.timeBlock ?? 'AM',
    type: partial.type ?? 'cycling',
    status: partial.status ?? 'planned',
    title: partial.title ?? 'Ciclismo Z2',
    durationMin: partial.durationMin ?? 50,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

describe('coachProposalMetadata', () => {
  it('adds fallback cycling details and marks proposal as generic_fallback when missing', () => {
    const result = normalizeCoachProposal([
      {
        type: 'add_session',
        targetDate: '2026-04-11',
        timeBlock: 'AM',
        sessionType: 'cycling',
        title: 'Ciclismo tempo',
        durationMin: 45,
        runningType: 'tempo',
        reason: 'Ajuste de carga',
      },
    ], { source: 'chat' })

    const action = result.actions[0]
    expect(action.type).toBe('add_session')
    expect(action.cyclingDetails).toMatchObject({
      sessionFamily: 'sweetspot_tempo',
      sessionCategory: 'fatigue-managed threshold',
    })
    expect(result.metadata.quality).toBe('generic_fallback')
    expect(result.metadata.genericFallbackSports).toEqual(['cycling'])
  })

  it('keeps explicit mobility details and marks proposal as detailed', () => {
    const result = normalizeCoachProposal([
      {
        type: 'add_session',
        targetDate: '2026-04-11',
        timeBlock: 'PM',
        sessionType: 'mobility',
        title: 'Movilidad post-running',
        durationMin: 25,
        mobilityDetails: {
          context: 'post_run',
          focusAreas: ['hip', 'ankle_foot'],
          targetStructure: 'Reset corto post running.',
          executionNotes: 'Bajar tension de gemelos y cadera.',
        },
        reason: 'Descarga',
      },
    ], { source: 'weekly_action' })

    expect(result.actions[0].mobilityDetails?.context).toBe('post_run')
    expect(result.metadata.quality).toBe('detailed')
    expect(result.metadata.genericFallbackSports).toEqual([])
  })

  it('summarizes tracked proposal usage by sport and outcome', () => {
    const proposals: CoachProposal[] = [
      {
        id: 'p1',
        message: 'Cycling',
        actions: [],
        status: 'accepted',
        createdAt: 10,
        metadata: {
          source: 'chat',
          sports: ['cycling'],
          sportInsights: [{ sport: 'cycling', actionCount: 1, hasExplicitDetails: false, specificity: 'generic_fallback' }],
          genericFallbackSports: ['cycling'],
          quality: 'generic_fallback',
          resolutionOutcome: 'accepted',
        },
      },
      {
        id: 'p2',
        message: 'Mobility',
        actions: [],
        status: 'rejected',
        createdAt: 11,
        metadata: {
          source: 'dashboard_auto_adjustment',
          sports: ['mobility'],
          sportInsights: [{ sport: 'mobility', actionCount: 1, hasExplicitDetails: true, specificity: 'detailed' }],
          genericFallbackSports: [],
          quality: 'detailed',
          resolutionOutcome: 'rejected',
        },
      },
      {
        id: 'p3',
        message: 'Qué comer hoy',
        actions: [],
        status: 'accepted',
        createdAt: 12,
        metadata: {
          source: 'chat',
          sports: [],
          sportInsights: [{ sport: 'nutrition', actionCount: 1, hasExplicitDetails: true, specificity: 'detailed' }],
          genericFallbackSports: [],
          quality: 'detailed',
          resolutionOutcome: 'accepted',
          nutritionPrompts: ['eat_today'],
        },
      },
    ]

    const summary = summarizeCoachProposalUsage(proposals)

    expect(summary.totalTrackedProposals).toBe(3)
    expect(summary.bySport.cycling.genericFallback).toBe(1)
    expect(summary.bySport.cycling.accepted).toBe(1)
    expect(summary.bySport.mobility.explicitDetail).toBe(1)
    expect(summary.bySport.nutrition.accepted).toBe(1)
    expect(summary.recentGenericProposals[0].id).toBe('p1')
  })

  it('normalizes update_session using the existing session type', () => {
    const result = normalizeCoachProposal([
      {
        type: 'update_session',
        sessionId: 'cycling-1',
        newDurationMin: 35,
        reason: 'Bajar carga',
      },
    ], {
      source: 'dashboard_auto_adjustment',
      existingSessions: [makeSession({ id: 'cycling-1', type: 'cycling', title: 'Ciclismo intervalos', objective: 'series VO2' })],
    })

    expect(result.actions[0].cyclingDetails?.sessionFamily).toBe('intervals_vo2')
    expect(result.metadata.sportInsights[0]?.sport).toBe('cycling')
  })

  it('tags clearly nutrition-oriented proposals in metadata', () => {
    const result = normalizeCoachProposal([], {
      source: 'chat',
      proposalMessage: '¿Qué debería comer hoy y cómo ajustar mi hidratación?',
    })

    expect(result.metadata.sportInsights.some((insight) => insight.sport === 'nutrition')).toBe(true)
    expect(result.metadata.nutritionPrompts).toContain('eat_today')
    expect(result.metadata.nutritionPrompts).toContain('hydration')
  })
})
