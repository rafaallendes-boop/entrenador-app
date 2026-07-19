import { describe, expect, it } from 'vitest'
import { buildPullFilter } from '../syncSupabase'

describe('buildPullFilter', () => {
  it('pulls athlete rows and child rows through memberships', () => {
    expect(buildPullFilter('athletes', 'u1', ['a', 'b'], { mode: 'legacy' })).toEqual({
      kind: 'or', value: 'id.in.(a,b),owner_account_id.eq.u1',
    })
    expect(buildPullFilter('sessions', 'u1', ['a', 'b'], { mode: 'legacy' })).toEqual({
      kind: 'or', value: 'athlete_id.in.(a,b),and(athlete_id.is.null,user_id.eq.u1)',
    })
  })

  it('keeps the legacy fallback and skips membership-only tables without scope', () => {
    expect(buildPullFilter('sessions', 'u1', [], { mode: 'legacy' })).toEqual({ kind: 'eq_user' })
    expect(buildPullFilter('athlete_coach_notes', 'u1', [], { mode: 'legacy' })).toEqual({ kind: 'skip' })
  })

  it('always filters session templates by user_id, even with memberships', () => {
    expect(buildPullFilter('session_templates', 'u1', ['a', 'b'], { mode: 'legacy' }))
      .toEqual({ kind: 'eq_user' })
    expect(buildPullFilter('session_templates', 'u1', [], { mode: 'athlete', athleteId: 'a' }))
      .toEqual({ kind: 'eq_user' })
  })
})
