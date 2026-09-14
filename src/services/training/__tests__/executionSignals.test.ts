import { describe, expect, it } from 'vitest'
import type { DayLog, Session } from '../../../types'
import { buildExecutionSignals, previousWeekWindowStart } from '../executionSignals'
import { decideLoadDirective } from '../loadDirectivePolicy'
import { captureSources, deriveSlotContext } from '../slotContext'

const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026
const SLOT = { date: '2026-09-16', timeBlock: 'PM' as const }

function session(id: string, date: string, status: Session['status'], extra: Partial<Session> = {}): Session {
  return { id, date, weekStartDate: date, timeBlock: 'AM', type: 'squash', status, title: id, durationMin: 60, createdAt: 0, updatedAt: 0, ...extra } as Session
}
function log(id: string, date: string, extra: Partial<DayLog> = {}): DayLog {
  return { id, date, updatedAt: 0, ...extra }
}
function slotContext(sessions: Session[], dayLogs: DayLog[]) {
  return deriveSlotContext(captureSources({ scope: { athleteId: 'a', epoch: 0, requestId: 'r' }, now: NOW, profile: undefined, sessions, dayLogs }), SLOT)
}

describe('buildExecutionSignals', () => {
  it('dolor declarado resuelve reduce y conserva la fatiga declarada', () => {
    const { signals, provenance } = buildExecutionSignals(slotContext([], [log('l', '2026-09-15', { painLevel: 8 })]), { declaredFatigue: 'normal' })
    expect(signals).toMatchObject({ latestPainLevel: 8, declaredFatigue: 'normal' })
    expect(provenance.latestPainLevel).toEqual({ source: 'day_log', date: '2026-09-15', sampleSize: 1 })
    expect(decideLoadDirective(signals).verdict).toBe('reduce')
  })

  it('energía: excluye el prefill Whoop y usa el último registro manual con valor', () => {
    const { signals, provenance } = buildExecutionSignals(slotContext([], [
      log('old', '2026-09-13', { energyLevel: 5 }),
      log('whoop', '2026-09-15', { energyLevel: 2, prefillSource: { energyLevel: 'whoop' } }),
    ]))
    expect(signals.latestEnergyLevel).toBe(5)
    expect(provenance.latestEnergyLevel?.date).toBe('2026-09-13')
  })

  it('RPE: sesiones ejecutadas + day logs manuales, redondeado a un decimal', () => {
    const { signals, provenance } = buildExecutionSignals(slotContext([
      session('done', '2026-09-14', 'completed', { actualRpe: 8 }),
      session('planned', '2026-09-14', 'planned', { actualRpe: 9 }),
    ], [
      log('manual', '2026-09-15', { rpeActual: 7 }),
      log('whoop', '2026-09-13', { rpeActual: 10, prefillSource: { rpeActual: 'whoop' } }),
    ]))
    expect(signals.rpeSampleCount).toBe(2)
    expect(signals.avgActualRpe).toBe(7.5)
    expect(provenance.avgActualRpe).toEqual({ source: 'day_log+session', date: '2026-09-15', sampleSize: 2 })
  })

  it('la ventana descarta lo anterior a windowStart', () => {
    const { signals } = buildExecutionSignals(slotContext([
      session('old', '2026-09-01', 'completed', { actualRpe: 10 }),
    ], [log('old-log', '2026-09-01', { painLevel: 9 })]), { windowStart: '2026-09-09' })
    expect(signals.rpeSampleCount).toBe(0)
    expect(signals.latestPainLevel).toBeUndefined()
  })

  it('adherencia: una planificada que todavía no vence no cuenta como perdida', () => {
    const { signals } = buildExecutionSignals(slotContext([
      session('done', '2026-09-14', 'completed'),
      session('skipped', '2026-09-15', 'skipped'),
      session('missed', '2026-09-15', 'planned'),
      session('today-planned', '2026-09-16', 'planned'),
    ], []))
    expect(signals.adherencePct).toBe(33)
  })

  it('I9: la ventana arranca el lunes de la semana anterior a la del ancla', () => {
    expect(previousWeekWindowStart('2026-09-16')).toBe('2026-09-07') // miércoles
    expect(previousWeekWindowStart('2026-09-14')).toBe('2026-09-07') // lunes
    expect(previousWeekWindowStart('2026-09-20')).toBe('2026-09-07') // domingo
  })

  it('nada posterior al slot alimenta señales', () => {
    const { signals } = buildExecutionSignals(slotContext([
      session('future', '2026-09-17', 'completed', { actualRpe: 10 }),
    ], [log('future-log', '2026-09-17', { painLevel: 9 })]))
    expect(signals.rpeSampleCount).toBe(0)
    expect(signals.latestPainLevel).toBeUndefined()
    expect(decideLoadDirective(signals).verdict).toBe('no_signal')
  })
})
