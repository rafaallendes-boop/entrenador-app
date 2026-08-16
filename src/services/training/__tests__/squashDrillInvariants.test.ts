import { describe, expect, it } from 'vitest'

import {
  getSquashDrillFamily,
  resolveDrillExecutionMode,
  resolveSquashDrillKind,
  SQUASH_DRILL_LIBRARY,
} from '../drillLibrary'

/** Los 14 ids cuyo `name` cambia en esta entrega. Spec §3. */
const RENAMED_IDS = new Set([
  'drive_parallel_depth',
  'drive_crosscourt_length',
  'drive_switch_parallel_cross',
  'boast_to_straight_drive',
  'solo_100_drops',
  'solo_100_mid_court_shots',
  'solo_100_service_box',
  'solo_100_parallels_back',
  'pressure_three_quarters_court',
  'conditioned_boast_start',
  'rsa_short_bursts',
  'continuous_squash_movement_base',
  'extensive_aerobic_movement_intervals',
  'technical_recovery_length',
])

/** Los 21 ids cuya `description` cambia en esta entrega. Spec §3bis. */
const REWRITTEN_DESCRIPTION_IDS = new Set([
  'drive_parallel_depth',
  'drive_crosscourt_length',
  'drive_switch_parallel_cross',
  'boast_to_straight_drive',
  'drop_and_counter_drop',
  'solo_100_drops',
  'mid_court_drops',
  'solo_volleys_only',
  'attack_from_t_first_ball',
  'conditioned_boast_start',
  'ghosting_4_corners',
  'ghosting_6_points',
  'split_step_t_recovery',
  'rsa_short_bursts',
  'defensive_high_lob_recovery',
  'attacking_lob_change_of_pace',
  'attacking_boast_from_mid_court',
  'attacking_boast_from_back_court',
  'continuous_squash_movement_base',
  'match_sim_points_short_sets',
  'practice_match_best_of_3',
])

/**
 * Progresiones añadidas después de la entrega de copy de julio. Quedan fuera
 * del snapshot histórico, pero tienen su propio contrato de contenido.
 */
const POST_COPY_DELIVERY_IDS = new Set([
  'conditioned_full_lane_per_side',
  'back_court_parallel_cross_on_volley',
  'two_wall_volley_cross_straight_reply',
  'two_wall_volley_cross_drop_option',
  'two_wall_volley_cross_front_direction_choice',
  'solo_100_serve_lob_targets',
  'solo_100_serve_hard_low',
  'return_of_serve_depth_control',
  'serve_return_first_three_shots',
  'high_volley_control',
  'volley_drop_finish',
])

/**
 * Guard de la entrega de copy (spec 2026-07-31).
 *
 * Congela todo lo que esta entrega NO puede tocar: los campos que no son texto
 * de usuario, más los 29 nombres y las 22 descripciones que quedan estables.
 * Solo `name` de los 14 renombrados, `description` de los 21 reescritos y el
 * campo `aliases` quedan fuera del snapshot.
 *
 * NO correr `vitest -u` sobre este archivo. Si el snapshot cambia, una edición
 * se salió de su carril — que es exactamente el bug que este guard atrapa.
 */
describe('invariantes de la librería de squash', () => {
  it('solo cambian los nombres, descripciones y aliases previstos', async () => {
    const table = SQUASH_DRILL_LIBRARY
      .filter((drill) => !POST_COPY_DELIVERY_IDS.has(drill.id))
      .map((drill) => ({
        id: drill.id,
        category: drill.category,
        focus: [...drill.focus],
        tags: [...drill.tags],
        intensity: drill.intensity,
        intent: drill.intent ?? null,
        constraints: drill.constraints ? [...drill.constraints] : null,
        progressionLevel: drill.progressionLevel ?? null,
        phaseAppropriate: [...(drill.phaseAppropriate ?? [])],
        partnerRequired: drill.partnerRequired ?? null,
        executionMode: resolveDrillExecutionMode(drill),
        family: getSquashDrillFamily(drill),
        blockKind: resolveSquashDrillKind(drill),
        // Los que la entrega no renombra ni reescribe quedan congelados acá.
        stableName: RENAMED_IDS.has(drill.id) ? null : drill.name,
        stableDescription: REWRITTEN_DESCRIPTION_IDS.has(drill.id) ? null : drill.description,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))

    expect(table).toHaveLength(49)
    expect(table.filter((row) => row.stableName !== null)).toHaveLength(35)
    expect(table.filter((row) => row.stableDescription !== null)).toHaveLength(28)

    await expect(`${JSON.stringify(table, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/squashDrillInvariants.json')
  })
})
