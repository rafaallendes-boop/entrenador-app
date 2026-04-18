import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Session } from '../../types'
import { generateICS } from '../ics'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-20',
    timeBlock: overrides.timeBlock ?? 'AM',
    type: overrides.type ?? 'running',
    status: overrides.status ?? 'planned',
    title: overrides.title ?? 'Tempo',
    durationMin: overrides.durationMin ?? 45,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  }
}

describe('generateICS', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits DTSTAMP in UTC and escapes description line breaks once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T01:02:03Z'))

    const ics = generateICS([
      makeSession({
        objective: 'Sostener ritmo',
        notes: 'Cerrar fuerte',
      }),
    ])

    expect(ics).toContain('DTSTAMP:20260418T010203Z')
    expect(ics).toContain('DESCRIPTION:Objetivo: Sostener ritmo\\nNotas: Cerrar fuerte\\nDuración: 45min')
    expect(ics).not.toContain('\\\\n')
  })
})
