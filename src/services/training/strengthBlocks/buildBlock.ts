import type { StrengthBlockTemplate } from './types'

export const BUILD_A: StrengthBlockTemplate = {
  id: 'build-A',
  phase: 'build',
  subTemplate: 'A',
  description: 'Build A - squat dominante + tiron',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'squat', preferredRotationGroup: 'A', required: true, isStarLiftCandidate: true },
    { pattern: 'pull', preferredRotationGroup: 'A', required: true },
    { pattern: 'lunge', preferredRotationGroup: 'C', required: true },
    { pattern: 'push', preferredRotationGroup: 'B', required: true, minDurationMin: 55 },
    { pattern: 'plyo', required: false, minDurationMin: 60 },
  ],
}

export const BUILD_B: StrengthBlockTemplate = {
  id: 'build-B',
  phase: 'build',
  subTemplate: 'B',
  description: 'Build B - hinge dominante + empuje',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'hinge', preferredRotationGroup: 'A', required: true, isStarLiftCandidate: true },
    { pattern: 'push', preferredRotationGroup: 'A', required: true },
    { pattern: 'pull', preferredRotationGroup: 'B', required: false, minDurationMin: 55 },
    { pattern: 'lunge', preferredRotationGroup: 'C', required: false, minDurationMin: 55 },
    { pattern: 'cardio', required: false, minDurationMin: 60 },
  ],
}

export const BUILD_C: StrengthBlockTemplate = {
  id: 'build-C',
  phase: 'build',
  subTemplate: 'C',
  description: 'Build C - unilateral + potencia lateral',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'lunge', preferredRotationGroup: 'C', required: true, isStarLiftCandidate: true },
    { pattern: 'push', preferredRotationGroup: 'C', required: true },
    { pattern: 'pull', preferredRotationGroup: 'C', required: false, minDurationMin: 55 },
    { pattern: 'hinge', preferredRotationGroup: 'C', required: false, minDurationMin: 55 },
    { pattern: 'plyo', required: false, minDurationMin: 60 },
  ],
}
