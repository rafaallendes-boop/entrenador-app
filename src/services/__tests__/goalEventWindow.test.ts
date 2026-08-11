import { describe, expect, it } from 'vitest'

import type { GoalEvent } from '../../types'
import {
  formatGoalEventKeyDate,
  formatGoalEventWindow,
  goalEventWindowFromMacroPlan,
  isWithinGoalEventWindow,
  resolveGoalEventWindow,
  validateGoalEventWindow,
} from '../goalEventWindow'

/**
 * Task B0 — fixtures de calendario. Fijan la semántica de la ventana antes de
 * que el shell, el macro o el repair la consuman. Toda comparación posterior
 * debe pasar por este resolver: ningún consumidor interpreta `.date` por su
 * cuenta.
 */
function event(partial: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: 'evt-1',
    title: 'Campeonato',
    date: '2026-09-07',
    sport: 'squash',
    priority: 'primary',
    ...partial,
  }
}

describe('resolveGoalEventWindow', () => {
  it('trata un evento sin término como un evento de un día', () => {
    expect(resolveGoalEventWindow(event())).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-07',
      keyDate: undefined,
    })
  })

  it('conserva un rango lunes–domingo con día clave el jueves', () => {
    expect(resolveGoalEventWindow(event({
      date: '2026-09-07',
      endDate: '2026-09-13',
      keyDate: '2026-09-10',
    }))).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
      keyDate: '2026-09-10',
    })
  })

  it('conserva un rango que cruza dos semanas calendario', () => {
    // Sábado a martes: la ventana no puede recortarse al límite de semana.
    expect(resolveGoalEventWindow(event({
      date: '2026-09-12',
      endDate: '2026-09-15',
    }))).toMatchObject({
      startDate: '2026-09-12',
      endDate: '2026-09-15',
    })
  })

  it('degrada a evento de un día cuando el término precede al inicio', () => {
    // Dato corrupto o backup manipulado: el resolver es camino de lectura y no
    // puede lanzar. La UI lo rechaza antes de guardar vía validate.
    expect(resolveGoalEventWindow(event({
      date: '2026-09-07',
      endDate: '2026-09-01',
    }))).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-07',
      keyDate: undefined,
    })
  })

  it('descarta un día clave fuera de la ventana sin perder el rango', () => {
    expect(resolveGoalEventWindow(event({
      date: '2026-09-07',
      endDate: '2026-09-13',
      keyDate: '2026-09-20',
    }))).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
      keyDate: undefined,
    })
  })

  it('descarta fechas no ISO en lugar de propagarlas', () => {
    expect(resolveGoalEventWindow(event({
      date: '2026-09-07',
      endDate: '13-09-2026',
      keyDate: 'jueves',
    }))).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-07',
      keyDate: undefined,
    })
  })
})

describe('isWithinGoalEventWindow', () => {
  const multiDay = event({ date: '2026-09-07', endDate: '2026-09-13' })

  it('incluye ambos extremos', () => {
    expect(isWithinGoalEventWindow(multiDay, '2026-09-07')).toBe(true)
    expect(isWithinGoalEventWindow(multiDay, '2026-09-13')).toBe(true)
  })

  it('reconoce un día interior del campeonato', () => {
    expect(isWithinGoalEventWindow(multiDay, '2026-09-10')).toBe(true)
  })

  it('excluye el día posterior al término', () => {
    expect(isWithinGoalEventWindow(multiDay, '2026-09-14')).toBe(false)
  })

  it('excluye el día previo al inicio', () => {
    expect(isWithinGoalEventWindow(multiDay, '2026-09-06')).toBe(false)
  })

  it('un evento de un día sólo contiene su propia fecha', () => {
    const single = event({ date: '2026-09-07' })
    expect(isWithinGoalEventWindow(single, '2026-09-07')).toBe(true)
    expect(isWithinGoalEventWindow(single, '2026-09-08')).toBe(false)
  })
})

describe('validateGoalEventWindow', () => {
  it('acepta un evento de un día', () => {
    expect(validateGoalEventWindow(event())).toEqual([])
  })

  it('acepta un rango con día clave interior', () => {
    expect(validateGoalEventWindow(event({
      endDate: '2026-09-13',
      keyDate: '2026-09-10',
    }))).toEqual([])
  })

  it('rechaza un término anterior al inicio', () => {
    expect(validateGoalEventWindow(event({ endDate: '2026-09-01' })))
      .toContainEqual(expect.objectContaining({ field: 'endDate' }))
  })

  it('rechaza un día clave fuera del rango', () => {
    expect(validateGoalEventWindow(event({
      endDate: '2026-09-13',
      keyDate: '2026-09-20',
    }))).toContainEqual(expect.objectContaining({ field: 'keyDate' }))
  })

  it('rechaza fechas mal formadas', () => {
    const issues = validateGoalEventWindow(event({ date: '07/09/2026', endDate: 'mañana' }))
    expect(issues.map((issue) => issue.field)).toContain('date')
    expect(issues.map((issue) => issue.field)).toContain('endDate')
  })

  it('un día clave sin término se valida contra el evento de un día', () => {
    expect(validateGoalEventWindow(event({ keyDate: '2026-09-08' })))
      .toContainEqual(expect.objectContaining({ field: 'keyDate' }))
  })
})

describe('formatGoalEventWindow', () => {
  it('un evento de un día muestra la fecha completa', () => {
    expect(formatGoalEventWindow(event({ date: '2026-09-09' }))).toBe('9 sep 2026')
  })

  it('un rango dentro del mismo mes no repite mes ni año', () => {
    expect(formatGoalEventWindow(event({
      date: '2026-09-05', endDate: '2026-09-11',
    }))).toBe('5–11 sep 2026')
  })

  it('un rango que cruza de mes repite el mes pero no el año', () => {
    expect(formatGoalEventWindow(event({
      date: '2026-08-29', endDate: '2026-09-02',
    }))).toBe('29 ago – 2 sep 2026')
  })

  it('un rango que cruza de año muestra ambos años', () => {
    expect(formatGoalEventWindow(event({
      date: '2026-12-29', endDate: '2027-01-02',
    }))).toBe('29 dic 2026 – 2 ene 2027')
  })

  it('una ventana inválida se muestra como el evento de un día que el resolver resuelve', () => {
    expect(formatGoalEventWindow(event({
      date: '2026-09-09', endDate: '2026-09-01',
    }))).toBe('9 sep 2026')
  })
})

describe('formatGoalEventKeyDate', () => {
  it('describe el día clave sin repetir el año', () => {
    expect(formatGoalEventKeyDate(event({
      date: '2026-09-05', endDate: '2026-09-11', keyDate: '2026-09-09',
    }))).toBe('Día clave: 9 sep')
  })

  it('no describe nada cuando no hay día clave utilizable', () => {
    expect(formatGoalEventKeyDate(event({
      date: '2026-09-05', endDate: '2026-09-11', keyDate: '2026-10-01',
    }))).toBeUndefined()
    expect(formatGoalEventKeyDate(event({ date: '2026-09-05' }))).toBeUndefined()
  })
})

describe('goalEventWindowFromMacroPlan', () => {
  const base = {
    goalEventId: 'evt-1',
    currentPhase: 'peak' as const,
    weeksRemaining: 2,
    blockFocus: 'Afinar',
    headline: 'Afinar',
    timeline: [],
    computedAt: 1,
  }

  it('lee la ventana completa de un snapshot nuevo', () => {
    expect(formatGoalEventWindow(goalEventWindowFromMacroPlan({
      ...base,
      goalEventDate: '2026-09-05',
      goalEventEndDate: '2026-09-11',
      goalEventKeyDate: '2026-09-09',
    }))).toBe('5–11 sep 2026')
  })

  it('un snapshot antiguo sin ventana se lee como evento de un día', () => {
    expect(formatGoalEventWindow(goalEventWindowFromMacroPlan({
      ...base,
      goalEventDate: '2026-09-05',
    }))).toBe('5 sep 2026')
  })
})
