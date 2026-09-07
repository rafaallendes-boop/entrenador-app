import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard de paridad entre las dos rutas que materializan una sesión.
 *
 * `useCoachActionsStore` (add_session suelta) acepta `mobilityDetails` para
 * `mobility` **y** `recovery`. Si `applyCreateWeek` sólo aceptara `mobility`,
 * la misma sesión mostraría estructura al agregarse suelta y nada al llegar
 * dentro de una semana — y además no podría satisfacer nunca el filtro de
 * sesiones incompletas una vez persistida.
 */
function readSource(relative: string): string {
  return readFileSync(join(process.cwd(), relative), 'utf8')
}

describe('paridad de mobilityDetails entre add_session y create_week', () => {
  it('create_week acepta mobilityDetails también para recovery', () => {
    const source = readSource('src/services/planning/applyCreateWeek.ts')
    const linea = source
      .split('\n')
      .find((line) => line.includes('mobilityDetails:'))

    expect(linea).toBeDefined()
    expect(linea).toContain("'mobility'")
    expect(linea).toContain("'recovery'")
  })

  it('la ruta de add_session sigue aceptando ambos tipos', () => {
    const source = readSource('src/store/useCoachActionsStore.ts')
    expect(source).toMatch(/sessionType === 'mobility' \|\| \w+\.sessionType === 'recovery'/)
  })
})
