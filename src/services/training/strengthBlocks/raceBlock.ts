import type { StrengthBlockTemplate } from './types'

export const RACE: StrengthBlockTemplate = {
  id: 'race',
  phase: 'race',
  subTemplate: 'A',
  description: 'Race - activacion pre-evento sin fatiga residual',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'plyo', required: false },
    { pattern: 'push', required: false },
    { pattern: 'mobility', required: true },
  ],
}
