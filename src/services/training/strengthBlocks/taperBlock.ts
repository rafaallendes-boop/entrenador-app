import type { StrengthBlockTemplate } from './types'

export const TAPER_A: StrengthBlockTemplate = {
  id: 'taper-A',
  phase: 'taper',
  subTemplate: 'A',
  description: 'Taper A - activacion ligera',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'squat', preferredRotationGroup: 'C', required: false },
    { pattern: 'push', preferredRotationGroup: 'C', required: false },
  ],
}

export const TAPER_B: StrengthBlockTemplate = {
  id: 'taper-B',
  phase: 'taper',
  subTemplate: 'B',
  description: 'Taper B - movilidad + core',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'pull', preferredRotationGroup: 'C', required: false },
  ],
}
