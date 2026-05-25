import type { StrengthProfile, WarmupSet } from '../../types'

export type ReferenceLift = 'bench' | 'squat' | 'deadlift' | 'overheadPress' | 'pullUp'

export interface LoadReference {
  lift: ReferenceLift
  referenceKg: number
  factor: number
}

interface ReferenceEntry {
  pattern: RegExp
  lift: Exclude<ReferenceLift, 'pullUp'>
  factor: number
}

// Order matters: more specific patterns first. Spanish + English variants.
const REFERENCE_TABLE: ReferenceEntry[] = [
  // Bench-based variants
  { pattern: /(press[\s-]+inclinad|incline[\s-]+press|incline[\s-]+bench)/i, lift: 'bench', factor: 0.85 },
  { pattern: /(press[\s-]+declin|decline[\s-]+press|decline[\s-]+bench)/i, lift: 'bench', factor: 0.9 },
  { pattern: /(close[\s-]?grip|agarre[\s-]+cerrado)/i, lift: 'bench', factor: 0.9 },
  { pattern: /(press(\s+de)?\s+banca|bench[\s-]+press|\bbench\b)/i, lift: 'bench', factor: 1.0 },
  { pattern: /(fondo|\bdip(s)?\b)/i, lift: 'bench', factor: 0.7 },
  // Overhead variants
  { pattern: /(push[\s-]+press)/i, lift: 'overheadPress', factor: 1.15 },
  { pattern: /(\bz[\s-]+press\b|press[\s-]+z\b)/i, lift: 'overheadPress', factor: 0.65 },
  { pattern: /(press[\s-]+(de[\s-]+)?hombro|press[\s-]+sobre[\s-]+cabeza|press[\s-]+militar|overhead[\s-]+press|\bohp\b|strict[\s-]+press)/i, lift: 'overheadPress', factor: 1.0 },
  // Squat variants (front before generic so "front squat" wins over "squat")
  { pattern: /(sentadilla[\s-]+frontal|front[\s-]+squat)/i, lift: 'squat', factor: 0.85 },
  { pattern: /(b[uú]lgar|split[\s-]+squat)/i, lift: 'squat', factor: 0.35 },
  { pattern: /(zancad|\blunge(s)?\b)/i, lift: 'squat', factor: 0.4 },
  { pattern: /(hip[\s-]+thrust|empuje[\s-]+de[\s-]+cadera|glute[\s-]+bridge)/i, lift: 'squat', factor: 1.2 },
  { pattern: /(sentadilla|back[\s-]+squat|\bsquat\b)/i, lift: 'squat', factor: 1.0 },
  // Deadlift variants (specific before generic)
  { pattern: /(peso[\s-]+muerto[\s-]+rumano|romanian[\s-]+deadlift|\brdl\b)/i, lift: 'deadlift', factor: 0.8 },
  { pattern: /(peso[\s-]+muerto[\s-]+sumo|sumo[\s-]+deadlift)/i, lift: 'deadlift', factor: 0.95 },
  { pattern: /(trap[\s-]?bar|hex[\s-]?bar)/i, lift: 'deadlift', factor: 0.95 },
  { pattern: /(peso[\s-]+muerto|\bdeadlift\b)/i, lift: 'deadlift', factor: 1.0 },
  // Rows (bench-referenced for upper body pulling)
  { pattern: /(pendlay[\s-]+row|remo[\s-]+pendlay)/i, lift: 'bench', factor: 0.7 },
  { pattern: /(barbell[\s-]+row|remo[\s-]+(con[\s-]+)?barra)/i, lift: 'bench', factor: 0.75 },
  { pattern: /(1:2[\s-]+kneeling[\s-]+row|half[\s-]+kneeling[\s-]+row|remo[\s-]+medio[\s-]+arrodillado|remo[\s-]+.*arrodill)/i, lift: 'bench', factor: 0.35 },
]

const PULLUP_PATTERN = /(dominad|pull[\s-]?up(s)?|chin[\s-]?up(s)?)/i

export function mapExerciseTo1RMReference(
  exerciseName: string,
  profile: StrengthProfile | undefined,
): LoadReference | undefined {
  if (!profile) return undefined
  const name = exerciseName.trim()
  if (!name) return undefined

  if (PULLUP_PATTERN.test(name)) {
    const reps = profile.pullUpMaxReps
    if (reps == null || reps <= 0) return undefined
    // pullUpMaxReps is reps, not kg — used only to signal availability.
    return { lift: 'pullUp', referenceKg: reps, factor: 1.0 }
  }

  for (const entry of REFERENCE_TABLE) {
    if (!entry.pattern.test(name)) continue
    const refKg = profile[liftToProfileKey(entry.lift)]
    if (refKg == null || refKg <= 0) return undefined
    return { lift: entry.lift, referenceKg: refKg, factor: entry.factor }
  }

  return undefined
}

type NumericLiftKey = 'benchPress1RM' | 'squat1RM' | 'deadlift1RM' | 'overheadPress1RM'

function liftToProfileKey(lift: Exclude<ReferenceLift, 'pullUp'>): NumericLiftKey {
  switch (lift) {
    case 'bench': return 'benchPress1RM'
    case 'squat': return 'squat1RM'
    case 'deadlift': return 'deadlift1RM'
    case 'overheadPress': return 'overheadPress1RM'
  }
}

export function computeWeightFromPercent(
  referenceKg: number,
  percent1RM: number,
  options: { factor?: number; roundingKg?: number } = {},
): number {
  const factor = options.factor ?? 1
  const roundingKg = options.roundingKg ?? 2.5
  const raw = (referenceKg * factor * percent1RM) / 100
  return Math.max(roundingKg, Math.round(raw / roundingKg) * roundingKg)
}

export function buildWarmupRamp(
  targetWeight: number,
  targetPercent1RM: number,
  options: { roundingKg?: number } = {},
): WarmupSet[] {
  const roundingKg = options.roundingKg ?? 2.5
  if (!Number.isFinite(targetWeight) || targetWeight <= 0) return []
  if (!Number.isFinite(targetPercent1RM) || targetPercent1RM <= 0) return []

  const steps: Array<{ percent1RM: number; reps: number | string }> =
    targetPercent1RM >= 85
      ? [
          { percent1RM: 50, reps: 5 },
          { percent1RM: 70, reps: 3 },
          { percent1RM: 85, reps: 2 },
        ]
      : targetPercent1RM >= 75
        ? [
            { percent1RM: 50, reps: 8 },
            { percent1RM: 70, reps: 5 },
          ]
        : targetPercent1RM >= 60
          ? [
              { percent1RM: 50, reps: 8 },
            ]
          : []

  return steps.map((step) => {
    const rawWeight = targetWeight * (step.percent1RM / targetPercent1RM)
    const weight = Math.max(roundingKg, Math.round(rawWeight / roundingKg) * roundingKg)
    return { reps: step.reps, weight, percent1RM: step.percent1RM }
  })
}

export function hasAnyStrengthReference(profile: StrengthProfile | undefined): boolean {
  if (!profile) return false
  return [
    profile.benchPress1RM,
    profile.squat1RM,
    profile.deadlift1RM,
    profile.overheadPress1RM,
    profile.pullUpMaxReps,
  ].some((v) => v != null && v > 0)
}

export function listAvailableStrengthReferences(profile: StrengthProfile | undefined): string[] {
  if (!profile) return []
  const refs: string[] = []
  if (profile.squat1RM) refs.push(`sentadilla ${profile.squat1RM}kg`)
  if (profile.deadlift1RM) refs.push(`peso muerto ${profile.deadlift1RM}kg`)
  if (profile.benchPress1RM) refs.push(`press banca ${profile.benchPress1RM}kg`)
  if (profile.overheadPress1RM) refs.push(`press hombro ${profile.overheadPress1RM}kg`)
  if (profile.pullUpMaxReps) refs.push(`dominadas ${profile.pullUpMaxReps} reps`)
  return refs
}
