import type { RunningTemplatePrescription as P, RunningEffort } from '../../types/runningTemplate'

const continuous = (minimumMinutes: number, defaultMinutes: number, effort: RunningEffort = 'easy', workSeconds?: number): P =>
  ({ kind: 'continuous', minimumMinutes, defaultMinutes, effort, workSeconds })
const repeats = (minimumMinutes: number, defaultMinutes: number, effort: RunningEffort, workSeconds: number,
  min: number, max: number, recoverySeconds: number, extra: Partial<P> = {}): P =>
  ({ kind: 'repeats', minimumMinutes, defaultMinutes, effort, workSeconds, repetitions: { min, max }, recoverySeconds, ...extra })

/** Every catalog identity has its own typed prescription. No title parsing. */
export const RUNNING_PRESCRIPTIONS: Record<string, P> = {
  easy_z2_base: continuous(15, 40),
  easy_z2_strides: repeats(26, 35, 'stride', 20, 4, 6, 80, { minimumEasySeconds: 600 }),
  aerobic_steady: continuous(30, 40, 'steady'),
  easy_longer: continuous(55, 60),
  long_easy: continuous(60, 75),
  progressive_long: { ...continuous(60, 75, 'steady'), kind: 'progressive' },
  long_fast_finish: { ...continuous(60, 75, 'half_marathon', 900), kind: 'progressive' },
  tempo_continuo: continuous(20, 45, 'threshold', 2100),
  cruise_intervals: repeats(30, 50, 'threshold', 360, 2, 4, 120),
  threshold_blocks: repeats(25, 45, 'threshold', 240, 2, 6, 120),
  lactate_clearance: continuous(30, 50, 'steady', 2100),
  repeats_400: repeats(25, 45, 'five_k', 0, 4, 12, 90, { distanceKm: 0.4 }),
  repeats_800: repeats(30, 50, 'five_k', 0, 3, 6, 120, { distanceKm: 0.8 }),
  repeats_1k: repeats(35, 55, 'ten_k', 0, 3, 5, 120, { distanceKm: 1 }),
  fartlek_controlado: repeats(20, 40, 'ten_k', 120, 2, 6, 120),
  strides_session: repeats(28, 35, 'stride', 20, 4, 8, 100, { minimumEasySeconds: 600 }),
  short_hill_sprints: repeats(35, 40, 'hill_sprint', 10, 6, 10, 120, { terrain: 'hill', minimumEasySeconds: 600 }),
  speed_support: repeats(26, 40, 'stride', 20, 4, 4, 80, { techniqueSeconds: 180, minimumEasySeconds: 420 }),
  hill_repeats: repeats(25, 40, 'hill_hard', 60, 4, 10, 120, { terrain: 'hill' }),
  uphill_tempo: repeats(30, 45, 'threshold', 240, 2, 4, 180, { terrain: 'hill' }),
  hm_pace_blocks: repeats(40, 60, 'half_marathon', 600, 2, 3, 180),
  pace_10k_reps: repeats(35, 55, 'ten_k', 0, 4, 8, 120, { distanceKm: 0.8 }),
  marathon_pace_steady: continuous(30, 45, 'marathon', 1800),
  race_activation: repeats(20, 25, 'stride', 20, 4, 6, 60, { minimumEasySeconds: 300 }),
  recovery_jog: continuous(15, 25),
  run_walk_return: { ...repeats(15, 25, 'easy', 120, 1, 8, 90), kind: 'run_walk' },
  low_impact_return: { ...repeats(15, 20, 'easy', 60, 1, 8, 120), kind: 'run_walk' },
  easy_fractionated_support: repeats(22, 30, 'easy', 300, 2, 5, 60),
  short_support_tempo: repeats(20, 30, 'threshold', 120, 2, 4, 120),
  short_support_fartlek: repeats(20, 30, 'steady', 60, 3, 6, 120),
  squash_activation_run: repeats(15, 20, 'stride', 15, 3, 4, 60),
}
