import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import {
  deriveSquashProgressionState,
  selectSquashDrills,
  summarizeSquashProgression,
} from '../training/drillSelector'

function makeSquashSession(date: string, drillName: string): Session {
  return {
    id: `${date}-${drillName}`,
    date,
    timeBlock: 'AM',
    type: 'squash',
    status: 'completed',
    title: 'Squash',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    squashDetails: {
      trainingFocus: 'technical',
      drills: [{ name: drillName, durationMin: 15 }],
    },
  } as Session
}

describe('drillSelector progression', () => {
  it('forces deload when squash ACWR is in risk', () => {
    const state = deriveSquashProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar drive',
      recentDrills: [],
      squashAcwr: { sport: 'squash', acuteLoad: 800, chronicLoad: 500, ratio: 1.6, status: 'risk', baselineWeeks: 3 },
      historicalSessions: [makeSquashSession('2026-04-06', 'Drives paralelos a profundidad')],
    })

    expect(state.recommendation).toBe('deload')
  })

  it('rotates when the same family is repeated in consecutive sessions', () => {
    const state = deriveSquashProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar drive',
      recentDrills: [],
      historicalSessions: [
        makeSquashSession('2026-04-08', 'Drives cruzados con longitud'),
        makeSquashSession('2026-04-06', 'Drives paralelos a profundidad'),
      ],
    })

    expect(state.targetFamily).toBe('drive_patterns')
    expect(state.recommendation).toBe('rotate')
  })

  it('progresses with a single recent family exposure and low fatigue', () => {
    const state = deriveSquashProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar drive',
      recentDrills: [],
      historicalSessions: [makeSquashSession('2026-04-08', 'Drives paralelos a profundidad')],
    })

    expect(state.recommendation).toBe('progress')
  })

  it('summarizes progression with family and ACWR signal', () => {
    const summary = summarizeSquashProgression({
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar drive',
      recentDrills: [],
      squashAcwr: { sport: 'squash', acuteLoad: 420, chronicLoad: 420, ratio: 1, status: 'optimal', baselineWeeks: 3 },
      historicalSessions: [makeSquashSession('2026-04-08', 'Drives paralelos a profundidad')],
    })

    expect(summary).toContain('drive_patterns')
    expect(summary).toContain('ACWR squash')
  })

  it('selects controlled drills when taper and competition are near', () => {
    const selection = selectSquashDrills({
      phase: 'taper',
      fatigueLevel: 5,
      competitionSoon: true,
      goal: 'llegar fresco',
      recentDrills: [],
    })

    expect(selection.drills.length).toBeGreaterThanOrEqual(3)
    expect(selection.drills.some((drill) => drill.notes?.includes('Mantener timing'))).toBe(true)
  })

  it('prioritizes practice match drills in build/peak when the goal is competitive and there is no immediate competition', () => {
    const selection = selectSquashDrills({
      phase: 'peak',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar rendimiento en partido y manejo de presion',
      recentDrills: [],
      historicalSessions: [makeSquashSession('2026-04-08', 'Drives paralelos a profundidad')],
    })

    expect(
      selection.drills.some((drill) =>
        [
          'Partido de entrenamiento libre a 5 games',
          'Sets cortos de presion al mejor de 3 games',
          'Partido con foco de ataque en puntos cortos',
        ].includes(drill.name),
      ),
    ).toBe(true)
  })

  it('does not prioritize practice match drills in taper or high fatigue', () => {
    const taperSelection = selectSquashDrills({
      phase: 'taper',
      fatigueLevel: 5,
      competitionSoon: false,
      goal: 'mejorar rendimiento en partido',
      recentDrills: [],
    })

    const fatigueSelection = selectSquashDrills({
      phase: 'build',
      fatigueLevel: 8,
      competitionSoon: false,
      goal: 'mejorar rendimiento en partido',
      recentDrills: [],
    })

    const practiceMatchNames = new Set([
      'Partido de entrenamiento libre a 5 games',
      'Sets cortos de presion al mejor de 3 games',
      'Partido con foco de ataque en puntos cortos',
    ])

    expect(taperSelection.drills.some((drill) => practiceMatchNames.has(drill.name))).toBe(false)
    expect(fatigueSelection.drills.some((drill) => practiceMatchNames.has(drill.name))).toBe(false)
  })
})
