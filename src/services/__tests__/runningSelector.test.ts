import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { RUNNING_SESSION_LIBRARY } from '../training/runningSessionLibrary'
import {
  deriveRunningProgressionState,
  extractRecentRunningSessions,
  filterByCompetition,
  selectRunningSession,
  summarizeRunningProgression,
} from '../training/runningSelector'

function makeRunningSession(date: string, runningType: 'z2' | 'tempo' | 'intervals' | 'long', title: string, objective = ''): Session {
  return {
    id: `${date}-${title}`,
    date,
    timeBlock: 'AM',
    type: 'running',
    status: 'completed',
    title,
    objective,
    durationMin: 50,
    createdAt: 1,
    updatedAt: 1,
    runningDetails: { runningType },
  } as Session
}

describe('runningSelector progression', () => {
  it('extracts recent running families from historical sessions', () => {
    const families = extractRecentRunningSessions([
      makeRunningSession('2026-04-08', 'tempo', 'Tempo continuo', 'bloques de umbral'),
      makeRunningSession('2026-04-06', 'long', 'Long run fácil'),
      makeRunningSession('2026-04-04', 'z2', 'Trote suave recovery'),
    ])

    expect(families).toEqual(['tempo_threshold', 'long_run', 'recovery'])
  })

  it('forces deload when running ACWR is in risk', () => {
    const state = deriveRunningProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      recentSessions: [],
      goal: '10k',
      sportProfile: 'hybrid',
      runningAcwr: { acuteLoad: 900, chronicLoad: 600, ratio: 1.5, status: 'risk', baselineWeeks: 3 },
      historicalSessions: [makeRunningSession('2026-04-08', 'long', 'Long run fácil')],
    })

    expect(state.intent).toBe('deload')
  })

  it('rotates after repeating the same family twice', () => {
    const state = deriveRunningProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      recentSessions: [],
      goal: '10k',
      sportProfile: 'running_primary',
      historicalSessions: [
        makeRunningSession('2026-04-08', 'tempo', 'Tempo continuo'),
        makeRunningSession('2026-04-06', 'tempo', 'Cruise intervals'),
      ],
    })

    expect(state.currentFamily).toBe('tempo_threshold')
    expect(state.intent).toBe('rotate')
  })

  it('nudges progress when undertrained and fresh enough', () => {
    const state = deriveRunningProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      recentSessions: [],
      goal: '10k',
      sportProfile: 'hybrid',
      runningAcwr: { acuteLoad: 200, chronicLoad: 400, ratio: 0.5, status: 'undertrained', baselineWeeks: 3 },
      historicalSessions: [makeRunningSession('2026-04-08', 'z2', 'Easy Z2 base')],
    })

    expect(state.intent).toBe('progress')
  })

  it('removes hard sessions close to competition', () => {
    const filtered = filterByCompetition(RUNNING_SESSION_LIBRARY, {
      phase: 'peak',
      fatigueLevel: 4,
      recentSessions: [],
      goal: '10k',
      sportProfile: 'running_primary',
      competitionSoon: true,
      daysToCompetition: 5,
    })

    expect(filtered.some((session) => session.family === 'hill')).toBe(false)
    expect(filtered.some((session) => session.id === 'pace_10k_reps')).toBe(true)
  })

  it('selects a low intensity session when ACWR risk asks for deload', () => {
    const result = selectRunningSession({
      phase: 'build',
      fatigueLevel: 4,
      recentSessions: ['long_run'],
      goal: 'running cargado',
      sportProfile: 'hybrid',
      runningAcwr: { acuteLoad: 900, chronicLoad: 600, ratio: 1.5, status: 'risk', baselineWeeks: 3 },
      competitionSoon: false,
      historicalSessions: [makeRunningSession('2026-04-08', 'long', 'Long run fácil')],
    })

    expect(['low', 'moderate']).toContain(result.session.intensity)
    expect(result.session.notes).toContain('ACWR de running alto')
  })

  it('summarizes the selected family and ACWR status', () => {
    const summary = summarizeRunningProgression({
      phase: 'build',
      fatigueLevel: 4,
      recentSessions: [],
      goal: '10k',
      sportProfile: 'running_primary',
      runningAcwr: { acuteLoad: 480, chronicLoad: 480, ratio: 1, status: 'optimal', baselineWeeks: 3 },
      historicalSessions: [makeRunningSession('2026-04-08', 'tempo', 'Tempo continuo')],
    })

    expect(summary).toContain('tempo_threshold')
    expect(summary).toContain('ACWR running')
  })
})
