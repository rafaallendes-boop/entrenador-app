import { getPlannedSessions, getHistoricalSessions } from '../../ai/promptModules/shared'
import { expect, it } from 'vitest'
import { getExecutedSessions } from '../executedSessions'
import { deriveSquashProgressionState } from '../drillSelector'
import type { Session } from '../../../types'

it('incluye adjusted, excluye planned/skipped y futuro con fecha explícita', () => {
  const rows = ['completed', 'adjusted', 'planned', 'skipped'].map(status => ({ status, date: '2026-06-01', timeBlock: 'AM' })) as Session[]
  expect(getExecutedSessions([...rows, { ...rows[0], date: '2026-06-04' }], '2026-06-03').map(s => s.status)).toEqual(['completed', 'adjusted'])
})

it('squash cuenta una familia una vez por sesión ejecutada', () => {
  const session = { status: 'adjusted', type: 'squash', date: '2026-06-01', timeBlock: 'AM',
    squashDetails: { drills: [{ name: 'Drives paralelos profundos' }, { name: 'Drives cruzados profundos' }, { name: 'Drives paralelos profundos' }] } } as Session
  const context = { fatigueLevel: 4, phase: 'build' as const, goal: '', recentDrills: [], competitionSoon: false, referenceDate: '2026-06-03', historicalSessions: [session] }
  const state = deriveSquashProgressionState(context)
  expect(Object.keys(state.families)).toHaveLength(1)
  expect(Object.values(state.families).every(f => f.frequency === 1)).toBe(true)
  expect(deriveSquashProgressionState({ ...context, historicalSessions: [{ ...session, status: 'skipped' }] }).families).toEqual({})
})

it('el contexto no mezcla exposición futura con ejecución ni sesiones omitidas', () => {
  const rows = ['planned', 'completed', 'adjusted', 'skipped'].map(status => ({ id: status, status, date: '2026-09-09', timeBlock: 'AM' })) as Session[]
  expect(getPlannedSessions({ recentSessions: rows, plannedSessions: rows }, '2026-09-08').map(s => s.status)).toEqual(['planned'])
  expect(getHistoricalSessions({ recentSessions: rows }, '2026-09-08')).toEqual([])
  expect(getHistoricalSessions({ recentSessions: rows }, '2026-09-10').map(s => s.status)).toEqual(['completed', 'adjusted'])
})
