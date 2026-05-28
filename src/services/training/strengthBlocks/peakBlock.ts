import type { StrengthBlockTemplate } from './types'

export const PEAK_A: StrengthBlockTemplate = {
  id: 'peak-A',
  phase: 'peak',
  subTemplate: 'A',
  description: 'Peak A - potencia lateral + transferencia a cancha',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'plyo', required: true, isStarLiftCandidate: true },
    { pattern: 'squat', preferredRotationGroup: 'B', required: true },
    { pattern: 'push', preferredRotationGroup: 'C', required: false, minDurationMin: 55 },
    { pattern: 'cardio', required: false, minDurationMin: 60 },
  ],
}

export const PEAK_B: StrengthBlockTemplate = {
  id: 'peak-B',
  phase: 'peak',
  subTemplate: 'B',
  description: 'Peak B - hinge rapido + core profundo',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'hinge', preferredRotationGroup: 'B', required: true, isStarLiftCandidate: true },
    { pattern: 'pull', preferredRotationGroup: 'C', required: true },
    { pattern: 'lunge', preferredRotationGroup: 'C', required: false, minDurationMin: 55 },
  ],
}

export const PEAK_C: StrengthBlockTemplate = {
  id: 'peak-C',
  phase: 'peak',
  subTemplate: 'C',
  description: 'Peak C - mantenimiento de fuerza',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'squat', preferredRotationGroup: 'A', required: true, isStarLiftCandidate: true },
    { pattern: 'push', preferredRotationGroup: 'A', required: true },
    { pattern: 'pull', preferredRotationGroup: 'A', required: false, minDurationMin: 55 },
  ],
}
