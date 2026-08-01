import type { StrengthProfile, WarmupSet } from '../../types'
import type { Exercise1RMReference } from './exerciseLibrary'

export type ReferenceLift = Exercise1RMReference

type NumericLiftKey = 'benchPress1RM' | 'squat1RM' | 'deadlift1RM' | 'overheadPress1RM'

function liftToProfileKey(lift: ReferenceLift): NumericLiftKey {
  switch (lift) {
    case 'benchPress': return 'benchPress1RM'
    case 'squat': return 'squat1RM'
    case 'deadlift': return 'deadlift1RM'
    case 'overheadPress': return 'overheadPress1RM'
  }
}

export function getStrengthReferenceKg(
  lift: ReferenceLift,
  profile: StrengthProfile | undefined,
): number | undefined {
  if (!profile) return undefined
  const value = profile[liftToProfileKey(lift)]
  return value != null && value > 0 ? value : undefined
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
