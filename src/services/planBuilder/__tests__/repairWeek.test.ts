import { describe, expect, it } from 'vitest'

import { buildSquashMatchDrills } from '../repairWeek'

describe('buildSquashMatchDrills variety', () => {
  const session = { durationMin: 60 } as never
  it('rotates the competition match pair across consecutive sessions', () => {
    const a = buildSquashMatchDrills(session, 'competition_match', 0).map((d) => d.name)
    const b = buildSquashMatchDrills(session, 'competition_match', 1).map((d) => d.name)
    expect(a).not.toEqual(b)
  })
})
