import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import { groupSessionsByDay, sessionStatusLabel } from '../planningWeek'

describe('sessionStatusLabel', () => {
  it('cubre los cuatro estados de sesion', () => {
    expect(sessionStatusLabel('planned')).toBe('Planificada')
    expect(sessionStatusLabel('completed')).toBe('Completada')
    expect(sessionStatusLabel('adjusted')).toBe('Ajustada')
    expect(sessionStatusLabel('skipped')).toBe('Saltada')
  })
})

describe('groupSessionsByDay', () => {
  it('devuelve siete dias y agrupa cada sesion por fecha', () => {
    const sessions = [
      { id: 'a', date: '2026-07-14', timeBlock: 'am' },
      { id: 'b', date: '2026-07-14', timeBlock: 'pm' },
      { id: 'c', date: '2026-07-19', timeBlock: 'am' },
    ] as Session[]

    const grouped = groupSessionsByDay(sessions, '2026-07-13')

    expect(grouped).toHaveLength(7)
    expect(grouped[0]).toMatchObject({ date: '2026-07-13', sessions: [] })
    expect(grouped[1].sessions.map((session) => session.id)).toEqual(['a', 'b'])
    expect(grouped[6].sessions.map((session) => session.id)).toEqual(['c'])
  })
})
