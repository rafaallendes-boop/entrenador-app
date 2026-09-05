import { describe, expect, it } from 'vitest'
import { selectRecalibrationTargets } from '../planRecalibration'
import { makePlan, makeWeek } from './helpers/repairTestFixtures'

const weeks = [
  makeWeek({ weekIndex: 0, weekStartDate: '2026-09-07' }),
  makeWeek({ weekIndex: 1, weekStartDate: '2026-09-14' }),
  makeWeek({ weekIndex: 2, weekStartDate: '2026-09-21' }),
  makeWeek({ weekIndex: 3, weekStartDate: '2026-09-28' }),
]

describe('selectRecalibrationTargets', () => {
  it('devuelve sólo las semanas estrictamente futuras', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    const target = selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-16' })

    expect(target?.weekIndexes).toEqual([2, 3])
    expect(target?.asOfDate).toBe('2026-09-16')
    // `livedWeekCount` cuenta sólo semanas COMPLETAS (`weekStartDate <
    // currentWeekStart`): la semana en curso (weekIndex 1, arranca
    // 2026-09-14, igual al lunes de "hoy" 2026-09-16) no cuenta. Tiene que
    // coincidir con `buildPlanBuilderRecentContext`, que puebla
    // `livedPlanWeeks` con `while (cursor < referenceWeekStart)` y por lo
    // tanto tampoco incluye la semana en curso.
    expect(target?.livedWeekCount).toBe(1)
  })

  it('nunca incluye la semana en curso', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    const target = selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-21' })
    expect(target?.weekIndexes).toEqual([3])
  })

  it('devuelve null si no queda ninguna semana futura', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-30' })).toBeNull()
  })

  it('devuelve null antes de que el plan empiece: no hay nada vivido', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-01' })).toBeNull()
  })

  it('devuelve null para un plan que no está activo', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'draft' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-16' })).toBeNull()
  })

  it('devuelve null si no hay al menos una semana completa vivida', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-09' })).toBeNull()
  })
})
