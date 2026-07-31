import { describe, expect, it } from 'vitest'

import { searchCatalog } from '../coachExerciseCatalog'
import { findSquashDrillByName, SQUASH_DRILL_LIBRARY } from '../drillLibrary'

/** [id, nombre anterior, nombre nuevo] — spec 2026-07-31 §3. */
const RENAMES: Array<[string, string, string]> = [
  ['drive_parallel_depth', 'Tiros paralelos profundos', 'Drives paralelos profundos'],
  ['drive_crosscourt_length', 'Tiros cruzados profundos', 'Drives cruzados profundos'],
  ['drive_switch_parallel_cross', 'Cambio de paralelo a cruzado', 'Alternar drive paralelo y cruzado'],
  ['boast_to_straight_drive', 'Boast y drive paralelo de salida', 'Boast y salida con drive paralelo'],
  ['solo_100_drops', '100 drops en solitario (50 por lado)', 'Drops en solitario — 100 (50 por lado)'],
  ['solo_100_mid_court_shots', '100 drives desde media cancha', 'Drives desde media cancha — 100'],
  ['solo_100_service_box', '100 drives al cuadro de saque', 'Drives al cuadro de saque — 100'],
  ['solo_100_parallels_back', '100 drives paralelos desde el fondo', 'Drives paralelos desde el fondo — 100'],
  ['pressure_three_quarters_court', 'Ataque desde tres cuartos de cancha', 'Ataque temprano antes del fondo'],
  ['conditioned_boast_start', 'Punto que inicia con pared lateral', 'Juego condicionado: el punto abre con boast'],
  ['rsa_short_bursts', 'RSA – sprints repetidos de 10-15 segundos', 'Series cortas de velocidad en cancha (10-15 s)'],
  ['continuous_squash_movement_base', 'Movimiento continuo de base aeróbica', 'Movimiento continuo en cancha a ritmo sostenido'],
  ['extensive_aerobic_movement_intervals', 'Intervalos aeróbicos en cancha', 'Intervalos largos de movimiento en cancha'],
  ['technical_recovery_length', 'Largo controlado de baja carga', 'Peloteo profundo suave de recuperación'],
]

/** Nombres de partido congelados por estar hardcodeados en cinco consumidores. */
const FROZEN_MATCH_NAMES: Array<[string, string]> = [
  ['match_sim_points_short_sets', 'Game a 11 con marcador real'],
  ['practice_match_five_games', 'Partido de entrenamiento al mejor de 5 juegos'],
  ['practice_match_best_of_3', 'Partido de entrenamiento al mejor de 3 juegos'],
]

describe('renombres y aliases de squash', () => {
  it.each(RENAMES)('%s adopta su nombre nuevo', (id, _previous, next) => {
    expect(SQUASH_DRILL_LIBRARY.find((drill) => drill.id === id)?.name).toBe(next)
  })

  it.each(RENAMES)('%s conserva su nombre anterior como alias', (id, previous) => {
    expect(SQUASH_DRILL_LIBRARY.find((drill) => drill.id === id)?.aliases).toContain(previous)
  })

  it.each(RENAMES)('%s resuelve por su nombre anterior', (id, previous) => {
    expect(findSquashDrillByName(previous)?.id).toBe(id)
  })

  it.each(RENAMES)('%s aparece en el buscador por su nombre anterior', (id, previous) => {
    expect(searchCatalog('squash', previous).map((entry) => entry.libraryId)).toContain(id)
  })

  it.each(FROZEN_MATCH_NAMES)('%s mantiene su nombre congelado', (id, name) => {
    expect(SQUASH_DRILL_LIBRARY.find((drill) => drill.id === id)?.name).toBe(name)
  })

  it('solo 14 drills tienen aliases', () => {
    expect(SQUASH_DRILL_LIBRARY.filter((drill) => (drill.aliases ?? []).length > 0)).toHaveLength(14)
  })
})
