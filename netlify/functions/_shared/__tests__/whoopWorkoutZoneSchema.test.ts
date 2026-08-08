import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { WHOOP_WORKOUT_ZONE_COLUMNS } from '../../../../src/services/readiness/whoopZoneDurations'

const MIGRATION = readFileSync(
  new URL('../../../../supabase/019_whoop_workout_zones.sql', import.meta.url),
  'utf8',
)

/**
 * Las aserciones corren sobre el SQL SIN comentarios. El encabezado de `019`
 * explica por qué las restricciones se agregan sin validación diferida, y
 * cualquier redacción futura de esa nota podría volver a nombrar la cláusula que
 * este guard exige ausente: buscarla en el archivo crudo haría que la prosa que
 * documenta la ausencia rompiera el test.
 *
 * `019` tiene un literal de texto (`'SCORED'`), pero ninguno contiene `--`, que
 * es la condición que esta regex necesita: recorta desde `--` hasta el fin de
 * línea sin distinguir contexto.
 */
const SQL = MIGRATION.replace(/--[^\n]*/g, '')

describe('019_whoop_workout_zones', () => {
  it('crea exactamente las columnas que el código usa', () => {
    const created = [...SQL.matchAll(/add column if not exists\s+(\w+)/g)]
      .map((match) => match[1])
      .sort()
    expect(created).toEqual([...WHOOP_WORKOUT_ZONE_COLUMNS].sort())
  })

  it('declara las cinco restricciones nombradas', () => {
    for (const name of [
      'whoop_workouts_zones_all_or_none',
      'whoop_workouts_zones_non_negative',
      'whoop_workouts_zones_positive_total',
      'whoop_workouts_percent_recorded_range',
      'whoop_workouts_score_data_requires_scored',
    ]) {
      expect(SQL).toContain(`add constraint ${name}`)
    }
  })

  it('no usa `not valid`: la validación inmediata no puede fallar', () => {
    expect(SQL.toLowerCase()).not.toContain('not valid')
  })
})
