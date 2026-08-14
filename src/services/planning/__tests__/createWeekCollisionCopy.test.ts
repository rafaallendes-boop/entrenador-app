import { describe, expect, it } from 'vitest'
import {
  formatCreateWeekCollisionWarning,
  formatCreateWeekPreservedCountWarning,
  formatPlanBuilderCollisionBanner,
} from '../createWeekCollisionCopy'

const collisions = [{ date: '2026-08-17', timeBlock: 'AM' }]

describe('copy de sesiones preservadas al aplicar una semana', () => {
  it('menciona solo historial cuando la ruta reemplaza sesiones manuales planned', () => {
    expect(formatCreateWeekCollisionWarning(collisions, false)).toBe(
      'Se mantuvieron sesiones con historial en: 2026-08-17 AM',
    )
    expect(formatCreateWeekPreservedCountWarning(2, false)).toContain('2 sesiones con historial')
    expect(formatPlanBuilderCollisionBanner(false)).toContain('sesiones con historial')
  })

  it('menciona manuales o historial cuando la ruta preserva manuales planned', () => {
    expect(formatCreateWeekCollisionWarning(collisions, true)).toBe(
      'Se mantuvieron sesiones manuales o con historial en: 2026-08-17 AM',
    )
    expect(formatCreateWeekPreservedCountWarning(2, true)).toContain('2 sesiones manuales o con historial')
    expect(formatPlanBuilderCollisionBanner(true)).toContain('sesiones manuales o con historial')
  })
})
