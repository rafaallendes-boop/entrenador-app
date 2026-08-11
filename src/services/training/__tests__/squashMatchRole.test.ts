import { describe, expect, it } from 'vitest'
import type { SquashDetails } from '../../../types'
import {
  hasSquashCompetitiveExposureContent,
  isCompetitiveMatchDrill,
  resolveSquashMatchRole,
  SQUASH_FINISHER_MATCH_IDS,
  SQUASH_STANDALONE_MATCH_ID,
} from '../squashMatchRole'

const FIVE_GAMES = 'Partido de entrenamiento al mejor de 5 juegos'
const BEST_OF_3 = 'Partido de entrenamiento al mejor de 3 juegos'
const GAME_TO_11 = 'Game a 11 con marcador real'
const ACTIVATION = 'Activación pre-partido de manos y pies'
const TECHNICAL = 'Tiros paralelos profundos'

function details(over: Partial<SquashDetails>): SquashDetails {
  return { trainingFocus: 'technical', drills: [], ...over }
}

function finisherDetails(finisherName: string): SquashDetails {
  return details({
    drills: [{ name: TECHNICAL }, { name: finisherName }],
    blocks: [
      { kind: 'technical', drills: [{ name: TECHNICAL }] },
      { kind: 'match', drills: [{ name: finisherName }] },
    ],
  })
}

describe('resolveSquashMatchRole', () => {
  it('reconoce standalone por contenido total, sin necesidad de bloques', () => {
    expect(resolveSquashMatchRole(details({ drills: [{ name: FIVE_GAMES }] }))).toBe('standalone')
  })

  it('reconoce finisher con bloque previo no-match', () => {
    for (const name of [BEST_OF_3, GAME_TO_11]) {
      expect(resolveSquashMatchRole(finisherDetails(name))).toBe('finisher')
    }
  })

  it('no es finisher sin bloques: no se puede demostrar que sea el último', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: BEST_OF_3 }],
    }))).toBe('none')
  })

  it('no es finisher si el bloque de partido no es el último', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: BEST_OF_3 }, { name: TECHNICAL }],
      blocks: [
        { kind: 'match', drills: [{ name: BEST_OF_3 }] },
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
      ],
    }))).toBe('none')
  })

  it('no es finisher sin ningún bloque previo no-match: es un partido dedicado', () => {
    // Un partido que es el único contenido es `standalone`, sea al mejor de 5 o
    // al mejor de 3. Antes devolvía `none`, y eso lo dejaba sin la exención de
    // densificación: se le agregaban drills de acompañamiento hasta volverlo una
    // sesión mixta que nadie declaró, y en taper perdía la activación pre-evento.
    expect(resolveSquashMatchRole(details({
      drills: [{ name: BEST_OF_3 }],
      blocks: [{ kind: 'match', drills: [{ name: BEST_OF_3 }] }],
    }))).toBe('standalone')
  })

  it('no es finisher si hay otro drill competitivo', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: FIVE_GAMES }, { name: BEST_OF_3 }],
      blocks: [
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
        { kind: 'match', drills: [{ name: FIVE_GAMES }, { name: BEST_OF_3 }] },
      ],
    }))).toBe('none')
  })

  it('no es canónico si blocks y drills divergen en orden', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: BEST_OF_3 }],
      blocks: [
        { kind: 'match', drills: [{ name: BEST_OF_3 }] },
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
      ],
    }))).toBe('none')
  })

  it('la activación aislada no es contenido competitivo', () => {
    expect(isCompetitiveMatchDrill({ name: ACTIVATION })).toBe(false)
    expect(resolveSquashMatchRole(details({ drills: [{ name: ACTIVATION }] }))).toBe('none')
  })

  it('los tres IDs de rol son contenido competitivo', () => {
    for (const name of [FIVE_GAMES, BEST_OF_3, GAME_TO_11]) {
      expect(isCompetitiveMatchDrill({ name })).toBe(true)
    }
    expect(SQUASH_STANDALONE_MATCH_ID).toBe('practice_match_five_games')
    expect([...SQUASH_FINISHER_MATCH_IDS]).toEqual([
      'practice_match_best_of_3',
      'match_sim_points_short_sets',
    ])
  })

  it('devuelve none sin details', () => {
    expect(resolveSquashMatchRole(undefined)).toBe('none')
  })
})

describe('hasSquashCompetitiveExposureContent', () => {
  it('es true para standalone y finisher, false para el resto', () => {
    expect(hasSquashCompetitiveExposureContent(details({ drills: [{ name: FIVE_GAMES }] }))).toBe(true)
    expect(hasSquashCompetitiveExposureContent(finisherDetails(BEST_OF_3))).toBe(true)
    expect(hasSquashCompetitiveExposureContent(details({ drills: [{ name: TECHNICAL }] }))).toBe(false)
    expect(hasSquashCompetitiveExposureContent(details({ drills: [{ name: ACTIVATION }] }))).toBe(false)
    expect(hasSquashCompetitiveExposureContent(undefined)).toBe(false)
  })
})
