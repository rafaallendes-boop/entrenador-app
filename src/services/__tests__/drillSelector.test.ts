import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import { findSquashDrillByName, getSquashDrillFamily, resolveDrillExecutionMode, SQUASH_DRILL_LIBRARY } from '../training/drillLibrary'
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
      drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 20 }],
    },
  } as Session
}

describe('drillSelector progression', () => {
  it('keeps library ids unique and player-facing metadata coherent', () => {
    const validIntents = new Set(['consistency', 'pressure', 'finishing', 'recovery', 'control'])
    const validPhaseTags = new Set(['base', 'build', 'peak', 'taper'])
    const crypticEnglishTerms = [
      'match-play',
      'games',
      'sets',
      'feedback',
      'sustain',
      'land',
      'rally',
      'rallies',
    ]
    const bannedVisiblePatterns = [
      new RegExp('de' + 'jada', 'i'),
      new RegExp('contra-' + 'de' + 'jada', 'i'),
      /\bEj\s+\d+\b/i,
      new RegExp('Lateralizaci' + '[oó]n', 'i'),
    ]
    const ids = new Set<string>()

    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(ids.has(drill.id)).toBe(false)
      ids.add(drill.id)
      expect(drill.name.trim().length).toBeGreaterThan(0)
      expect(drill.description.trim().length).toBeGreaterThan(0)
      expect(drill.tags.some((tag) => validPhaseTags.has(tag))).toBe(true)

      if (drill.constraints) {
        expect(drill.constraints.length).toBeGreaterThan(0)
        expect(drill.constraints.every((constraint) => constraint.trim().length > 0)).toBe(true)
      }

      const playerFacingText = [drill.name, drill.description, ...(drill.constraints ?? [])].join(' ').toLowerCase()
      for (const pattern of bannedVisiblePatterns) {
        expect(playerFacingText).not.toMatch(pattern)
      }
      const playerFacingTokens = new Set(playerFacingText.split(/[^a-z0-9]+/).filter(Boolean))
      for (const term of crypticEnglishTerms) {
        if (term.includes(' ') || term.includes('-')) {
          expect(playerFacingText).not.toContain(term)
        } else {
          expect(playerFacingTokens.has(term)).toBe(false)
        }
      }

      if (drill.intent) {
        expect(validIntents.has(drill.intent)).toBe(true)
      }
    }
  })

  it('adds the explicit solo/control drill library expected by the new taxonomy', () => {
    const controlNames = [
      '100 drops en solitario (50 por lado)',
      '100 drives desde media cancha',
      '100 drives al cuadro de saque',
      '100 drives paralelos desde el fondo',
      'Drops desde media cancha',
      'Voleas en solitario',
    ]

    for (const name of controlNames) {
      const drill = findSquashDrillByName(name)
      expect(drill).toBeTruthy()
      expect(drill?.tags).toContain('control_session')
    }
  })

  it('includes the new high-intensity squash pressure drills', () => {
    const backCourtPressure = findSquashDrillByName('Juego condicionado solo al fondo (intenso)')
    const threeQuarterPressure = findSquashDrillByName('Ataque desde tres cuartos de cancha')

    expect(backCourtPressure).toBeTruthy()
    expect(backCourtPressure?.intensity).toBe('high')
    expect(backCourtPressure?.intent).toBe('pressure')
    expect(backCourtPressure?.tags).toContain('conditioned_game')

    expect(threeQuarterPressure).toBeTruthy()
    expect(threeQuarterPressure?.intensity).toBe('high')
    expect(threeQuarterPressure?.intent).toBe('pressure')
    expect(threeQuarterPressure?.tags).toContain('transition')
  })

  it('keeps aliases for renamed drill names', () => {
    const aliases = [
      ['RSA corto 10-15s', 'rsa_short_bursts'],
      ['Juego condicionado sin segundos botes', 'conditioned_no_two_bounces'],
      ['Base continua de movimiento específico de squash', 'continuous_squash_movement_base'],
      ['Intervalos extensivos de movimiento aeróbico', 'extensive_aerobic_movement_intervals'],
      ['100 drops solo', 'solo_100_drops'],
      ['Ghosting 4 esquinas', 'ghosting_4_corners'],
      ['Split step y recuperación al T', 'split_step_t_recovery'],
      ['Partido de entrenamiento libre a 5 games', 'practice_match_five_games'],
    ]

    for (const [oldName, id] of aliases) {
      expect(findSquashDrillByName(oldName)?.id).toBe(id)
    }
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
    expect(selection.drills.some((drill) => drill.name === '100 drops en solitario (50 por lado)' || drill.name === '100 drives paralelos desde el fondo')).toBe(true)
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

  it('filters out partner and match drills when squash availability is solo', () => {
    const selection = selectSquashDrills({
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'control tecnico sin partner',
      recentDrills: [],
      desiredKind: 'control',
      partnerAvailability: 'solo',
    })

    expect(selection.drills.length).toBeGreaterThan(0)
    expect(selection.blocks?.length).toBeGreaterThanOrEqual(1)
    expect(selection.drills.every((drill) => {
      const definition = findSquashDrillByName(drill.name)
      const mode = definition ? resolveDrillExecutionMode(definition) : 'either'
      return mode !== 'partner' && mode !== 'match'
    })).toBe(true)
  })

  it('redirects requested match work to a solo-compatible fallback when no partner is available', () => {
    const selection = selectSquashDrills({
      phase: 'peak',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'partido',
      recentDrills: [],
      desiredKind: 'match',
      partnerAvailability: 'solo',
    })

    expect(selection.selectionNote).toContain('requiere partner')
    expect(selection.blocks?.some((block) => block.kind === 'match')).toBe(false)
    expect(selection.drills.every((drill) => drill.executionMode !== 'partner' && drill.executionMode !== 'match')).toBe(true)
  })

  it('returns blocks for non-mixed squash selections too', () => {
    const selection = selectSquashDrills({
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'tecnica de drive',
      recentDrills: [],
      desiredKind: 'technical',
    })

    expect(selection.sessionKind).not.toBe('mixed')
    expect(selection.blocks?.length).toBe(1)
    expect(selection.blocks?.[0]?.kind).toBe(selection.sessionKind)
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
          'Partido de entrenamiento al mejor de 5 juegos',
          'Partido de entrenamiento al mejor de 3 juegos',
          'Partido con ataque temprano',
        ].includes(drill.name),
      ),
    ).toBe(true)
    expect(selection.sessionKind).toBe('mixed')
    expect(selection.blocks?.[selection.blocks.length - 1]?.kind).toBe('match')
    expect(
      selection.blocks?.[selection.blocks.length - 1]?.drills.some((drill) =>
        [
          'Partido de entrenamiento al mejor de 5 juegos',
          'Partido de entrenamiento al mejor de 3 juegos',
          'Partido con ataque temprano',
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
      'Partido de entrenamiento al mejor de 5 juegos',
      'Partido de entrenamiento al mejor de 3 juegos',
      'Partido con ataque temprano',
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
          'Partido de entrenamiento al mejor de 5 juegos',
          'Partido de entrenamiento al mejor de 3 juegos',
          'Partido con ataque temprano',
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

    expect(selection.drills.some((drill) => drill.name === 'Largo controlado de baja carga')).toBe(false)
    expect(selection.drills.some((drill) => drill.name.includes('Partido') || drill.name.includes('presionar'))).toBe(true)
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
            { name: 'Presión a esquinas de fondo', durationMin: 10 },
            { name: 'Juego condicionado sin segundos botes', durationMin: 10 },
          ],
        },
      }],
    })

    expect(state.targetFocus).toBeDefined()
  })

  it('classifies split step recovery as footwork family', () => {
    const drill = findSquashDrillByName('Split-step y vuelta a la T')
    expect(drill).toBeTruthy()
    expect(getSquashDrillFamily(drill!)).toBe('footwork')
  })

  it('maps finishing drills into a dedicated family', () => {
    const nickDrill = findSquashDrillByName('Cierre a la esquina baja')
    const angleDrill = findSquashDrillByName('Cierre con ángulo en la zona delantera')

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
        drill.name === 'Intervalos aeróbicos en cancha' ||
        drill.name === 'Movimiento continuo de base aeróbica',
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
      'Movimiento continuo de base aeróbica',
      'Intervalos aeróbicos en cancha',
    ])

    expect(peakSelection.drills.some((drill) => aerobicBaseNames.has(drill.name))).toBe(false)
    expect(taperSelection.drills.some((drill) => aerobicBaseNames.has(drill.name))).toBe(false)
  })

  it('includes the first constraint in progression notes when a drill provides one', () => {
    const drill = findSquashDrillByName('Intervalos aeróbicos en cancha')
    const notes = buildProgressedDrillNotes(drill!, {
      phase: 'build',
      fatigueLevel: 4,
      competitionSoon: false,
      goal: 'mejorar base fisica',
      recentDrills: [],
      historicalSessions: [makeSquashSession('2026-04-08', 'Movimiento continuo de base aeróbica')],
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
