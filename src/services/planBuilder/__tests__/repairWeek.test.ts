import { describe, expect, it } from 'vitest'

import { buildSquashMatchDrills } from '../repairWeek'

describe('buildSquashMatchDrills format', () => {
  const session = { durationMin: 60 } as never
  it('keeps competition match-play as one best-of-five match', () => {
    const a = buildSquashMatchDrills(session, 'competition_match', 0).map((d) => d.name)
    const b = buildSquashMatchDrills(session, 'competition_match', 1).map((d) => d.name)
    expect(a).toEqual(['Partido de entrenamiento al mejor de 5 juegos'])
    expect(b).toEqual(a)
  })

  it('keeps practice match-play as one best-of-five match', () => {
    const a = buildSquashMatchDrills(session, 'practice_match', 0).map((d) => d.name)
    const b = buildSquashMatchDrills(session, 'practice_match', 1).map((d) => d.name)
    expect(a).toEqual(['Partido de entrenamiento al mejor de 5 juegos'])
    expect(b).toEqual(a)
  })
})
