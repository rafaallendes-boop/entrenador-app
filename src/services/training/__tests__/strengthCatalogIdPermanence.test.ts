import { describe, expect, it } from 'vitest'

import { RETIRED_STRENGTH_EXERCISE_IDS, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'

/**
 * Lista APPEND-ONLY de todo `id` que existió alguna vez. Un `id` retirado se
 * mueve al registro de retirados y nunca se reutiliza para otro ejercicio.
 */
const FROZEN_KNOWN_IDS = [
  'air_treadmill_20_20',
  'alternating_step_up_jump',
  'assault_bike_30_30',
  'assisted_pull_up',
  'back_squat',
  'band_row',
  'barbell_jump_squat',
  'barbell_single_leg_inverted_row',
  'bb_reverse_lunge',
  'bb_side_lunge',
  'bench_press',
  'bent_over_row',
  'bird_dog_renegade_row',
  'bodyweight_squat',
  'box_jump',
  'broad_jump',
  'bulgarian_split_squat',
  'cable_chop',
  'chest_supported_row',
  'clean',
  'clean_high_pull',
  'close_grip_bench_press',
  'copenhagen_side_plank',
  'dead_bug',
  'deadlift',
  'depth_jump',
  'drop_jump',
  'farmer_carry',
  'front_squat',
  'glute_bridge',
  'goblet_squat',
  'half_kneeling_diagonal_plate_chop',
  'half_kneeling_lateral_jump',
  'half_kneeling_row',
  'hip_thrust',
  'incline_bench_press',
  'incline_dumbbell_press',
  'inverted_row',
  'jump_squat',
  'kettlebell_swing',
  'ladder_bipodal_front_1',
  'ladder_bipodal_front_2',
  'ladder_bipodal_front_3',
  'ladder_bipodal_lateral_1',
  'ladder_bipodal_lateral_3',
  'ladder_coordinativo_front_2',
  'ladder_coordinativo_front_4',
  'landmine_press',
  'lat_pulldown',
  'lateral_band_walk',
  'lateral_skater_jumps',
  'med_ball_rotational_throw',
  'med_ball_slam',
  'mixed_grip_pull_up',
  'overhead_press',
  'pallof_press',
  'plank',
  'pogo_jumps',
  'pull_up',
  'push_press',
  'push_up',
  'romanian_deadlift',
  'rotational_med_ball_throw',
  'side_plank',
  'side_plank_plate_press',
  'single_leg_broad_jump',
  'single_leg_hip_thrust',
  'split_jerk',
  'split_squat',
  'stability_ball_front_plank',
  'step_up',
  'sumo_deadlift',
  'trap_bar_deadlift',
  'trx_inverted_row',
  'walking_lunge',
  'weighted_pull_up',
  'z_press',
]

describe('permanencia de los id del catálogo de fuerza', () => {
  const active = STRENGTH_EXERCISE_LIBRARY.map((exercise) => exercise.id)

  it('activos y retirados son conjuntos disjuntos', () => {
    const activeSet = new Set(active)
    expect(RETIRED_STRENGTH_EXERCISE_IDS.filter((id) => activeSet.has(id))).toEqual([])
  })

  it('la unión de activos y retirados es exactamente la lista conocida', () => {
    expect([...active, ...RETIRED_STRENGTH_EXERCISE_IDS].sort()).toEqual(FROZEN_KNOWN_IDS)
  })

  it('no hay ids duplicados entre los activos', () => {
    expect(new Set(active).size).toBe(active.length)
  })
})
