import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { invalidateStrengthSafetyFinalizations } from '../dataExport'

describe('sellos de seguridad en el backup', () => {
  // `repairWeek` escribe el sello dentro de la metadata de cada sesión de
  // fuerza de una semana de plan. Exportar esa tabla en crudo contradice la
  // regla declarada ("import/export elimina TODO sello local"), aunque el
  // import sí lo limpie: el archivo de backup no debe contener autorizaciones
  // locales que no valen fuera de este dispositivo.
  it('el helper elimina sellos anidados en semanas de plan', () => {
    const week = {
      id: 'week-1',
      sessions: [
        {
          type: 'strength',
          metadata: { strengthSafetyFinalization: { hash: 'abc', policyVersion: 1 }, other: 'ok' },
        },
      ],
    }
    const stripped = invalidateStrengthSafetyFinalizations(week)
    expect(JSON.stringify(stripped)).not.toContain('strengthSafetyFinalization')
    expect(JSON.stringify(stripped)).toContain('"other":"ok"')
  })

  it('la tabla trainingPlanWeeks se exporta saneada', () => {
    const source = readFileSync('src/services/dataExport.ts', 'utf8')
    expect(source).toMatch(/trainingPlanWeeks: trainingPlanWeeks\.map\(invalidateStrengthSafetyFinalizations\)/)
  })
})
