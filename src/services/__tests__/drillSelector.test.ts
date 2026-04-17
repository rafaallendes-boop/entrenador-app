import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { findSquashDrillByName, getSquashDrillFamily, SQUASH_DRILL_LIBRARY } from '../training/drillLibrary'
import {
  buildProgressedDrillNotes,
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

function makePracticeMatchSession(date: string): Session {
  return {
    id: `${date}-practice-match`,
    date,
    timeBlock: 'PM',
    type: 'squash',
    status: 'completed',
    subtype: 'match',
    title: 'Practice match',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    squashDetails: {
      trainingFocus: 'tactical',
      sessionMode: 'practice_match',
      drills: [{ name: 'Partido de entrenamiento libre a 5 games', durationMin: 20 }],
    },
  } as Session
}

describe('drillSelector progression', () => {
  it('keeps library ids unique and metadata fields coherent', () => {
    const validIntents = new Set(['consistency', 'pressure', 'finishing', 'recovery', 'control'])
    const validPhaseTags = new Set(['base', 'build', 'peak', 'taper'])
    const ids = new Set<string>()

    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(ids.has(drill.id)).toBe(false)
      ids.add(drill.id)
      expect(drill.tags.some((tag) => validPhaseTags.has(tag))).toBe(true)

      if (drill.constraints) {
        expect(drill.constraints.length).toBeGreaterThan(0)
        expect(drill.constraints.every((constraint) => constraint.trim().length > 0)).toBe(true)
      }

      if (drill.intent) {
        expect(validIntents.has(drill.intent)).toBe(true)
      }
    }
  })

  it('adds the explicit solo/control drill library expected by the new taxonomy', () => {
    const controlNames = [
      '100 drops solo',
      '100 tiros media cancha',
      '100 al box de saque',
      '100 paralelas de fondo',
      'Drops desde media cancha',
      'Voleas solo',
    ]

    for (const name of controlNames) {
      const drill = findSquashDrillByName(name)
      expect(drill).toBeTruthy()
      expect(drill?.tags).toContain('control_session')
    }
  })

  it('includes the new high-intensity squash pressure drills', () => {
    const backCourtPressure = findSquashDrillByName('Presión de fondo')
    const threeQuarterPressure = findSquashDrillByName('Presión a 3/4 de cancha')

    expect(backCourtPressure).toBeTruthy()
    expect(backCourtPressure?.intensity).toBe('high')
    expect(backCourtPressure?.intent).toBe('pressure')
    expect(backCourtPressure?.tags).toContain('conditioned_game')

    expect(threeQuarterPressure).toBeTruthy()
    expect(threeQuarterPressure?.intensity).toBe('high')
    expect(threeQuarterPressure?.intent).toBe('pressure')
    expect(threeQuarterPressure?.tags).toContain('transition')
  })

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

  it('supports desiredKind control with solo-volume drills', () => {
    const selection = selectSquashDrills({
      phase: 'taper',
      fatigueLevel: 5,
      competitionSoon: false,
      goal: 'timing y precision',
      recentDrills: [],
      desiredKind: 'control',
    })

    expect(selection.sessionKind).toBe('control')
    expect(selection.drills.some((drill) => drill.name === '100 drops solo' || drill.name === '100 paralelas de fondo')).toBe(true)
    expect(selection.drills.some((drill) => drill.notes?.includes('100 reps'))).toBe(true)
  })

  it('supports desiredKind mixed-shadows-control with grouped blocks', () => {
    const selection = selectSquashDrills({
      phase: 'base',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'pies y control',
      recentDrills: [],
      desiredKind: 'mixed-shadows-control',
    })

    expect(selection.sessionKind).toBe('mixed')
    expect(selection.blocks?.map((block) => block.kind)).toEqual(['shadows', 'control'])
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
          'Partido de entrenamiento al mejor de 3 games',
          'Partido con foco de ataque en puntos cortos',
        ].includes(drill.name),
      ),
    ).toBe(true)
    expect(
      [
        'Partido de entrenamiento libre a 5 games',
        'Partido de entrenamiento al mejor de 3 games',
        'Partido con foco de ataque en puntos cortos',
      ].includes(selection.drills[selection.drills.length - 1]!.name),
    ).toBe(true)
    expect(selection.sessionKind).toBe('mixed')
    expect(selection.blocks?.[selection.blocks.length - 1]?.kind).toBe('match')
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
      'Partido de entrenamiento al mejor de 3 games',
      'Partido con foco de ataque en puntos cortos',
    ])

    expect(taperSelection.drills.some((drill) => practiceMatchNames.has(drill.name))).toBe(false)
    expect(fatigueSelection.drills.some((drill) => practiceMatchNames.has(drill.name))).toBe(false)
  })

  it('rotates away from practice match when recent match-play exposure is already high', () => {
    const selection = selectSquashDrills({
      phase: 'peak',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar rendimiento en partido y manejo de presion',
      recentDrills: [],
      historicalSessions: [
        makePracticeMatchSession('2026-04-09'),
        makePracticeMatchSession('2026-04-07'),
        makeSquashSession('2026-04-05', 'Drives paralelos a profundidad'),
      ],
    })

    expect(
      selection.drills.some((drill) =>
        [
          'Partido de entrenamiento libre a 5 games',
          'Partido de entrenamiento al mejor de 3 games',
          'Partido con foco de ataque en puntos cortos',
        ].includes(drill.name),
      ),
    ).toBe(false)
  })

  it('matches drill names fuzzily for AI-generated variations', () => {
    expect(findSquashDrillByName('Parallel drives')?.id).toBe('drive_parallel_depth')
    expect(findSquashDrillByName('Drives paralelos')?.id).toBe('drive_parallel_depth')
    expect(findSquashDrillByName('Defensive lob recovery')?.id).toBe('defensive_high_lob_recovery')
  })

  it('keeps peak selection focused on high-value peak drills instead of recovery fillers', () => {
    const selection = selectSquashDrills({
      phase: 'peak',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'presion y partido',
      recentDrills: [],
    })

    expect(selection.drills.some((drill) => drill.name === 'RecuperaciÃƒÂ³n tÃƒÂ©cnica con largo controlado')).toBe(false)
    expect(selection.drills.some((drill) => drill.name.includes('Partido') || drill.name.includes('presi'))).toBe(true)
  })

  it('derives progression focus from the whole recent session instead of only the first drill', () => {
    const state = deriveSquashProgressionState({
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'presion',
      recentDrills: [],
      historicalSessions: [{
        ...makeSquashSession('2026-04-10', 'Drives paralelos a profundidad'),
        squashDetails: {
          trainingFocus: 'technical',
          drills: [
            { name: 'Drives paralelos a profundidad', durationMin: 10 },
            { name: 'PresiÃƒÂ³n a esquinas de fondo', durationMin: 10 },
            { name: 'Juego condicionado sin segundos botes', durationMin: 10 },
          ],
        },
      }],
    })

    expect(state.targetFocus).toBeDefined()
  })

  it('classifies split step recovery as footwork family', () => {
    const drill = findSquashDrillByName('Split step y recuperaciÃƒÂ³n al T')
    expect(drill).toBeTruthy()
    expect(getSquashDrillFamily(drill!)).toBe('footwork')
  })

  it('maps finishing drills into a dedicated family', () => {
    const nickDrill = findSquashDrillByName('Cierre al nick bajo presiÃ³n')
    const angleDrill = findSquashDrillByName('DefiniciÃ³n con Ã¡ngulo en zona delantera')

    expect(nickDrill?.intent).toBe('finishing')
    expect(angleDrill?.intent).toBe('finishing')
    expect(getSquashDrillFamily(nickDrill!)).toBe('finishing')
    expect(getSquashDrillFamily(angleDrill!)).toBe('finishing')
  })

  it('can include aerobic base movement drills in base selection when the context favors low-risk work', () => {
    const selection = selectSquashDrills({
      phase: 'base',
      fatigueLevel: 7,
      competitionSoon: false,
      goal: 'base aerobica y movimiento especifico',
      recentDrills: [],
    })

    expect(
      selection.drills.some((drill) =>
        drill.name.includes('Intervalos extensivos') ||
        (drill.name.includes('Base continua') && drill.name.includes('squash')),
      ),
    ).toBe(true)
  })

  it('keeps aerobic base drills out of peak and taper selections', () => {
    const peakSelection = selectSquashDrills({
      phase: 'peak',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'presion y partido',
      recentDrills: [],
    })
    const taperSelection = selectSquashDrills({
      phase: 'taper',
      fatigueLevel: 5,
      competitionSoon: false,
      goal: 'timing y frescura',
      recentDrills: [],
    })
    const aerobicBaseNames = new Set([
      'Base continua de movimiento especÃ­fico de squash',
      'Intervalos extensivos de movimiento aerÃ³bico',
    ])

    expect(peakSelection.drills.some((drill) => aerobicBaseNames.has(drill.name))).toBe(false)
    expect(taperSelection.drills.some((drill) => aerobicBaseNames.has(drill.name))).toBe(false)
  })

  it('includes the first constraint in progression notes when a drill provides one', () => {
    const drill = findSquashDrillByName('Intervalos extensivos de movimiento aerÃ³bico')
    const notes = buildProgressedDrillNotes(drill!, {
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar base fisica',
      recentDrills: [],
      historicalSessions: [makeSquashSession('2026-04-08', 'Base continua de movimiento especÃ­fico de squash')],
    })

    expect(notes).toContain('Mantener el mismo ritmo')
  })

  it('still returns a valid note for drills without constraints', () => {
    const drill = findSquashDrillByName('Drives cruzados con longitud')
    const notes = buildProgressedDrillNotes(drill!, {
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar drive',
      recentDrills: [],
    })

    expect(notes.length).toBeGreaterThan(0)
  })
})
