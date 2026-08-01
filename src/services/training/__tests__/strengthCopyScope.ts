/**
 * Alcance del copy de fuerza (spec 2026-08-01 §4 y §5).
 *
 * Vive en un módulo sin sufijo `.test` a propósito: lo comparten
 * `strengthExerciseCopyInvariants.test.ts` y `strengthExerciseCopy.test.ts`, y
 * si uno importara del otro se volvería a ejecutar su `describe` — inflando el
 * conteo de tests y abriendo una carrera sobre el mismo archivo de snapshot.
 */

/** Los 12 ids con `name` en alcance (spec §4). */
export const RENAMED_STRENGTH_IDS = new Set([
  'air_treadmill_20_20',
  'copenhagen_side_plank',
  'dead_bug',
  'half_kneeling_diagonal_plate_chop',
  'half_kneeling_lateral_jump',
  'half_kneeling_row',
  'ladder_bipodal_front_2',
  'ladder_bipodal_lateral_3',
  'landmine_press',
  'overhead_press',
  'push_press',
  'split_squat',
])

/** Los 31 ids con `description` en alcance (spec §5). */
export const REWRITTEN_DESCRIPTION_IDS = new Set([
  'air_treadmill_20_20',
  'alternating_step_up_jump',
  'assault_bike_30_30',
  'barbell_jump_squat',
  'bb_reverse_lunge',
  'clean',
  'clean_high_pull',
  'close_grip_bench_press',
  'copenhagen_side_plank',
  'dead_bug',
  'depth_jump',
  'farmer_carry',
  'goblet_squat',
  'half_kneeling_diagonal_plate_chop',
  'half_kneeling_lateral_jump',
  'half_kneeling_row',
  'hip_thrust',
  'kettlebell_swing',
  'ladder_bipodal_front_2',
  'ladder_bipodal_lateral_3',
  'ladder_coordinativo_front_4',
  'landmine_press',
  'lateral_band_walk',
  'overhead_press',
  'pallof_press',
  'pogo_jumps',
  'push_press',
  'split_squat',
  'stability_ball_front_plank',
  'sumo_deadlift',
  'z_press',
])
