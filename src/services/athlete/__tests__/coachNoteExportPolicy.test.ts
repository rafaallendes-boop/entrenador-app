import { describe, expect, it } from 'vitest'
import type { AthleteMembership } from '../../../types'
import { canExportCoachNotesFor } from '../coachNoteExportPolicy'

const membership = (athleteId: string, accountId: string, role: 'self' | 'coach'): AthleteMembership => ({
  athleteId, accountId, role, createdAt: 1, updatedAt: 1,
})

describe('canExportCoachNotesFor', () => {
  it('allows legacy, coaches, and a self without an external coach', () => {
    expect(canExportCoachNotesFor('a', 'u1', [])).toBe(true)
    expect(canExportCoachNotesFor('a', 'c1', [membership('a', 'c1', 'coach')])).toBe(true)
    expect(canExportCoachNotesFor('a', 'u1', [membership('a', 'u1', 'self')])).toBe(true)
  })

  it('blocks a claimed self from exporting an external coach note', () => {
    expect(canExportCoachNotesFor('a', 'u1', [
      membership('a', 'u1', 'self'), membership('a', 'c1', 'coach'),
    ])).toBe(false)
  })
})
