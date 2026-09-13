import { describe, expect, it } from 'vitest'
import { decideLoadDirective } from '../../training/loadDirectivePolicy'
import { buildWeekCreatorExecutionSignals } from '../weekCreatorExecutionSignals'

describe('buildWeekCreatorExecutionSignals', () => {
  it('transporta dolor declarado y la directiva resuelve reduce', () => {
    const signals = buildWeekCreatorExecutionSignals(
      { currentFatigue: 'normal' },
      [],
      [{ id: 'log-1', date: '2026-07-19', painLevel: 8, updatedAt: 0 }],
    )
    expect(signals.latestPainLevel).toBe(8)
    expect(signals.declaredFatigue).toBe('normal')
    expect(decideLoadDirective(signals).verdict).toBe('reduce')
  })

  it('excluye energía prellenada por Whoop pero conserva el dolor', () => {
    const signals = buildWeekCreatorExecutionSignals(
      { currentFatigue: 'normal' },
      [],
      [{ id: 'log-1', date: '2026-07-19', energyLevel: 3, painLevel: 2, prefillSource: { energyLevel: 'whoop' }, updatedAt: 0 }],
    )
    expect(signals.latestEnergyLevel).toBeUndefined()
    expect(signals.latestPainLevel).toBe(2)
    expect(decideLoadDirective(signals).verdict).toBe('no_signal')
  })

  it('usa el log más reciente (último del arreglo ascendente), no el primero', () => {
    const signals = buildWeekCreatorExecutionSignals(
      { currentFatigue: 'normal' },
      [],
      [
        { id: 'log-old', date: '2026-07-13', painLevel: undefined, energyLevel: 5, updatedAt: 0 },
        { id: 'log-new', date: '2026-07-19', painLevel: 8, energyLevel: 2, updatedAt: 0 },
      ],
    )
    expect(signals.latestPainLevel).toBe(8)
    expect(signals.latestEnergyLevel).toBe(2)
  })

  it('cuenta sólo RPE reales de sesiones ejecutadas', () => {
    const signals = buildWeekCreatorExecutionSignals(
      { currentFatigue: 'normal' },
      [
        { id: 's1', date: '2026-07-13', weekStartDate: '2026-07-13', timeBlock: 'AM', type: 'squash', status: 'completed', title: 'A', durationMin: 60, actualRpe: 9, createdAt: 0, updatedAt: 0 },
        { id: 's2', date: '2026-07-14', weekStartDate: '2026-07-13', timeBlock: 'AM', type: 'squash', status: 'planned', title: 'B', durationMin: 60, actualRpe: 9, createdAt: 0, updatedAt: 0 },
      ],
      [],
    )
    expect(signals.rpeSampleCount).toBe(1)
    expect(signals.avgActualRpe).toBe(9)
  })
})
