import { describe, expect, it } from 'vitest'
import type { Session } from '../../types'
import { resolveVisibleSessionsAfterUpdate, shouldKeepDayLogInVisibleWeek } from '../useTrainingStore'

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 'session-1',
    date: partial.date ?? '2026-04-07',
    weekStartDate: partial.weekStartDate ?? '2026-04-06',
    timeBlock: partial.timeBlock ?? 'AM',
    type: partial.type ?? 'running',
    status: partial.status ?? 'planned',
    title: partial.title ?? 'Rodaje Z2',
    durationMin: partial.durationMin ?? 45,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

describe('useTrainingStore visibility helpers', () => {
  it('removes a session from the visible week when it moves to another week', () => {
    const visible = [
      makeSession({ id: 's1', weekStartDate: '2026-04-06' }),
      makeSession({ id: 's2', date: '2026-04-08', weekStartDate: '2026-04-06' }),
    ]

    const updated = makeSession({
      id: 's1',
      date: '2026-04-14',
      weekStartDate: '2026-04-13',
    })

    expect(resolveVisibleSessionsAfterUpdate(visible, updated, '2026-04-06')).toEqual([visible[1]])
  })

  it('adds a session to the visible week when an update moves it in', () => {
    const visible = [makeSession({ id: 's2', date: '2026-04-08', weekStartDate: '2026-04-06' })]
    const updated = makeSession({
      id: 's1',
      date: '2026-04-09',
      weekStartDate: '2026-04-06',
    })

    const next = resolveVisibleSessionsAfterUpdate(visible, updated, '2026-04-06')
    expect(next.map((session) => session.id).sort()).toEqual(['s1', 's2'])
  })

  it('only keeps day logs that belong to the loaded week', () => {
    expect(shouldKeepDayLogInVisibleWeek('2026-04-07', '2026-04-06')).toBe(true)
    expect(shouldKeepDayLogInVisibleWeek('2026-04-14', '2026-04-06')).toBe(false)
    expect(shouldKeepDayLogInVisibleWeek('2026-04-07', null)).toBe(false)
  })
})
