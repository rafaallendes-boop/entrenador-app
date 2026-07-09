export type RecoveryBand = 'red' | 'yellow' | 'green' | 'none'

export function recoveryBand(score?: number | null): RecoveryBand {
  if (score == null || !Number.isFinite(score)) return 'none'
  if (score <= 33) return 'red'
  if (score <= 66) return 'yellow'
  return 'green'
}
