/** Composition defaults, not minimum effective exercise doses. See E1 decision log. */
export const SESSION_COMPOSITION_MINUTES = {
  technical: 15, control: 15, shadows: 20, match: 20,
  z2: 15, long: 15, tempo: 20, intervals: 20,
} as const

export interface SessionTimeBudget {
  warmupSec: number
  workSec: number
  recoverySec: number
  cooldownSec: number
}

/** All arithmetic uses whole seconds. No rounding up past the requested limit. */
export function sessionBudget(durationMin: number): SessionTimeBudget {
  const total = Math.floor(durationMin * 60)
  const edge = Math.min(600, Math.max(300, Math.floor(total * 0.2)))
  return { warmupSec: edge, workSec: total - edge * 2, recoverySec: 0, cooldownSec: edge }
}

export function sumTimedBlocks(blocks: readonly { durationMin?: number; repetitions?: number; distanceKm?: number; durationBasis?: 'per_repetition' | 'total'; recoverySeconds?: number }[]): number | null {
  if (!blocks.length) return null
  let total = 0
  for (const block of blocks) {
    const count = block.durationBasis === 'total' ? 1 : block.repetitions ?? 1
    if (!Number.isFinite(block.durationMin) || block.durationMin! <= 0
      || !Number.isInteger(count) || count <= 0) return null
    total += Math.round(block.durationMin! * 60) * count
    if (block.recoverySeconds != null) {
      if (!Number.isFinite(block.recoverySeconds) || block.recoverySeconds < 0) return null
      total += Math.round(block.recoverySeconds) * Math.max(0, (block.repetitions ?? 1) - 1)
    }
  }
  return total
}

/** Split an integer budget without losing seconds. */
export function splitSeconds(total: number, count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, i) => base + (i < total % count ? 1 : 0))
}
