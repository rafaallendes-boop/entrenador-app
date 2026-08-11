import { describe, expect, it } from 'vitest'

import { searchCatalog } from '../coachExerciseCatalog'
import { findSquashDrillByName, SQUASH_DRILL_LIBRARY } from '../drillLibrary'

const PERSONAL_PROGRESSION_IDS = [
  'conditioned_full_lane_per_side',
  'back_court_parallel_cross_on_volley',
  'two_wall_volley_cross_straight_reply',
  'two_wall_volley_cross_drop_option',
  'two_wall_volley_cross_front_direction_choice',
] as const

describe('progresión personal de pasillo, volea y drop', () => {
  it('conserva las cinco variantes cooperativas en orden de complejidad', () => {
    const drills = PERSONAL_PROGRESSION_IDS.map((id) =>
      SQUASH_DRILL_LIBRARY.find((drill) => drill.id === id),
    )

    expect(drills.every(Boolean)).toBe(true)
    expect(drills.map((drill) => drill?.progressionLevel)).toEqual([1, 2, 2, 3, 3])
    expect(drills.every((drill) => drill?.sessionKind === 'technical')).toBe(true)
    expect(drills.every((drill) => drill?.executionMode === 'partner')).toBe(true)
    expect(drills.every((drill) => drill?.tags.includes('conditioned_game'))).toBe(true)
  })

  it('preserva las reglas que diferencian cada variante', () => {
    expect(findSquashDrillByName('Juego condicionado: pasillo completo por lado')?.constraints)
      .toContain('Cada jugador usa el pasillo completo de su lado')
    expect(findSquashDrillByName('Paralelas de fondo: cruce solo con volea')?.constraints)
      .toContain('El cruce solo vale si se juega de volea')
    expect(findSquashDrillByName('Cruce de volea a dos paredes y respuesta paralela')?.constraints)
      .toContain('El jugador adelantado responde paralelo')
    expect(findSquashDrillByName('Cruce de volea a dos paredes con opción de drop')?.constraints)
      .toContain('El drop solo se habilita cuando la pelota rival queda corta')
    expect(findSquashDrillByName('Cruce de volea a dos paredes: adelante elige dirección')?.constraints)
      .toContain('El jugador adelantado puede responder paralelo o cruzado')
  })

  it('los ofrece en el buscador de ejercicios de squash', () => {
    for (const id of PERSONAL_PROGRESSION_IDS) {
      const drill = SQUASH_DRILL_LIBRARY.find((item) => item.id === id)!
      expect(searchCatalog('squash', drill.name).map((entry) => entry.libraryId)).toContain(id)
    }
  })
})
