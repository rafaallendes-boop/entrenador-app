import { describe, expect, it } from 'vitest'
import { athleteToRow, rowToAthlete } from '../../athleteRows'

const athlete = {
  id: 'ath_u1',
  ownerAccountId: 'u1',
  linkedAccountId: 'u1',
  displayName: null,
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}

describe('athleteRows mappers', () => {
  it('round-trips camelCase <-> snake_case', () => {
    const row = athleteToRow(athlete)
    expect(row.owner_account_id).toBe('u1')
    expect(row.id).toBe('ath_u1')
    expect(rowToAthlete(row)).toEqual(athlete)
  })

  it('coerces undefined linked/display to null in the row', () => {
    const row = athleteToRow({ ...athlete, linkedAccountId: undefined, displayName: undefined })
    expect(row.linked_account_id).toBeNull()
    expect(row.display_name).toBeNull()
  })
})
