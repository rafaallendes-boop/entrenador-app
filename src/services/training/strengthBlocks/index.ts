import type { ExercisePhase } from '../exerciseLibrary'
import { BUILD_A, BUILD_B, BUILD_C } from './buildBlock'
import { PEAK_A, PEAK_B, PEAK_C } from './peakBlock'
import { RACE } from './raceBlock'
import { TAPER_A, TAPER_B } from './taperBlock'
import type { StrengthBlockTemplate } from './types'

export const STRENGTH_BLOCK_TEMPLATES: StrengthBlockTemplate[] = [
  BUILD_A,
  BUILD_B,
  BUILD_C,
  PEAK_A,
  PEAK_B,
  PEAK_C,
  TAPER_A,
  TAPER_B,
  RACE,
]

const PHASE_SUBTEMPLATES: Record<ExercisePhase, StrengthBlockTemplate[]> = {
  base: [BUILD_A, BUILD_B, BUILD_C],
  build: [BUILD_A, BUILD_B, BUILD_C],
  peak: [PEAK_A, PEAK_B, PEAK_C],
  taper: [TAPER_A, TAPER_B],
  race: [RACE],
  transition: [TAPER_B],
}

export function selectStrengthBlockTemplate(
  phase: ExercisePhase,
  weekIndexInBlock: number,
): StrengthBlockTemplate {
  const candidates = PHASE_SUBTEMPLATES[phase] ?? PHASE_SUBTEMPLATES.build
  return candidates[Math.abs(weekIndexInBlock) % candidates.length]!
}

export type { StrengthBlockPattern, StrengthBlockSlot, StrengthBlockTemplate } from './types'
